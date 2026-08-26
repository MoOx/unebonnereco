import type { Recommendation } from "../src/types";

/**
 * Getting a reader's correction to where it can be merged.
 *
 * The shape of what travels mirrors the two files it ends up in — `overrides` for
 * what an entry should contain, `review` for whether it should exist — so applying a
 * contribution is a copy into each, with no interpretation in between. That is the
 * point: these corrections exist because a machine guessed wrong, and running them
 * back through a second guess would be a strange way to fix that.
 *
 * It leaves the page one way: posted to the worker below, which files it as an issue
 * and hands back its address. There is deliberately no second route — a `mailto:`
 * fallback was written first and removed, because a fallback to an address nobody
 * reads is worse than no fallback: it looks like it worked.
 */

/**
 * The endpoint that files a correction, or an empty string while there is none.
 *
 * Empty is a supported state: the form does not appear at all, rather than offering
 * to send somewhere that cannot receive. Set it to the worker's address once that is
 * deployed — a workers.dev subdomain or a custom hostname, either works.
 */
export const SUBMIT_URL = "";

/**
 * Where the entry lives, so a correction can be checked against what it corrects.
 *
 * Built from the id rather than read off the browser, because these pages are
 * pre-rendered at build time, where there is no location to read.
 */
export const SITE = "https://moox.github.io/unebonnereco";

export const pageUrl = (reco: Recommendation): string =>
  `${SITE}/reco/${reco.id}`;

/** What a person is proposing, in the shape of the files it lands in. */
export type Contribution = {
  id: string;
  /** Field corrections, destined for data/overrides.json. */
  overrides?: Partial<Recommendation>;
  /** A verdict on the entry itself, destined for data/review.json. */
  review?: { status: "rejected"; reason?: string };
  /** Free text: why, or anything the fields cannot hold. */
  note?: string;
  /** Who to credit, when they want to be. */
  by?: string;
};

/** The fields a reader can correct from the page, in the order the form shows them. */
export const CORRECTABLE = [
  "title",
  "creator",
  "kind",
  "recommendedBy",
  "attributionCued",
  "link",
  "clipStartS",
  "clipEndS",
] as const;

export type CorrectableField = (typeof CORRECTABLE)[number];

/** A draft holds every correctable field; only what differs is submitted. */
export type Draft = Pick<Recommendation, CorrectableField>;

export const draftOf = (reco: Recommendation): Draft => ({
  title: reco.title,
  creator: reco.creator,
  kind: reco.kind,
  recommendedBy: reco.recommendedBy,
  attributionCued: Boolean(reco.attributionCued),
  link: reco.link,
  clipStartS: reco.clipStartS,
  clipEndS: reco.clipEndS,
});

/**
 * What the reader actually changed.
 *
 * Only differing fields travel, because an override is a patch: restating the fields
 * that were already right would freeze today's values against a later pipeline run
 * that improves them.
 */
export function changedFields(reco: Recommendation, draft: Draft): CorrectableField[] {
  const before = draftOf(reco);
  return CORRECTABLE.filter((field) => {
    const was = before[field];
    const now = draft[field];
    // An empty string and an absent field mean the same thing here, and the form can
    // only produce the former.
    if (!was && !now) return false;
    return was !== now;
  });
}

export function contributionOf(
  reco: Recommendation,
  draft: Draft,
  { note, by, rejected }: { note?: string; by?: string; rejected?: boolean },
): Contribution {
  const fields = changedFields(reco, draft);
  const contribution: Contribution = { id: reco.id };

  if (fields.length > 0) {
    const overrides: Record<string, unknown> = {};
    for (const field of fields) overrides[field] = draft[field];
    contribution.overrides = overrides as Partial<Recommendation>;
  }
  // A rejection is not a correction: an entry that should not exist has no fields
  // worth fixing, so it travels alone with its reason.
  if (rejected) contribution.review = { status: "rejected", reason: note?.trim() };
  if (note?.trim()) contribution.note = note.trim();
  if (by?.trim()) contribution.by = by.trim();

  return contribution;
}

export const isEmpty = (contribution: Contribution): boolean =>
  !contribution.overrides && !contribution.review;

export const serialise = (contribution: Contribution): string =>
  JSON.stringify(contribution, null, 2);

/**
 * Hand the correction to the worker, which files it and answers with its address.
 *
 * Nothing here retries or queues: a correction that fails to send falls back to the
 * mail route in front of the person who wrote it, rather than disappearing into a
 * buffer they cannot see.
 */
export async function submitCorrection(
  reco: Recommendation,
  contribution: Contribution,
): Promise<string> {
  const response = await fetch(SUBMIT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...contribution, page: pageUrl(reco) }),
  });

  const answer = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response.ok || !answer?.url) {
    throw new Error(answer?.error ?? `envoi refusé (${response.status})`);
  }
  return answer.url;
}
