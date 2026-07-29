/**
 * Step 2 — turn json3 subtitles into a timecoded transcript.
 *
 * YouTube auto-captions come as "rolling captions": each event repeats the tail of
 * the previous one. We de-duplicate, then group into blocks of about BLOCK_SECONDS.
 *
 * Output:
 *   work/transcripts/<id>.json  TranscriptBlock[]
 *   work/transcripts/<id>.txt   [HH:MM:SS] text, for human inspection
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ensureDir, SUBS, TRANSCRIPTS, writeJson } from "../lib/paths.ts";
import { hms } from "../lib/time.ts";
import type { TranscriptBlock } from "../types.ts";

const BLOCK_SECONDS = 45;

type Json3 = {
  events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
};

function readJson3(path: string): { startS: number; text: string }[] {
  const data = JSON.parse(readFileSync(path, "utf8")) as Json3;
  const lines: { startS: number; text: string }[] = [];
  for (const event of data.events ?? []) {
    if (!event.segs) continue;
    const text = event.segs
      .map((seg) => seg.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text === "[musique]") continue;
    // Rolling captions: skip a line identical to the previous one.
    if (lines.length > 0 && lines[lines.length - 1].text === text) continue;
    lines.push({ startS: (event.tStartMs ?? 0) / 1000, text });
  }
  return lines;
}

export function group(
  lines: { startS: number; text: string }[],
  blockSeconds = BLOCK_SECONDS,
): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let current: string[] = [];
  let start: number | null = null;

  for (const line of lines) {
    if (start === null) start = line.startS;
    if (line.startS - start >= blockSeconds && current.length > 0) {
      blocks.push({ startS: Math.floor(start), text: current.join(" ") });
      current = [];
      start = line.startS;
    }
    current.push(line.text);
  }
  if (current.length > 0 && start !== null) {
    blocks.push({ startS: Math.floor(start), text: current.join(" ") });
  }
  return blocks;
}

ensureDir(TRANSCRIPTS);

for (const name of readdirSync(SUBS).filter((f) => f.endsWith(".fr.json3")).sort()) {
  const videoId = name.slice(0, name.indexOf(".fr.json3"));
  const blocks = group(readJson3(join(SUBS, name)));

  writeJson(join(TRANSCRIPTS, `${videoId}.json`), blocks);
  writeFileSync(
    join(TRANSCRIPTS, `${videoId}.txt`),
    blocks.map((b) => `[${hms(b.startS)}] ${b.text}`).join("\n"),
    "utf8",
  );

  const words = blocks.reduce((sum, b) => sum + b.text.split(/\s+/).length, 0);
  const last = blocks[blocks.length - 1];
  console.log(
    `${videoId}: ${blocks.length} blocks, ~${words} words, ends at ${hms(last.startS)}`,
  );
}
