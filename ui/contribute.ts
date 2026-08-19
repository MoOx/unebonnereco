import type { Recommendation } from "../src/types";

/**
 * Getting a reader's correction to where it can be merged.
 *
 * The site is a static export with nowhere to POST, so a correction has to leave the
 * page as a URL: a pre-filled GitHub issue for anyone with an account, a pre-filled
 * mail for everyone else. Both carry the same block of JSON, so whatever picks them
 * up later reads one format and not two.
 *
 * The shape of that block mirrors the two files it ends up in — `overrides` for what
 * an entry should contain, `review` for whether it should exist — so applying a
 * contribution is a copy into each, with no interpretation in between. That is the
 * point: these corrections exist because a machine guessed wrong, and running them
 * back through a second guess would be a strange way to fix that.
 */
export const REPO = "MoOx/unebonnereco";

/**
 * Where the entry lives, so a correction can be checked against what it corrects.
 *
 * Built from the id rather than read off the browser, because these pages are
 * pre-rendered at build time, where there is no location to read.
 */
export const SITE = "https://moox.github.io/unebonnereco";

export const pageUrl = (reco: Recommendation): string =>
  `${SITE}/reco/${reco.id}`;

/**
 * The fallback route, for readers without a GitHub account — which is most of them.
 *
 * Published in the clear, and harvestable as a result. Obfuscating it would be
 * theatre: the address ships inside the bundle either way, and the address exists to
 * receive mail from strangers.
 */
export const CONTACT_EMAIL = "unebonnereco@gmail.com";

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

const subjectOf = (reco: Recommendation, contribution: Contribution): string =>
  contribution.review
    ? `Fiche à retirer : ${reco.title}`
    : `Correction : ${reco.title}`;

/**
 * The pre-filled issue.
 *
 * Issue forms accept a value per field id in the query string, which is what makes a
 * button on a page able to open a form already filled in.
 */
export function issueUrl(
  reco: Recommendation,
  contribution: Contribution,
): string {
  const query = new URLSearchParams({
    template: "correction.yml",
    title: subjectOf(reco, contribution),
    reco: reco.id,
    page: pageUrl(reco),
    patch: serialise(contribution),
    note: contribution.note ?? "",
  });
  return `https://github.com/${REPO}/issues/new?${query}`;
}

/** The same thing as a mail, for readers who will not open a GitHub account. */
export function mailtoUrl(
  reco: Recommendation,
  contribution: Contribution,
): string {
  const body = [
    subjectOf(reco, contribution),
    pageUrl(reco),
    "",
    "Merci de laisser ce bloc tel quel, il est relu tel qu'il arrive :",
    "",
    serialise(contribution),
  ].join("\n");

  // Percent-encoded by hand rather than through URLSearchParams: that encodes a
  // space as `+`, which a query string decodes back and a mail client does not —
  // the body would arrive with a plus between every word.
  return (
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent(`[reco] ${reco.id} — ${reco.title}`)}` +
    `&body=${encodeURIComponent(body)}`
  );
}
