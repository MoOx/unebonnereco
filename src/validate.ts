/**
 * Gate for the two files people edit by hand: data/overrides.json and data/review.json.
 *
 * Both are merged into the catalogue at read time, silently — an override on an id
 * that does not exist changes nothing and reports nothing, so a typo in a correction
 * looks exactly like a correction that worked. That is tolerable while the only
 * person editing them is the one who wrote the merge, and not tolerable once
 * corrections arrive from readers. This turns every one of those silent no-ops into a
 * failed check on the pull request.
 *
 * Run: `npm run validate`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DATA } from "./lib/paths.ts";
import { WORK_KINDS } from "./types.ts";
import type { Episode, Recommendation, ReviewNote } from "./types.ts";

/** A field check returns the reason it failed, or null when it holds. */
type Check = (value: unknown) => string | null;

const isString: Check = (v) =>
  typeof v === "string" ? null : "doit être une chaîne";

const isFilledString: Check = (v) =>
  typeof v === "string" && v.trim() !== "" ? null : "doit être une chaîne non vide";

const isBoolean: Check = (v) =>
  typeof v === "boolean" ? null : "doit être true ou false";

const isSecond: Check = (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0
    ? null
    : "doit être un entier de secondes ≥ 0";

const isConfidence: Check = (v) =>
  typeof v === "number" && v >= 0 && v <= 1 ? null : "doit être entre 0 et 1";

const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    typeof v === "string" && values.includes(v)
      ? null
      : `doit être l'une de : ${values.join(", ")}`;

/**
 * A link has to be fetchable as-is.
 *
 * The pipeline already demotes a 404 to a search URL before publishing, so a
 * correction that reintroduces a dead or malformed link would quietly undo that work.
 * This only checks the shape; whether the page answers is a question for the network,
 * which this deliberately does not touch.
 */
const isHttpsUrl: Check = (v) => {
  if (typeof v !== "string") return "doit être une chaîne";
  try {
    return new URL(v).protocol === "https:" ? null : "doit être en https";
  } catch {
    return "doit être une URL valide";
  }
};

const isStringArray: Check = (v) =>
  Array.isArray(v) && v.every((item) => typeof item === "string")
    ? null
    : "doit être une liste de chaînes";

/**
 * What a correction is allowed to touch.
 *
 * An allowlist rather than a denylist: the merge is a spread, so any key landing in
 * this file ends up on the published entry, including one nothing reads. Listing what
 * is meaningful keeps a malformed contribution from inventing fields.
 */
const OVERRIDE_FIELDS: Record<string, Check> = {
  title: isFilledString,
  spokenTitle: isString,
  creator: isString,
  kind: oneOf(WORK_KINDS),
  recommendedBy: isString,
  attributionCued: isBoolean,
  timecodeS: isSecond,
  timecodeExact: isBoolean,
  clipStartS: isSecond,
  clipEndS: isSecond,
  transcriptExcerpt: isString,
  description: isString,
  link: isHttpsUrl,
  linkSource: oneOf(["reference", "search", "none"]),
  posterUrl: isHttpsUrl,
  posterSource: oneOf(["itunes", "openlibrary", "tmdb"]),
  confidence: isConfidence,
  candidates: isStringArray,
  note: isString,
};

/** Fields a correction must not carry, and why, so the error can say so. */
const OVERRIDE_REFUSED: Record<string, string> = {
  id: "c'est la clé du merge — corriger l'id détacherait la correction de sa fiche",
  episodeId: "l'épisode est la source, pas une donnée corrigeable",
  status: "un verdict se pose dans review.json, pas ici",
  corrected: "posé automatiquement à la lecture",
  reviewed: "posé automatiquement à la lecture",
  timestampedUrl: "dérivé de clipStartS à la lecture — ne plus le stocker",
};

const REVIEW_FIELDS: Record<string, Check> = {
  status: oneOf(["published", "rejected"]),
  at: (v) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? null
      : "doit être une date AAAA-MM-JJ",
  by: isString,
  reason: isString,
};

/** A trimmed clip still has to be a passage of the episode. */
const CLIP_MIN_S = 5;
const CLIP_MAX_S = 600;

const errors: string[] = [];
const fail = (where: string, message: string) =>
  errors.push(`${where} — ${message}`);

function readData<T>(name: string): { parsed: T; raw: string } {
  const raw = readFileSync(join(DATA, name), "utf8");
  return { parsed: JSON.parse(raw) as T, raw };
}

/**
 * JSON keeps the last of two identical keys and says nothing.
 *
 * Which is precisely how a second correction to the same entry would erase the first
 * — the kind of thing that has to be caught in review, since both lines are visible
 * in the diff and only one of them is in effect.
 */
function duplicateKeys(raw: string): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const match of raw.matchAll(/^ {2}"([^"]+)":/gm)) {
    const key = match[1];
    if (seen.has(key)) twice.add(key);
    seen.add(key);
  }
  return [...twice];
}

/** Documentation lives inside the JSON under `_`-prefixed keys; skip those. */
const entriesOf = (parsed: Record<string, unknown>): [string, unknown][] =>
  Object.entries(parsed).filter(([key]) => !key.startsWith("_"));

const { parsed: recommendations } = readData<Recommendation[]>(
  "recommendations.json",
);
const { parsed: episodes } = readData<Episode[]>("episodes.json");
const { parsed: overrides, raw: overridesRaw } =
  readData<Record<string, unknown>>("overrides.json");
const { parsed: review, raw: reviewRaw } =
  readData<Record<string, unknown>>("review.json");

const RECO_BY_ID = new Map(recommendations.map((reco) => [reco.id, reco]));
const DURATION_BY_EPISODE = new Map(
  episodes.map((episode) => [episode.id, episode.durationS]),
);

for (const [file, raw] of [
  ["overrides.json", overridesRaw],
  ["review.json", reviewRaw],
] as const) {
  for (const key of duplicateKeys(raw)) {
    fail(`${file} › ${key}`, "cette clé apparaît deux fois — la première est perdue");
  }
}

for (const [id, value] of entriesOf(overrides)) {
  const where = `overrides.json › ${id}`;
  const base = RECO_BY_ID.get(id);

  if (!base) {
    fail(where, "aucune recommandation ne porte cet id — la correction ne s'applique à rien");
    continue;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(where, "doit être un objet de champs à corriger");
    continue;
  }

  const fix = value as Record<string, unknown>;
  if (Object.keys(fix).length === 0) {
    fail(where, "correction vide — retirer l'entrée plutôt que de la laisser sans effet");
  }

  for (const [field, fieldValue] of Object.entries(fix)) {
    const refused = OVERRIDE_REFUSED[field];
    if (refused) {
      fail(`${where}.${field}`, `champ interdit : ${refused}`);
      continue;
    }
    const check = OVERRIDE_FIELDS[field];
    if (!check) {
      fail(`${where}.${field}`, "champ inconnu — rien ne le lit");
      continue;
    }
    const problem = check(fieldValue);
    if (problem) fail(`${where}.${field}`, problem);
  }

  // The clip is checked on the merged entry, not on the correction: someone moving
  // only the end of a passage never restates where it starts.
  const merged = { ...base, ...fix } as Recommendation;
  const length = merged.clipEndS - merged.clipStartS;
  if (length < CLIP_MIN_S) {
    fail(where, `le passage dure ${length}s — il en faut au moins ${CLIP_MIN_S}`);
  }
  if (length > CLIP_MAX_S) {
    fail(where, `le passage dure ${length}s — au-delà de ${CLIP_MAX_S} ce n'est plus un extrait`);
  }
  const duration = DURATION_BY_EPISODE.get(merged.episodeId);
  if (duration !== undefined && merged.clipStartS >= duration) {
    fail(where, `le passage commence à ${merged.clipStartS}s, après la fin de l'épisode (${duration}s)`);
  }
  if (merged.timecodeS < merged.clipStartS || merged.timecodeS > merged.clipEndS) {
    fail(where, "timecodeS tombe hors du passage — corriger les deux ensemble");
  }
}

for (const [id, value] of entriesOf(review)) {
  const where = `review.json › ${id}`;

  if (!RECO_BY_ID.has(id)) {
    fail(where, "aucune recommandation ne porte cet id — le verdict ne s'applique à rien");
    continue;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(where, "doit être un objet { status, at, by, reason }");
    continue;
  }

  const note = value as Record<string, unknown>;
  if (!("status" in note)) fail(where, "il manque status");

  for (const [field, fieldValue] of Object.entries(note)) {
    const check = REVIEW_FIELDS[field];
    if (!check) {
      fail(`${where}.${field}`, "champ inconnu — rien ne le lit");
      continue;
    }
    const problem = check(fieldValue);
    if (problem) fail(`${where}.${field}`, problem);
  }

  if ((note as Partial<ReviewNote>).status === "rejected" && !note.reason) {
    fail(where, "un rejet doit dire pourquoi — la fiche disparaît du catalogue");
  }
}

const corrected = entriesOf(overrides).length;
const reviewed = entriesOf(review).length;

if (errors.length > 0) {
  console.error(`${errors.length} problème(s) dans les données corrigées à la main :\n`);
  for (const error of errors) console.error(`  ✗ ${error}`);
  console.error("");
  process.exit(1);
}

console.log(
  `Données valides : ${corrected} correction(s), ${reviewed} verdict(s), ` +
    `sur ${recommendations.length} recommandations.`,
);
