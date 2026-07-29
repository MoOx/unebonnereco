/**
 * Step 1 — list the latest episodes of the playlist and download their FR subtitles.
 *
 * Output:
 *   work/episodes.json       episode metadata
 *   work/subs/<id>.fr.json3  raw YouTube subtitles (json3, timecodes in ms)
 *
 * Usage: node src/steps/01-fetch.ts [count]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { ensureDir, readJson, SUBS, WORK, writeJson } from "../lib/paths.ts";
import { run } from "../lib/run.ts";
import type { Episode } from "../types.ts";

const PLAYLIST =
  "https://www.youtube.com/playlist?list=PLSkidoCR8oB3HDB-QSDlwGYbjeb5Ra4wG";

type FlatEntry = { id: string; title?: string; duration?: number };
type FullEntry = {
  upload_date?: string;
  description?: string;
  chapters?: { title?: string; start_time?: number }[];
};

async function listEpisodes(count: number): Promise<Episode[]> {
  const stdout = await run("yt-dlp", [
    "--flat-playlist",
    "--dump-json",
    "--playlist-items",
    `1-${count}`,
    PLAYLIST,
  ]);
  return stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const entry = JSON.parse(line) as FlatEntry;
      return {
        id: entry.id,
        title: entry.title ?? entry.id,
        durationS: Math.round(entry.duration ?? 0),
        url: `https://www.youtube.com/watch?v=${entry.id}`,
      } satisfies Episode;
    });
}

/** Fetch date and description — useful to identify guests. */
async function enrich(episode: Episode): Promise<void> {
  const stdout = await run("yt-dlp", ["--dump-json", "--skip-download", episode.url]);
  const entry = JSON.parse(stdout) as FullEntry;
  episode.date = entry.upload_date;
  episode.description = (entry.description ?? "").slice(0, 2000);
  episode.chapters = (entry.chapters ?? []).map((chapter) => ({
    title: chapter.title ?? "",
    startS: Math.round(chapter.start_time ?? 0),
  }));
}

async function fetchSubtitles(episode: Episode): Promise<boolean> {
  const destination = join(SUBS, `${episode.id}.fr.json3`);
  if (existsSync(destination)) {
    console.log("  subtitles already downloaded");
    return true;
  }
  await run("yt-dlp", [
    "--write-auto-subs",
    "--write-subs",
    "--sub-langs",
    "fr",
    "--skip-download",
    "--sub-format",
    "json3",
    "-o",
    join(SUBS, "%(id)s.%(ext)s"),
    episode.url,
  ]);
  return existsSync(destination);
}

const count = Number(process.argv[2] ?? 3);
ensureDir(SUBS);

const listed = await listEpisodes(count);
console.log(`${listed.length} episodes in the playlist\n`);

// Resume from a previous run: anything already fetched keeps its metadata.
const previous = new Map<string, Episode>();
if (existsSync(join(WORK, "episodes.json"))) {
  for (const episode of readJson<Episode[]>(join(WORK, "episodes.json"))) {
    if (episode.date) previous.set(episode.id, episode);
  }
}

const episodes: Episode[] = [];
const failures: { id: string; error: string }[] = [];

for (const [index, episode] of listed.entries()) {
  const progress = `${index + 1}/${listed.length}`;
  const known = previous.get(episode.id);
  if (known?.hasSubtitles) {
    episodes.push(known);
    continue;
  }

  try {
    console.log(`[${progress}] ${episode.id} — ${episode.title}`);
    await enrich(episode);
    episode.hasSubtitles = await fetchSubtitles(episode);
    console.log(
      `  duration=${episode.durationS}s date=${episode.date} subs=${episode.hasSubtitles}`,
    );
    episodes.push(episode);
  } catch (error) {
    // Playlists contain private and deleted videos; skipping one must not abort
    // a run of a hundred.
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`  SKIPPED ${episode.id}: ${message.slice(0, 120)}`);
    failures.push({ id: episode.id, error: message.slice(0, 300) });
  }

  // Write as we go, so an interruption never loses the work already done.
  writeJson(join(WORK, "episodes.json"), episodes);
}

console.log(
  `\n-> work/episodes.json — ${episodes.length} usable, ${failures.length} skipped`,
);
if (failures.length > 0) {
  writeJson(join(WORK, "fetch-failures.json"), failures);
  console.log("Skipped episodes listed in work/fetch-failures.json");
}
