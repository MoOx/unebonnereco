/**
 * Domain types shared by the extraction pipeline and the (future) Expo site.
 *
 * The site reads `data/*.json` straight from the repo, so these declarations are
 * the single source of truth for that contract: `Episode[]` for episodes.json and
 * `Recommendation[]` for recommendations.json.
 */

export type WorkKind =
  | "film"
  | "series"
  | "game"
  | "book"
  | "comic"
  | "show"
  | "music"
  | "podcast"
  | "youtube_channel"
  | "documentary"
  | "restaurant"
  | "other";

export const WORK_KINDS: readonly WorkKind[] = [
  "film",
  "series",
  "game",
  "book",
  "comic",
  "show",
  "music",
  "podcast",
  "youtube_channel",
  "documentary",
  "restaurant",
  "other",
];

/** Where `Recommendation.link` points, and therefore how much to trust it. */
export type LinkSource =
  /** A canonical reference page for the work itself. */
  | "reference"
  /** A search URL — we could not resolve the work to a page. */
  | "search"
  /** Nothing found at all. */
  | "none";

export type ReviewStatus = "to_review" | "published" | "rejected";

export type Episode = {
  /** YouTube video id, e.g. "-lc9eAEFlUk". Note: can start with a dash. */
  id: string;
  title: string;
  durationS: number;
  url: string;
  /** Upload date as YYYYMMDD, straight from yt-dlp. */
  date?: string;
  description?: string;
  chapters?: { title: string; startS: number }[];
  hasSubtitles?: boolean;
};

export type TranscriptBlock = {
  startS: number;
  text: string;
};

/** How the text of a section was obtained. */
export type TranscriptSource = "youtube" | "whisper";

/** How the recommendation section was located within the episode. */
export type SectionMethod = "marker" | "position";

export type Section = {
  episodeId: string;
  source: TranscriptSource;
  method: SectionMethod;
  startS: number;
  /** Grouped into ~45 s chunks — what the model reads, so its prompt stays compact. */
  blocks: TranscriptBlock[];
  /**
   * Whisper's own segments, roughly one sentence each.
   *
   * The blocks above are too coarse to time a link: a 45 s chunk can open half a
   * minute before the sentence anyone cares about. These keep the original
   * precision so an extracted quote can be traced back to the second.
   */
  segments?: TranscriptBlock[];
};

/** What a backend returns before any enrichment. */
export type RawRecommendation = {
  /** Title as heard, possibly garbled by the transcription. */
  spokenTitle: string;
  /** Backend's best guess at the real title. */
  correctedTitle: string;
  kind: WorkKind;
  creator: string;
  recommendedBy: string;
  /** A `[HH:MM:SS]` label copied from the prompt, resolved to seconds later. */
  timecode: string;
  excerpt: string;
  confidence: number;
};

/** What an enrichment backend resolves a raw recommendation to. */
export type WorkIdentification = {
  found: boolean;
  title: string;
  creator: string;
  description: string;
  link: string;
  linkSource: LinkSource;
  confidence: number;
};

/** A published catalogue entry — the shape the site consumes. */
export type Recommendation = {
  id: string;
  episodeId: string;
  spokenTitle: string;
  title: string;
  kind: WorkKind;
  creator: string;
  recommendedBy: string;
  /**
   * Whether the attribution rests on evidence or on inference.
   *
   * Whisper emits no speaker labels, so the transcript is a flat stream with no idea
   * of who is talking. When someone is addressed by name shortly before the
   * recommendation ("Navo, tu as quelque chose ?") the attribution is observed; the
   * rest of the time the model picks a plausible participant, and is wrong often
   * enough that the interface should not state it as fact.
   */
  attributionCued?: boolean;
  timecodeS: number;
  /** False when the model invented a timecode and we snapped it to the nearest block. */
  timecodeExact: boolean;
  /**
   * Playable range for the embedded player, in seconds.
   *
   * `timecodeS` is the start of a ~45 s transcript block, so the sentence itself often
   * lands mid-block: starting exactly there cuts off the question that introduces it.
   * The clip therefore opens a little earlier and runs past the answer.
   */
  clipStartS: number;
  clipEndS: number;
  timestampedUrl: string;
  transcriptExcerpt: string;
  description?: string;
  link?: string;
  linkSource?: LinkSource;
  /** Cover art for the work itself, distinct from the episode still. */
  posterUrl?: string;
  /** Which catalogue the artwork came from, so a bad match can be traced. */
  posterSource?: "itunes" | "openlibrary" | "tmdb";
  confidence: number;
  status: ReviewStatus;
  /** Pages offered to the judge, kept so a bad pick can be audited. */
  candidates?: string[];
  /** Set at read time when a human correction from data/overrides.json applies. */
  corrected?: boolean;
  /** Free-text rationale carried by a correction. */
  note?: string;
};

/** Extraction output for one episode, with the run metadata worth keeping. */
export type ExtractionRun = {
  episodeId: string;
  backend: string;
  model: string;
  transcriptSource: TranscriptSource;
  durationS: number;
  recommendations: Recommendation[];
};
