/**
 * Step 5 — resolve each recommendation to a real work, with a description and link.
 *
 * The two backends invert the problem differently, on purpose:
 *   - ollama searches Wikipedia first and only asks the model to *choose* among real
 *     candidates, because an 8–14B model does not know the catalogue and invents.
 *   - claude-code asks directly and lets the model search the web, because it does
 *     know the catalogue and can verify a link.
 *
 * Output: data/recommendations.json + data/episodes.json
 *
 * Usage: node src/steps/05-enrich.ts [--backend claude-code|ollama] [--model X]
 *                                    [--source whisper|youtube] [--batch N]
 *                                    [--refresh] [episodeId ...]
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { IdentifyInput, IdentifyResult } from "../backends/types.ts";
import { chunk, parseCommonOptions, runSuffix } from "../lib/cli.ts";
import { linkResolves } from "../lib/http.ts";
import { DATA, RAW_RECOS, readJson, WORK, writeJson } from "../lib/paths.ts";
import { searchUrl } from "../lib/wikipedia.ts";
import type { Episode, ExtractionRun, Recommendation } from "../types.ts";

const { backend, source, batchSize, episodeIds } = parseCommonOptions(
  process.argv.slice(2),
);
/** Identification is the expensive step, so re-runs reuse what is already resolved. */
const refresh = process.argv.includes("--refresh");
const suffix = `${runSuffix(backend, source)}.json`;

const files = readdirSync(RAW_RECOS)
  .filter((f) => f.endsWith(suffix))
  .filter((f) => episodeIds.length === 0 || episodeIds.includes(f.slice(0, f.length - suffix.length)))
  .sort();
if (files.length === 0) {
  console.error(`No *${suffix} file in ${RAW_RECOS} — run 04-extract.ts first.`);
  process.exit(1);
}

const all: Recommendation[] = [];
for (const file of files) {
  const run = readJson<ExtractionRun>(join(RAW_RECOS, file));
  console.log(`\n=== ${run.episodeId} (${run.recommendations.length} recommendations)`);
  all.push(...run.recommendations);
}

/* Anything already resolved in a previous run is reused verbatim: identification is
   what costs, and a settled entry does not benefit from being asked again. */
const previous = new Map<string, Recommendation>();
const publishedPath = join(DATA, "recommendations.json");
if (!refresh && existsSync(publishedPath)) {
  for (const reco of readJson<Recommendation[]>(publishedPath)) {
    previous.set(reco.id, reco);
  }
}

const pending = all.filter((reco) => !previous.get(reco.id)?.linkSource);
console.log(
  `\n${all.length - pending.length} already resolved, identifying ${pending.length} work(s) ` +
    `with ${backend.name} / ${backend.model}, batches of ${batchSize}\n`,
);

const MARK = { reference: "OK", search: "~~", none: "--" } as const;
let dead = 0;

/**
 * Drop links that do not resolve.
 *
 * A model can produce a confident, plausible, dead URL, so nothing is published
 * unverified. This runs per batch rather than at the end: a saved batch must already
 * be trustworthy, otherwise an interrupted run would cache links nobody checked.
 */
async function verify(results: IdentifyResult[]): Promise<void> {
  for (const result of results) {
    if (result.linkSource !== "reference" || !result.link) continue;
    if (await linkResolves(result.link)) continue;
    dead++;
    console.log(`  dead link dropped: ${result.link}`);
    result.linkSource = "search";
    result.link = searchUrl(`${result.title} ${result.creator}`.trim());
    result.confidence = Math.min(result.confidence, 0.4);
  }
}

const resolved = new Map<string, IdentifyResult>();
let batchNo = 0;
const batches = chunk(pending, batchSize);
for (const batch of batches) {
  batchNo++;
  const answers = await backend.identify(
    batch.map((reco) => ({
      spokenTitle: reco.spokenTitle,
      kind: reco.kind,
      creator: reco.creator,
      recommendedBy: reco.recommendedBy,
      excerpt: reco.transcriptExcerpt,
    })),
  );
  batch.forEach((reco, i) => {
    const answer = answers[i];
    if (answer) resolved.set(reco.id, answer);
  });
  await verify(answers.filter((a) => a !== undefined));
  // Save as we go. This run takes tens of minutes; an interruption should cost the
  // current batch, not the whole thing, and the cache above then resumes from here.
  applyAndSave();
  console.log(`  batch ${batchNo}/${batches.length} saved (${resolved.size} resolved)`);
}

/**
 * Fields owned by later steps.
 *
 * This step rebuilds the published file from the raw extractions, so anything added
 * downstream would be silently dropped — step 6's cover art was, once. Carrying them
 * across keeps the steps independent and re-runnable in any order.
 */
const DOWNSTREAM_FIELDS = ["posterUrl", "posterSource"] as const;

function carryDownstream() {
  for (const reco of all) {
    const before = previous.get(reco.id);
    if (!before) continue;
    for (const field of DOWNSTREAM_FIELDS) {
      if (before[field] !== undefined) {
        (reco[field] as unknown) = before[field];
      }
    }
  }
}

function applyAndSave() {
  applyResults();
  carryDownstream();
  writeJson(join(DATA, "recommendations.json"), all);
}

function applyResults() {
  all.forEach((reco) => {
  const carried = previous.get(reco.id);
  if (carried?.linkSource) {
    // Keep the settled identification, but take the newer placement from step 4.
    Object.assign(reco, {
      title: carried.title,
      creator: carried.creator,
      description: carried.description,
      link: carried.link,
      linkSource: carried.linkSource,
      candidates: carried.candidates,
      status: carried.status,
      confidence: Math.min(reco.confidence, carried.confidence),
    });
    return;
  }
  const result = resolved.get(reco.id);
  if (!result) return;
  reco.title = result.title || reco.title;
  reco.creator = result.creator || reco.creator;
  reco.description = result.description;
  reco.link = result.link;
  reco.linkSource = result.linkSource;
  // Neither stage alone can vouch for the entry: keep the lower of the two.
  reco.confidence = Number(Math.min(reco.confidence, result.confidence).toFixed(2));
  if (result.candidates) reco.candidates = result.candidates;

  });
}

applyAndSave();
for (const reco of all) {
  console.log(
    `  ${MARK[reco.linkSource ?? "none"]} "${reco.spokenTitle}" -> "${reco.title}" ` +
      `(conf ${reco.confidence}) ${reco.link ?? ""}`,
  );
}

// The site does not need the raw description blob, only the episode identity.
const episodes = readJson<Episode[]>(join(WORK, "episodes.json")).map(
  ({ description, ...rest }) => rest,
);
writeJson(join(DATA, "episodes.json"), episodes);

const withPage = all.filter((r) => r.linkSource === "reference").length;
console.log(`\n${dead} dead link(s) dropped during this run`);
console.log(
  `\n-> data/recommendations.json: ${all.length} recommendations, ` +
    `${withPage} with a reference page, ${all.length - withPage} without`,
);
