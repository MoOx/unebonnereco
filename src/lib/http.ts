import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CACHE, ensureDir } from "./paths.ts";
import { sleep } from "./run.ts";

/** Wikimedia rate-limits bursts from unidentified clients. */
const USER_AGENT = "unebonnereco/0.1 (https://github.com/MoOx/unebonnereco)";

/**
 * Check that a link actually resolves.
 *
 * A model can produce a confident, plausible, dead URL — during the proof of
 * concept it invented an ArteRadio page that 404s. This only proves the page
 * exists, not that it is the right one; judging that is the human review step.
 */
export async function linkResolves(url: string, timeoutMs = 20000): Promise<boolean> {
  const attempt = async (method: "HEAD" | "GET") => {
    // Hand-rolled rather than AbortSignal.timeout: this file is type-checked against
    // both the Node and the Expo lib sets, and only one of them declares it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        // Some sites serve 403 to unknown agents; look like a browser.
        headers: { "user-agent": "Mozilla/5.0 (compatible; unebonnereco/0.1)" },
      });
      return response.status;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let status = await attempt("HEAD");
    // Plenty of servers reject HEAD outright — retry properly before condemning.
    if (status === 405 || status === 501) status = await attempt("GET");
    return status >= 200 && status < 400;
  } catch {
    return false;
  }
}

/**
 * GET a JSON document, cached on disk.
 *
 * The cache is what makes re-runs cheap and keeps us well under Wikimedia's
 * rate limits; a 429 still happens on a cold cache, hence the backoff.
 */
export async function getJson<T>(
  url: string,
  { attempts = 5, headers = {} }: { attempts?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const dir = join(CACHE, "http");
  ensureDir(dir);
  const file = join(dir, `${createHash("sha1").update(url).digest("hex")}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, ...headers },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as T;
      writeFileSync(file, JSON.stringify(body), "utf8");
      await sleep(1000); // stay polite on a cold cache
      return body;
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      const wait = 5000 * (attempt + 1);
      console.log(`    retry ${attempt + 1}/${attempts - 1} in ${wait / 1000}s — ${error}`);
      await sleep(wait);
    }
  }
  throw new Error("unreachable");
}
