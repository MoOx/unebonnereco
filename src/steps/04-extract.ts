/**
 * Step 4 — extract recommendations from the targeted section.
 *
 * The timecode a model returns is a `[HH:MM:SS]` label copied from the prompt; we
 * resolve it back to a real block here rather than trusting the model with
 * arithmetic. A label that matches no block is snapped to the nearest one and
 * flagged with `timecodeExact: false`.
 *
 * Output: work/raw-recommendations/<id><suffix>.json
 *
 * Usage: node src/steps/04-extract.ts [--backend claude-code|ollama] [--model X]
 *                                     [--source whisper|youtube] [--batch N]
 *                                     [--force] [--replace] [id ...]
 *
 * --replace recomputes timecodes from stored extractions, with no model call.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { chunk, parseCommonOptions, runSuffix } from "../lib/cli.ts";
import { ensureDir, RAW_RECOS, readJson, SECTIONS, WORK, writeJson } from "../lib/paths.ts";
import { attributionIsCued, locateQuote } from "../lib/locate.ts";
import { hms, parseHms } from "../lib/time.ts";
import type {
  Episode,
  ExtractionRun,
  RawRecommendation,
  Recommendation,
  Section,
  TranscriptBlock,
  TranscriptSource,
} from "../types.ts";

/** Seconds of run-up before the quote, so the clip opens on the question that prompts it. */
const CLIP_LEAD_IN = 10;
/** How long the answer is assumed to run past the quote itself. */
const CLIP_TAIL = 55;
/** Never produce a clip shorter than this — a five-second snippet is unusable. */
const CLIP_MIN = 35;

/**
 * Work out where the recommendation actually is, and what to play.
 *
 * Preference order: the quote located in Whisper's own segments (accurate to a couple
 * of seconds), then the ~45 s block the model was reading, which can be half a minute
 * early. `timecodeExact` reports which of the two we got.
 */
function place(
  raw: RawRecommendation,
  section: Section,
): { timecodeS: number; timecodeExact: boolean; clipStartS: number; clipEndS: number } {
  const blocks = section.blocks;
  const fromLabel = resolveTimecode(raw.timecode, blocks);

  const located = section.segments
    ? locateQuote(raw.excerpt ?? "", section.segments, raw.spokenTitle)
    : null;

  const timecodeS = located ? located.startS : fromLabel.seconds;
  const spokenEnd = located ? located.endS : timecodeS;
  const clipStartS = Math.max(0, timecodeS - CLIP_LEAD_IN);
  const clipEndS = Math.max(spokenEnd + CLIP_TAIL, clipStartS + CLIP_MIN);

  return {
    timecodeS,
    timecodeExact: located ? located.exact : fromLabel.exact,
    clipStartS,
    clipEndS,
  };
}

/** Map a model-supplied label onto a real block. */
function resolveTimecode(
  label: string,
  blocks: TranscriptBlock[],
): { seconds: number; exact: boolean } {
  const parsed = parseHms(label ?? "");
  if (parsed === null) return { seconds: blocks[0].startS, exact: false };
  if (blocks.some((block) => block.startS === parsed)) {
    return { seconds: parsed, exact: true };
  }
  const nearest = blocks.reduce((best, block) =>
    Math.abs(block.startS - parsed) < Math.abs(best.startS - parsed) ? block : best,
  );
  return { seconds: nearest.startS, exact: false };
}

function toRecommendation(
  raw: RawRecommendation,
  episodeId: string,
  index: number,
  section: Section,
): Recommendation {
  const { timecodeS, timecodeExact, clipStartS, clipEndS } = place(raw, section);
  const recommendedBy = raw.recommendedBy ?? "";
  return {
    id: `${episodeId}-${String(index).padStart(2, "0")}`,
    episodeId,
    spokenTitle: raw.spokenTitle,
    title: raw.correctedTitle || raw.spokenTitle,
    kind: raw.kind,
    creator: raw.creator ?? "",
    recommendedBy,
    attributionCued:
      recommendedBy && section.segments
        ? attributionIsCued(recommendedBy, timecodeS, section.segments)
        : false,
    timecodeS,
    timecodeExact,
    clipStartS,
    clipEndS,
    timestampedUrl: `https://www.youtube.com/watch?v=${episodeId}&t=${clipStartS}s`,
    transcriptExcerpt: raw.excerpt ?? "",
    confidence: raw.confidence ?? 0,
    status: "to_review",
  };
}

/**
 * Re-run placement over recommendations already extracted, without asking the model
 * again.
 *
 * Where a recommendation sits in the episode is derived from its quote and the
 * Whisper segments — both already on disk. So improving the placement rule should
 * not cost another extraction pass over the whole catalogue.
 */
function replacePlacements(source: TranscriptSource, suffixFor: string): void {
  const files = readdirSync(RAW_RECOS).filter((f) => f.endsWith(suffixFor));
  let moved = 0;
  let recovered = 0;
  let total = 0;

  for (const file of files) {
    const run = readJson<ExtractionRun>(join(RAW_RECOS, file));
    const sectionFile = join(
      SECTIONS,
      `${run.episodeId}${source === "whisper" ? ".whisper.json" : ".json"}`,
    );
    if (!existsSync(sectionFile)) continue;
    const section = readJson<Section>(sectionFile);
    if (!section.segments) continue;

    for (const reco of run.recommendations) {
      total++;
      const located = locateQuote(
        reco.transcriptExcerpt,
        section.segments,
        reco.spokenTitle,
      );
      if (!located) {
        // Placement failed, but the attribution question is independent of it.
        reco.attributionCued = reco.recommendedBy
          ? attributionIsCued(reco.recommendedBy, reco.timecodeS, section.segments)
          : false;
        continue;
      }
      if (!reco.timecodeExact) recovered++;
      if (located.startS !== reco.timecodeS) moved++;

      reco.timecodeS = located.startS;
      reco.timecodeExact = true;
      reco.attributionCued = reco.recommendedBy
        ? attributionIsCued(reco.recommendedBy, located.startS, section.segments)
        : false;
      reco.clipStartS = Math.max(0, located.startS - CLIP_LEAD_IN);
      reco.clipEndS = Math.max(located.endS + CLIP_TAIL, reco.clipStartS + CLIP_MIN);
      reco.timestampedUrl =
        `https://www.youtube.com/watch?v=${run.episodeId}&t=${reco.clipStartS}s`;
    }
    writeJson(join(RAW_RECOS, file), run);
  }

  console.log(
    `Re-placed ${total} recommendation(s): ${moved} moved, ` +
      `${recovered} recovered from a block-level guess.`,
  );
}

const { backend, source, batchSize, episodeIds } = parseCommonOptions(
  process.argv.slice(2),
);
const suffix = source === "whisper" ? ".whisper.json" : ".json";

if (process.argv.includes("--replace")) {
  replacePlacements(source, `${runSuffix(backend, source)}.json`);
  process.exit(0);
}

const available = readdirSync(SECTIONS)
  .filter((f) => f.endsWith(suffix) && f.includes(".whisper.") === (source === "whisper"))
  .map((f) => f.slice(0, f.length - suffix.length))
  .sort();
const requested = episodeIds.length > 0 ? episodeIds : available;

/* Skip episodes already extracted unless asked otherwise. Re-extracting is not just
   wasted budget: recommendation ids are positional, so a second pass can shuffle them
   and break the identification cache in step 5. */
const force = process.argv.includes("--force");
const targets = force
  ? requested
  : requested.filter(
      (id) => !existsSync(join(RAW_RECOS, `${id}${runSuffix(backend, source)}.json`)),
    );
const skipped = requested.length - targets.length;

const episodes = new Map(
  readJson<Episode[]>(join(WORK, "episodes.json")).map((e) => [e.id, e]),
);

ensureDir(RAW_RECOS);
console.log(
  `${backend.name} / ${backend.model} / ${source} — ` +
    `${targets.length} episode(s) to extract` +
    (skipped ? `, ${skipped} already done` : "") +
    `, batches of ${batchSize}\n`,
);
if (targets.length === 0) {
  console.log("Nothing to do. Use --force to re-extract.");
  process.exit(0);
}

const failedBatches: { episodes: string[]; error: string }[] = [];

for (const batch of chunk(targets, batchSize)) {
  const inputs = batch.map((episodeId) => {
    const section = readJson<Section>(join(SECTIONS, `${episodeId}${suffix}`));
    const episode = episodes.get(episodeId) ?? {
      id: episodeId,
      title: episodeId,
      durationS: 0,
      url: `https://www.youtube.com/watch?v=${episodeId}`,
    };
    return { episode, section };
  });

  const startedAt = Date.now();
  let perEpisode: RawRecommendation[][];
  try {
    perEpisode = await backend.extract(inputs);
  } catch (error) {
    // One bad batch must not cost the whole run; the episodes stay unextracted and
    // a later pass picks them up, since finished episodes are skipped.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  BATCH FAILED (${batch.join(", ")}): ${message.slice(0, 160)}\n`);
    failedBatches.push({ episodes: batch, error: message.slice(0, 400) });
    continue;
  }
  const elapsed = (Date.now() - startedAt) / 1000;

  inputs.forEach(({ episode, section }, i) => {
    const recommendations = (perEpisode[i] ?? []).map((raw, index) =>
      toRecommendation(raw, episode.id, index + 1, section),
    );

    const run: ExtractionRun = {
      episodeId: episode.id,
      backend: backend.name,
      model: backend.model,
      transcriptSource: source,
      durationS: Number((elapsed / inputs.length).toFixed(1)),
      recommendations,
    };
    const destination = join(
      RAW_RECOS,
      `${episode.id}${runSuffix(backend, source)}.json`,
    );
    writeJson(destination, run);

    console.log(`=== ${episode.id} — ${recommendations.length} recommendation(s)`);
    for (const reco of recommendations) {
      const flag = reco.timecodeExact ? "" : " (timecode snapped)";
      console.log(
        `  [${hms(reco.timecodeS)}]${flag} ${reco.kind.padEnd(15)} ` +
          `"${reco.title}" — by ${reco.recommendedBy || "?"} (conf ${reco.confidence})`,
      );
    }
  });
  console.log(`  ${elapsed.toFixed(0)}s for this batch\n`);
}

if (failedBatches.length > 0) {
  writeJson(join(WORK, "extract-failures.json"), failedBatches);
  console.log(
    `\n${failedBatches.length} batch(es) failed — listed in work/extract-failures.json. ` +
      `Re-run to retry them.`,
  );
}
