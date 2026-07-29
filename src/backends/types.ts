import type {
  Episode,
  RawRecommendation,
  Section,
  WorkIdentification,
  WorkKind,
} from "../types.ts";

export type ExtractInput = {
  episode: Episode;
  section: Section;
};

export type IdentifyInput = {
  spokenTitle: string;
  kind: WorkKind;
  creator: string;
  recommendedBy: string;
  excerpt: string;
};

export type IdentifyResult = WorkIdentification & {
  /** Options the backend chose between, kept for auditing a bad pick. */
  candidates?: string[];
};

/**
 * A source of extraction and identification.
 *
 * Both methods take arrays on purpose. A local model has no per-call overhead
 * and just loops, but every `claude -p` invocation re-sends Claude Code's system
 * prompt and tool definitions (~15k tokens, measured), so batching is what keeps
 * that path economical.
 */
export type ExtractionBackend = {
  readonly name: string;
  readonly model: string;
  /** One array of recommendations per input, in the same order. */
  extract(inputs: ExtractInput[]): Promise<RawRecommendation[][]>;
  /** One identification per input, in the same order. */
  identify(inputs: IdentifyInput[]): Promise<IdentifyResult[]>;
};

export const HOSTS =
  "Kyan Khojandi and Navo (the two hosts of the show), plus the guests named in the episode title";

export const EXTRACTION_BRIEF = `You extract cultural recommendations from the end of an episode of the French \
podcast "Un Bon Moment avec Kyan Khojandi et Navo".

The text comes from an automatic transcription: proper nouns are often mangled \
phonetically. Recognising the work actually being cited is the core of the task.

Rules:
- Only report genuine recommendations of cultural works (film, series, book, comic, \
podcast, YouTube channel, show, music, game, documentary, restaurant).
- Ignore passing mentions, thanks, crew names, and the show promoting itself.
- spokenTitle: the title as it appears in the text, even misspelled.
- correctedTitle: the real title, correctly spelled. If unsure, copy spokenTitle and \
lower the confidence.
- creator: author, director or creator when known, otherwise an empty string.
- recommendedBy: who recommends it. Spell the name the way the episode title and \
description spell it, not the way the transcription heard it — "Aurel" and "Aurèle" \
are Orelsan. Attribute to a named participant whenever the surrounding dialogue makes \
the speaker clear; only fall back to an empty string when it is genuinely ambiguous.
- timecode: copy the [HH:MM:SS] label of the line where the recommendation is made, \
EXACTLY as it appears.
- excerpt: a short quote from the source text, 200 characters maximum.
- confidence: 0 to 1 — how sure you are that this is a recommendation and that the \
corrected title is right.
- Return an empty list if there is no recommendation.`;
