import episodesJson from "../data/episodes.json";
import overridesJson from "../data/overrides.json";
import recommendationsJson from "../data/recommendations.json";
import reviewJson from "../data/review.json";
import type { Episode, Recommendation, ReviewNote, WorkKind } from "../src/types";

/**
 * The catalogue, read straight from the JSON the pipeline commits.
 *
 * Importing rather than fetching means the data is part of the bundle, so a static
 * export can pre-render every route without a network round trip.
 */
export const EPISODES = episodesJson as Episode[];

/**
 * What people have said about what the pipeline produced.
 *
 * Both files live apart from `recommendations.json` for one reason: the pipeline
 * rewrites that file wholesale on every run, so anything edited there would be lost
 * the next time an episode is added. Merging at read time keeps the two apart — the
 * machine owns one file, people own the others, and neither overwrites the other.
 *
 * They are two files rather than one because they answer different questions.
 * An override says what an entry should contain; a verdict says whether it should
 * exist at all. Reviewing the catalogue also produces one line per entry, which would
 * bury the handful of hand-written corrections if both lived together.
 *
 * Keys prefixed with `_` are documentation inside the JSON, not data.
 */
function handEdited<T>(json: unknown): Record<string, T> {
  return Object.fromEntries(
    Object.entries(json as Record<string, T>).filter(
      ([id]) => !id.startsWith("_"),
    ),
  );
}

const OVERRIDES = handEdited<Partial<Recommendation>>(overridesJson);
const REVIEWS = handEdited<ReviewNote>(reviewJson);

export const RECOMMENDATIONS: Recommendation[] = (
  recommendationsJson as Recommendation[]
)
  .map((reco) => {
    const fix = OVERRIDES[reco.id];
    const verdict = REVIEWS[reco.id];
    if (!fix && !verdict) return reco;
    return {
      ...reco,
      ...fix,
      ...(verdict ? { status: verdict.status } : null),
      corrected: Boolean(fix),
      reviewed: Boolean(verdict),
    };
  })
  // A rejected entry leaves the catalogue rather than being hidden from the feed:
  // half-presence would still count it in a guest's tally and still answer on its own
  // URL, which is not what rejecting it means.
  .filter((reco) => reco.status !== "rejected");

/** How many entries a person has corrected, for the site to acknowledge. */
export const CORRECTION_COUNT = Object.keys(OVERRIDES).length;

/** How many a person has passed a verdict on — checked or thrown out. */
export const REVIEWED_COUNT = Object.keys(REVIEWS).length;

const EPISODE_BY_ID = new Map(EPISODES.map((episode) => [episode.id, episode]));

export const episodeOf = (reco: Recommendation): Episode | undefined =>
  EPISODE_BY_ID.get(reco.episodeId);

export const recoById = (id: string): Recommendation | undefined =>
  RECOMMENDATIONS.find((reco) => reco.id === id);

/** Guests, most prolific first — the order the story rail should use. */
export function guests(): { name: string; count: number; episodeId: string }[] {
  const tally = new Map<string, { count: number; episodeId: string }>();
  for (const reco of RECOMMENDATIONS) {
    if (!reco.recommendedBy) continue;
    const entry = tally.get(reco.recommendedBy);
    if (entry) entry.count++;
    else tally.set(reco.recommendedBy, { count: 1, episodeId: reco.episodeId });
  }
  return [...tally]
    .map(([name, rest]) => ({ name, ...rest }))
    .sort((a, b) => b.count - a.count);
}

export const kindsPresent = (): WorkKind[] => [
  ...new Set(RECOMMENDATIONS.map((reco) => reco.kind)),
];

export const byGuest = (name: string): Recommendation[] =>
  RECOMMENDATIONS.filter((reco) => reco.recommendedBy === name);

/** URL-safe guest name, so `/invite/kyan-khojandi` resolves back to the person. */
export const guestSlug = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const guestFromSlug = (slug: string): string | undefined =>
  guests().find((guest) => guestSlug(guest.name) === slug)?.name;

/**
 * The episode still, which is also the closest thing we have to a portrait.
 *
 * Only `maxresdefault` and `mqdefault` are true 16:9. `hqdefault` and `sddefault` are
 * 4:3 frames with the picture letterboxed inside, so they arrive with black bars
 * baked in — never use them for display.
 */
export const stillUrl = (episodeId: string, size: "max" | "mq" = "max"): string =>
  `https://i.ytimg.com/vi/${episodeId}/${size === "max" ? "maxresdefault" : "mqdefault"}.jpg`;

/** The bounds of a clip, so a correction in progress can be previewed unsaved. */
export type Clip = { startS: number; endS: number };

export const clipOf = (reco: Recommendation): Clip => ({
  startS: reco.clipStartS,
  endS: reco.clipEndS,
});

/** Plays exactly the recommendation, then stops. */
export const embedUrl = (reco: Recommendation, clip: Clip = clipOf(reco)): string =>
  `https://www.youtube-nocookie.com/embed/${reco.episodeId}` +
  `?start=${clip.startS}&end=${clip.endS}&rel=0&modestbranding=1&playsinline=1`;

/**
 * The same moment on YouTube proper, for where an embed cannot go.
 *
 * Derived rather than stored: it was a field on the recommendation until corrections
 * could move `clipStartS`, at which point a stored copy meant the player opened at the
 * corrected second while this link still pointed at the old one.
 */
export const timestampedUrl = (
  reco: Recommendation,
  clip: Clip = clipOf(reco),
): string => `https://www.youtube.com/watch?v=${reco.episodeId}&t=${clip.startS}s`;

export function hms(seconds: number): string {
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function formatDate(date?: string): string {
  if (!date || date.length !== 8) return "—";
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
