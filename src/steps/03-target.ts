/**
 * Step 3 — isolate the "recommendations" section of each episode.
 *
 * The hosts open the segment with a ritual phrase. We look for the last such marker
 * in the final 40% of the transcript and take everything from there (minus one block
 * of margin). Fallback: the last 15% by position.
 *
 * Output: work/sections/<id>.json
 */
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  ensureDir,
  readJson,
  SECTIONS,
  TRANSCRIPTS,
  WORK,
  writeJson,
} from "../lib/paths.ts";
import { hms } from "../lib/time.ts";
import type { Episode, Section, SectionMethod, TranscriptBlock } from "../types.ts";

/**
 * Below this, it is not an episode.
 *
 * The playlist also holds trailers, games and short interviews — a season teaser of
 * a few seconds, a 6-minute quiz. Real episodes run 40 minutes to 2.5 hours (median
 * 84 min), so the threshold is not a close call.
 */
const MIN_EPISODE_SECONDS = 30 * 60;

/**
 * Openers for the end-of-show segment, in French.
 *
 * The wording drifted a lot over five years — "une recommandation culturelle",
 * "une œuvre à recommander", "un artiste", even "un petit nanard à recommander" —
 * so the net is deliberately wide, built from the stem "recommand" that turned up
 * in 50 of the 52 episodes the first, narrower version missed.
 */
const MARKERS = [
  /recommand/i,
  /(?:tu as|vous avez|t'as|tu aurais)\b[^.?!]{0,60}\breco\b/i,
  /coup de c(?:oe|œ)ur/i,
  /c'est (?:bientôt |déjà )?la fin de (?:cette |l')émission/i,
];

/**
 * False friends for the stem above. "Envoyer une lettre recommandée" has nothing to
 * do with recommending a film, and it does occur mid-episode.
 */
const NOT_MARKERS = [/lettre[s]?\s+recommand/i, /(?:en|par)\s+recommandé/i];

/**
 * Hard ceiling on how much audio we hand to Whisper, in seconds.
 *
 * A share-based cap is wrong here: 25% of a two-hour episode is thirty minutes, and
 * the closing segment is never that long. Capping by wall-clock keeps long episodes
 * from dominating the transcription budget.
 */
const MAX_SECTION_SECONDS = 18 * 60;
const FALLBACK_SHARE = 0.85;

function isMarker(text: string): boolean {
  if (NOT_MARKERS.some((pattern) => pattern.test(text))) return false;
  return MARKERS.some((pattern) => pattern.test(text));
}

/** Drop leading blocks until the span fits under the ceiling. */
function trim(blocks: TranscriptBlock[]): TranscriptBlock[] {
  const end = blocks[blocks.length - 1].startS;
  let start = 0;
  while (start < blocks.length - 1 && end - blocks[start].startS > MAX_SECTION_SECONDS) {
    start++;
  }
  return blocks.slice(start);
}

export function findSection(blocks: TranscriptBlock[]): {
  blocks: TranscriptBlock[];
  method: SectionMethod;
} {
  const from = Math.floor(blocks.length * 0.6);

  for (let i = from; i < blocks.length; i++) {
    if (!isMarker(blocks[i].text)) continue;
    // One block of margin before the question that opens the segment.
    return { blocks: trim(blocks.slice(Math.max(0, i - 1))), method: "marker" };
  }
  return {
    blocks: trim(blocks.slice(Math.floor(blocks.length * FALLBACK_SHARE))),
    method: "position",
  };
}

ensureDir(SECTIONS);

const durations = new Map(
  readJson<Episode[]>(join(WORK, "episodes.json")).map((e) => [e.id, e.durationS]),
);
const counts = { marker: 0, position: 0, skipped: 0 };

for (const name of readdirSync(TRANSCRIPTS).filter((f) => f.endsWith(".json")).sort()) {
  const episodeId = name.replace(/\.json$/, "");

  const duration = durations.get(episodeId);
  if (duration !== undefined && duration < MIN_EPISODE_SECONDS) {
    console.log(`${episodeId}: skipped, ${Math.round(duration / 60)} min — not an episode`);
    counts.skipped++;
    // Clear anything a previous, less selective run left behind, so later steps
    // cannot pick it up.
    for (const stale of [`${episodeId}.json`, `${episodeId}.whisper.json`]) {
      rmSync(join(SECTIONS, stale), { force: true });
    }
    continue;
  }

  const blocks = readJson<TranscriptBlock[]>(join(TRANSCRIPTS, name));
  const { blocks: sectionBlocks, method } = findSection(blocks);
  counts[method]++;

  const section: Section = {
    episodeId,
    source: "youtube",
    method,
    startS: sectionBlocks[0].startS,
    blocks: sectionBlocks,
  };
  writeJson(join(SECTIONS, `${episodeId}.json`), section);

  const words = (bs: TranscriptBlock[]) =>
    bs.reduce((sum, b) => sum + b.text.split(/\s+/).length, 0);
  const share = words(sectionBlocks) / words(blocks);
  console.log(
    `${episodeId}: ${method} -> from ${hms(section.startS)} ` +
      `(${sectionBlocks.length} blocks, ~${words(sectionBlocks)} words, ` +
      `${(share * 100).toFixed(0)}% of the transcript)`,
  );
}

console.log(
  `\n${counts.marker} by marker, ${counts.position} by position fallback, ` +
    `${counts.skipped} skipped as non-episodes`,
);
