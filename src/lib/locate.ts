import type { TranscriptBlock } from "../types.ts";

/**
 * Locating a quote inside a transcript.
 *
 * The model returns an `excerpt` copied from the text it was given, which is grouped
 * into ~45 s blocks. Timing a link off the block start can therefore be half a minute
 * early. Whisper's own segments are far finer, so we find the quote in the segment
 * stream instead and time the link from there.
 */

/** Fold case, strip accents and punctuation so small transcription differences match. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Located = { startS: number; endS: number; exact: boolean };

/**
 * Find where a quote is spoken.
 *
 * Returns null when the quote cannot be found at all — the model sometimes
 * paraphrases rather than copying, and a wrong timecode is worse than a coarse one.
 */
export function locateQuote(
  excerpt: string,
  segments: TranscriptBlock[],
  /**
   * Second anchor, tried when the quote itself cannot be found.
   *
   * Models paraphrase instead of copying about a fifth of the time, but the title as
   * heard is by construction a string that occurs in the transcript — it is what the
   * model read. It recovers nine failures out of ten.
   */
  spokenTitle?: string,
): Located | null {
  if (segments.length === 0) return null;
  return find(excerpt, segments) ?? (spokenTitle ? find(spokenTitle, segments) : null);
}

function find(excerpt: string, segments: TranscriptBlock[]): Located | null {
  if (!excerpt) return null;

  // Concatenate the segments, remembering which character belongs to which segment.
  const owner: number[] = [];
  let haystack = "";
  segments.forEach((segment, index) => {
    const piece = `${normalize(segment.text)} `;
    haystack += piece;
    for (let i = 0; i < piece.length; i++) owner.push(index);
  });

  const needle = normalize(excerpt);
  if (!needle) return null;

  const at = (probe: string) => {
    const found = haystack.indexOf(probe);
    return found === -1 ? null : found;
  };

  // Whole quote first; then a shrinking prefix, since models often trim the tail.
  let start = at(needle);
  let matched = needle;
  if (start === null) {
    const words = needle.split(" ");
    for (let take = Math.min(12, words.length); take >= 4; take--) {
      const probe = words.slice(0, take).join(" ");
      const found = at(probe);
      if (found !== null) {
        start = found;
        matched = probe;
        break;
      }
    }
  }
  if (start === null) return null;

  const first = segments[owner[start]];
  const lastIndex = owner[Math.min(start + matched.length - 1, owner.length - 1)];
  const last = segments[lastIndex];
  const following = segments[lastIndex + 1];

  return {
    startS: first.startS,
    // The quote ends somewhere inside its final segment; the next segment's start is
    // the tightest upper bound we actually know.
    endS: following ? following.startS : last.startS + 6,
    exact: matched === needle,
  };
}

/** How far back to look for someone being addressed by name. */
const CUE_BEFORE = 40;
const CUE_AFTER = 10;

/**
 * Was the person actually named around the moment they recommended something?
 *
 * This is the difference between "Navo recommends X" and "one of the four people in
 * the room recommends X, probably Navo". Only the first name is checked: surnames are
 * rarely spoken, and the transcription mangles them when they are.
 */
export function attributionIsCued(
  recommendedBy: string,
  timecodeS: number,
  segments: TranscriptBlock[],
): boolean {
  const first = normalize(recommendedBy).split(" ")[0];
  if (!first || first.length < 3) return false;
  const around = segments.filter(
    (s) => s.startS >= timecodeS - CUE_BEFORE && s.startS <= timecodeS + CUE_AFTER,
  );
  return normalize(around.map((s) => s.text).join(" ")).includes(first);
}
