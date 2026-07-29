/**
 * Step 3b — re-transcribe the targeted section with Whisper.
 *
 * YouTube auto-captions mangle proper nouns, which are exactly what we want to
 * extract. So we re-transcribe ONLY the recommendation section already located
 * (~10 min of audio instead of 90), with whisper.cpp large-v3-turbo.
 *
 * yt-dlp downloads just that slice (`--download-sections`): ~8 MB per episode
 * instead of ~70 MB, which over a full back catalogue is the difference between
 * 1 GB and 8 GB. The clip is deleted once transcribed unless --keep-audio.
 *
 * Requires: brew install whisper-cpp + models/ggml-large-v3-turbo.bin
 * Output:   work/sections/<id>.whisper.json
 *
 * Usage: node src/steps/03b-whisper.ts [--keep-audio] [--force] [--full-speed]
 *                                      [--cookies <browser>] [episodeId ...]
 */
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  AUDIO,
  MODELS,
  SECTIONS,
  WHISPER_TMP,
  WORK,
  ensureDir,
  readJson,
  writeJson,
} from "../lib/paths.ts";
import { run, runInherit, sleep } from "../lib/run.ts";
import { hms } from "../lib/time.ts";
import type { Episode, Section, TranscriptBlock } from "../types.ts";
import { group } from "./02-transcript.ts";

const MODEL = join(MODELS, "ggml-large-v3-turbo.bin");

/** Priming text: steers decoding towards the show's vocabulary. */
const PROMPT =
  "Un Bon Moment, le podcast de Kyan Khojandi et Navo. Recommandations culturelles : " +
  "films, séries, livres, BD, podcasts, spectacles.";

type WhisperJson = {
  transcription: { offsets: { from: number }; text: string }[];
};

/**
 * Read whisper.cpp's own segments, shifted onto the episode timeline.
 *
 * These are roughly one sentence each — fine enough to time a link to the second,
 * unlike the 45 s blocks the model reads.
 */
function readSegments(path: string, offsetS: number): TranscriptBlock[] {
  const data = JSON.parse(readFileSync(path, "utf8")) as WhisperJson;
  return data.transcription
    .map((segment) => ({
      startS: Math.round(segment.offsets.from / 1000 + offsetS),
      text: segment.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((line) => line.text.length > 0);
}

/**
 * Download only the section as mp3.
 *
 * The "sec_" prefix on every derived filename matters: some YouTube ids start with
 * "-" and both yt-dlp's output template and whisper-cli would read the bare name as
 * an option.
 */
async function downloadSection(
  episodeId: string,
  startS: number,
  endS: number,
  options: { cookiesFrom?: string; attempts?: number } = {},
): Promise<string> {
  ensureDir(AUDIO);
  const mp3 = join(AUDIO, `sec_${episodeId}.mp3`);
  if (existsSync(mp3)) return mp3;

  const args = [
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "5",
    "--download-sections",
    `*${Math.floor(startS)}-${Math.ceil(endS)}`,
    // Pace ourselves: hammering the API is what earns a 403 in the first place.
    "--sleep-requests",
    "1",
    "--retries",
    "5",
    // Give up on a silent socket rather than waiting on it forever.
    "--socket-timeout",
    "30",
    "-o",
    join(AUDIO, `sec_${episodeId}.%(ext)s`),
    `https://www.youtube.com/watch?v=${episodeId}`,
  ];
  if (options.cookiesFrom) args.unshift("--cookies-from-browser", options.cookiesFrom);

  // YouTube hands out 403s under load; they clear on their own given a pause, so a
  // failure here is worth retrying before writing the episode off.
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Long episodes take a while to seek; ten minutes is generous but finite.
      await run("yt-dlp", args, { timeoutMs: 10 * 60 * 1000 });
      return mp3;
    } catch (error) {
      if (attempt === attempts) throw error;
      const wait = 20000 * attempt;
      console.log(`  download failed, retrying in ${wait / 1000}s (${attempt}/${attempts - 1})`);
      await sleep(wait);
    }
  }
  return mp3;
}

/** whisper.cpp wants 16 kHz mono PCM. */
async function toWav(mp3: string, episodeId: string): Promise<string> {
  ensureDir(WHISPER_TMP);
  const wav = join(WHISPER_TMP, `sec_${episodeId}.wav`);
  await run("ffmpeg", [
    "-y",
    "-i",
    mp3,
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    wav,
  ], { timeoutMs: 5 * 60 * 1000 });
  return wav;
}

async function transcribe(
  wav: string,
  episodeId: string,
  offsetS: number,
  gentle: boolean,
): Promise<{ startS: number; text: string }[]> {
  const base = join(WHISPER_TMP, `sec_${episodeId}`);
  const whisperArgs = [
    "-m",
    MODEL,
    "-f",
    wav,
    "-l",
    "fr",
    "--prompt",
    PROMPT,
    "-oj",
    "-of",
    base,
    "-pp",
    // Whisper otherwise takes every core and makes the machine unusable. Half the
    // threads roughly halves the impact for a modest slowdown, since the heavy
    // lifting is on the GPU anyway.
    "-t",
    gentle ? "4" : "8",
  ];
  // `nice` keeps the run in the background of whatever else is happening.
  await runInherit(
    gentle ? "nice" : "whisper-cli",
    gentle ? ["-n", "19", "whisper-cli", ...whisperArgs] : whisperArgs,
  );
  return readSegments(`${base}.json`, offsetS);
}

const args = process.argv.slice(2);
const keepAudio = args.includes("--keep-audio");
const force = args.includes("--force");
/**
 * Optional browser to lift YouTube cookies from, e.g. `--cookies safari`.
 *
 * Off by default on purpose: bulk downloading against an authenticated session is
 * what gets an account flagged, and the 403s we see are transient throttling that
 * retries already clear. Reach for this only if specific episodes keep failing.
 */
const cookiesFrom = (() => {
  const at = args.indexOf("--cookies");
  return at >= 0 ? args[at + 1] : undefined;
})();

/** Gentle by default: this runs for hours and the machine stays in use. */
const gentle = !args.includes("--full-speed");
/** Breathing room between episodes so the GPU is not pegged continuously. */
const PAUSE_MS = gentle ? 3000 : 0;
const requested = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--cookies");

const episodeIds =
  requested.length > 0
    ? requested
    : readdirSync(SECTIONS)
        .filter((f) => f.endsWith(".json") && !f.includes(".whisper."))
        .map((f) => f.replace(/\.json$/, ""))
        .sort();

const durations = new Map(
  readJson<Episode[]>(join(WORK, "episodes.json")).map((e) => [e.id, e.durationS]),
);

const failures: { episodeId: string; error: string }[] = [];
let done = 0;
let skipped = 0;
let upgraded = 0;

for (const [index, episodeId] of episodeIds.entries()) {
  const output = join(SECTIONS, `${episodeId}.whisper.json`);
  const input = join(SECTIONS, `${episodeId}.json`);
  if (!existsSync(input)) continue; // filtered out as a non-episode by step 3

  if (!force && existsSync(output)) {
    // A cached transcript of the wrong span is worse than no cache: if the targeting
    // step has since moved the section, redo it rather than silently keeping stale text.
    const cached = readJson<Section>(output);
    const current = readJson<Section>(input).startS;
    if (cached.startS === current) {
      // Sections transcribed before segments were stored can be upgraded from
      // Whisper's own output, which we keep — no need to run the model again.
      if (!cached.segments) {
        const raw = join(WHISPER_TMP, `sec_${episodeId}.json`);
        if (existsSync(raw)) {
          const segments = readSegments(raw, cached.startS);
          writeJson(output, { ...cached, segments });
          console.log(`[${episodeId}] segments back-filled (${segments.length})`);
          upgraded++;
          continue;
        }
      }
      skipped++;
      continue;
    }
    console.log(`[${episodeId}] section moved (${cached.startS}s -> ${current}s), re-transcribing`);
  }

  const progress = `${index + 1}/${episodeIds.length}`;
  try {
    const base = readJson<Section>(join(SECTIONS, `${episodeId}.json`));
    const endS = durations.get(episodeId) ?? base.blocks[base.blocks.length - 1].startS + 120;
    console.log(`[${progress}] ${episodeId} — section ${hms(base.startS)}–${hms(endS)}`);

    const mp3 = await downloadSection(episodeId, base.startS, endS, { cookiesFrom });
    const wav = await toWav(mp3, episodeId);
    const segments = await transcribe(wav, episodeId, base.startS, gentle);
    const blocks = group(segments);

    if (blocks.length === 0) throw new Error("Whisper returned nothing");

    writeJson(output, {
      episodeId,
      source: "whisper",
      method: base.method,
      startS: base.startS,
      blocks,
      segments,
    } satisfies Section);

    const words = blocks.reduce((sum, b) => sum + b.text.split(/\s+/).length, 0);
    console.log(`  -> ${blocks.length} blocks, ~${words} words`);
    done++;

    // Reclaim the disk as we go — the transcript is what we actually needed.
    if (!keepAudio) {
      rmSync(mp3, { force: true });
      rmSync(wav, { force: true });
    }
  } catch (error) {
    // One bad episode must not kill a multi-hour run; record it and carry on.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAILED ${episodeId}: ${message}`);
    failures.push({ episodeId, error: message });
  }

  if (PAUSE_MS > 0) await sleep(PAUSE_MS);
}

console.log(
  `\n${done} transcribed, ${upgraded} back-filled, ${skipped} already done, ` +
    `${failures.length} failed`,
);
if (failures.length > 0) {
  writeJson(join(WORK, "whisper-failures.json"), failures);
  console.log("Failed episodes listed in work/whisper-failures.json — re-run to retry.");
}
