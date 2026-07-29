import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, derived from this file's location (no `__dirname` in ESM). */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const WORK = join(ROOT, "work");
export const SUBS = join(WORK, "subs");
export const TRANSCRIPTS = join(WORK, "transcripts");
export const SECTIONS = join(WORK, "sections");
export const AUDIO = join(WORK, "audio");
export const WHISPER_TMP = join(WORK, "whisper");
export const CACHE = join(WORK, "cache");
export const RAW_RECOS = join(WORK, "raw-recommendations");
export const DATA = join(ROOT, "data");
export const MODELS = join(ROOT, "models");

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}
