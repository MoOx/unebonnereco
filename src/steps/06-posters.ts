/**
 * Step 6 — find cover art for each recommendation.
 *
 * Three catalogues, by kind: iTunes for music and podcasts, Open Library for books
 * and comics, TMDB for films, series and documentaries. Only TMDB needs a credential
 * (`TMDB_READ_TOKEN` in `.env.local`); without it that branch is skipped and the rest
 * still runs.
 *
 * Nothing about the identification step is touched: this only adds `posterUrl`.
 *
 * Output: rewrites data/recommendations.json in place.
 *
 * Usage: node src/steps/06-posters.ts [--refresh] [id ...]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { getJson, linkResolves } from "../lib/http.ts";
import { normalize } from "../lib/locate.ts";
import { DATA, readJson, writeJson } from "../lib/paths.ts";
import type { Recommendation, WorkKind } from "../types.ts";

type Poster = { url: string; source: NonNullable<Recommendation["posterSource"]> };

/**
 * Guard against confidently wrong art.
 *
 * A search for a mangled title happily returns *something*; without a check we would
 * staple an unrelated album cover onto a recommendation. Requiring that the found
 * title shares most of its words with ours is crude but catches the bad ones.
 */
function agree(wanted: string, found: string, threshold = 0.5): boolean {
  const a = new Set(normalize(wanted).split(" ").filter((w) => w.length > 2));
  const b = new Set(normalize(found).split(" ").filter((w) => w.length > 2));
  if (a.size === 0) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / a.size >= threshold;
}

/**
 * Decide whether a search hit really is the work we asked about.
 *
 * Two failure modes pull in opposite directions. Matching on title alone rejects
 * correct results catalogued under a translated title — Open Library answers "Les
 * Piliers de la Terre" with "The Pillars of the Earth". Accepting the top hit alone
 * staples an unrelated Swedish album onto a track called "Hannes". So: take a title
 * match wherever it exists, and otherwise trust the engine's own ranking only when
 * the author corroborates it.
 */
function isMatch(
  reco: Recommendation,
  foundTitle: string,
  foundCreator: string,
  rank: number,
): boolean {
  if (agree(reco.title, foundTitle)) return true;
  return rank === 0 && Boolean(reco.creator) && agree(reco.creator, foundCreator, 0.6);
}

type ITunesResponse = {
  results?: {
    trackName?: string;
    collectionName?: string;
    artistName?: string;
    artworkUrl100?: string;
  }[];
};

async function fromItunes(reco: Recommendation): Promise<Poster | null> {
  const term = encodeURIComponent(`${reco.title} ${reco.creator}`.trim());
  const media = reco.kind === "podcast" ? "podcast" : "music";
  const body = await getJson<ITunesResponse>(
    `https://itunes.apple.com/search?term=${term}&media=${media}&limit=3&country=FR`,
  );
  for (const [rank, hit] of (body.results ?? []).entries()) {
    const name = hit.collectionName ?? hit.trackName ?? "";
    if (!hit.artworkUrl100) continue;
    if (!isMatch(reco, name, hit.artistName ?? "", rank)) continue;
    // The API only ever offers a 100px thumbnail; the path takes any size.
    return { url: hit.artworkUrl100.replace("100x100", "600x600"), source: "itunes" };
  }
  return null;
}

type OpenLibraryResponse = {
  docs?: { title?: string; author_name?: string[]; cover_i?: number }[];
};

async function fromOpenLibrary(reco: Recommendation): Promise<Poster | null> {
  const q = encodeURIComponent(`${reco.title} ${reco.creator}`.trim());
  const body = await getJson<OpenLibraryResponse>(
    `https://openlibrary.org/search.json?q=${q}&limit=3&fields=title,author_name,cover_i`,
  );
  for (const [rank, doc] of (body.docs ?? []).entries()) {
    if (!doc.cover_i) continue;
    if (!isMatch(reco, doc.title ?? "", (doc.author_name ?? []).join(" "), rank)) continue;
    return {
      url: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
      source: "openlibrary",
    };
  }
  return null;
}

type TmdbResponse = {
  results?: {
    title?: string;
    name?: string;
    poster_path?: string | null;
    release_date?: string;
    first_air_date?: string;
  }[];
};

/**
 * Films, series and documentaries.
 *
 * The only source here that needs a credential: a TMDB read token in `.env.local`.
 * It is used at build time only — the published site reads the resulting URLs out of
 * `data/`, so the token never ships. Without it this simply returns nothing and the
 * other catalogues carry on.
 */
async function fromTmdb(reco: Recommendation): Promise<Poster | null> {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) return null;

  const query = encodeURIComponent(reco.title);
  // A documentary can be catalogued either way, so try both endpoints for it.
  const endpoints =
    reco.kind === "series"
      ? ["tv"]
      : reco.kind === "film"
        ? ["movie"]
        : ["movie", "tv"];

  for (const endpoint of endpoints) {
    const body = await getJson<TmdbResponse>(
      `https://api.themoviedb.org/3/search/${endpoint}?query=${query}&language=fr-FR`,
      { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } },
    );
    for (const [rank, hit] of (body.results ?? []).entries()) {
      const name = hit.title ?? hit.name ?? "";
      if (!hit.poster_path) continue;
      // TMDB has no author field to corroborate with, so the title has to carry it.
      if (!agree(reco.title, name) && !(rank === 0 && agree(name, reco.title))) continue;
      return { url: `https://image.tmdb.org/t/p/w500${hit.poster_path}`, source: "tmdb" };
    }
  }
  return null;
}

const LOOKUP: Partial<Record<WorkKind, (r: Recommendation) => Promise<Poster | null>>> = {
  music: fromItunes,
  podcast: fromItunes,
  book: fromOpenLibrary,
  comic: fromOpenLibrary,
  film: fromTmdb,
  series: fromTmdb,
  documentary: fromTmdb,
};

// Credentials live outside the repo; absence is not an error, it just narrows scope.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const only = args.filter((a) => !a.startsWith("--"));

const path = join(DATA, "recommendations.json");
const all = readJson<Recommendation[]>(path);

const targets = all.filter(
  (reco) =>
    LOOKUP[reco.kind] &&
    (refresh || !reco.posterUrl) &&
    (only.length === 0 || only.includes(reco.id)),
);

console.log(`${targets.length} recommendation(s) to look up\n`);

let found = 0;
let missing = 0;

for (const [index, reco] of targets.entries()) {
  const lookup = LOOKUP[reco.kind];
  if (!lookup) continue;
  const progress = `${index + 1}/${targets.length}`;
  try {
    const poster = await lookup(reco);
    // The catalogues sometimes reference art that has since gone: check before saving.
    if (poster && (await linkResolves(poster.url))) {
      reco.posterUrl = poster.url;
      reco.posterSource = poster.source;
      found++;
      console.log(`[${progress}] OK ${reco.kind.padEnd(8)} ${reco.title.slice(0, 40)}`);
    } else {
      missing++;
      console.log(`[${progress}] -- ${reco.kind.padEnd(8)} ${reco.title.slice(0, 40)}`);
    }
  } catch (error) {
    missing++;
    console.log(`[${progress}] ERR ${reco.title.slice(0, 40)}: ${error}`);
  }

  // Save periodically: this walks a few hundred entries over two public APIs.
  if (index % 20 === 19) writeJson(path, all);
}

writeJson(path, all);

const covered = all.filter((r) => r.posterUrl).length;
console.log(
  `\n${found} found, ${missing} without art. ` +
    `${covered}/${all.length} of the catalogue now has a cover.`,
);
