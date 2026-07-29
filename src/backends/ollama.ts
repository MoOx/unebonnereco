import { hms } from "../lib/time.ts";
import { search, searchUrl, summary } from "../lib/wikipedia.ts";
import { WORK_KINDS, type RawRecommendation, type WorkKind } from "../types.ts";
import {
  EXTRACTION_BRIEF,
  HOSTS,
  type ExtractInput,
  type ExtractionBackend,
  type IdentifyInput,
  type IdentifyResult,
} from "./types.ts";

const ENDPOINT = "http://127.0.0.1:11434/api/chat";

/** Search terms appended per kind to disambiguate a bare title. */
const KIND_HINTS: Record<WorkKind, string> = {
  film: "film",
  series: "série télévisée",
  game: "jeu vidéo",
  book: "livre roman",
  comic: "bande dessinée",
  show: "spectacle théâtre",
  music: "album musique",
  podcast: "podcast",
  youtube_channel: "chaîne YouTube",
  documentary: "documentaire",
  restaurant: "restaurant",
  other: "",
};

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          spokenTitle: { type: "string" },
          correctedTitle: { type: "string" },
          kind: { type: "string", enum: WORK_KINDS },
          creator: { type: "string" },
          recommendedBy: { type: "string" },
          timecode: { type: "string" },
          excerpt: { type: "string" },
          confidence: { type: "number" },
        },
        required: [
          "spokenTitle",
          "correctedTitle",
          "kind",
          "creator",
          "recommendedBy",
          "timecode",
          "excerpt",
          "confidence",
        ],
      },
    },
  },
  required: ["recommendations"],
};

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    page: { type: "string" },
    title: { type: "string" },
    creator: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["found", "page", "title", "creator", "confidence"],
};

const JUDGE_BRIEF = `You identify a cultural work recommended in a French podcast.
The title as heard comes from an automatic transcription and may be phonetically \
distorted. You are given candidates from a Wikipedia search.

Rules:
- Pick the candidate that really matches, using the context excerpt (creator cited, \
platform, subject) as much as the title itself.
- \`page\` must be COPIED EXACTLY from the candidate list. Never invent a page title.
- If no candidate fits, set found=false and leave page empty.
- \`title\`: the common title of the work, without the disambiguation parenthesis.
- \`confidence\` between 0 and 1.`;

type ChatResponse = { message: { content: string } };

async function chat(
  model: string,
  system: string,
  user: string,
  schema: unknown,
): Promise<unknown> {
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    format: schema,
    stream: false,
    // 8192 covers our sections (2.5k–5.5k tokens); 16384 makes gpt-oss:20b swap on 16 GB.
    options: { temperature: 0, num_ctx: 8192 },
  };
  // Thinking costs ~8x the time on qwen3 for no measured gain here. gpt-oss is the
  // opposite: it returns an EMPTY response when thinking is disabled, so let it think.
  if (!model.startsWith("gpt-oss")) payload.think = false;

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const body = (await response.json()) as ChatResponse;
  return JSON.parse(body.message.content);
}

/**
 * Local model via Ollama, with schema-constrained JSON output.
 *
 * Identification deliberately does NOT ask the model what a work is: an 8–14B model
 * does not know the cultural catalogue and hallucinates confidently. It searches
 * Wikipedia first and only asks the model to *choose* among real candidates.
 */
export function ollamaBackend(model: string): ExtractionBackend {
  return {
    name: "ollama",
    model,

    async extract(inputs: ExtractInput[]): Promise<RawRecommendation[][]> {
      const results: RawRecommendation[][] = [];
      for (const { episode, section } of inputs) {
        const body = section.blocks
          .map((block) => `[${hms(block.startS)}] ${block.text}`)
          .join("\n\n");
        const user =
          `Episode: ${episode.title}\nParticipants: ${HOSTS}\n\n` +
          `End of the episode (each paragraph is prefixed with its timecode):\n\n${body}`;
        const parsed = (await chat(model, EXTRACTION_BRIEF, user, EXTRACTION_SCHEMA)) as {
          recommendations?: RawRecommendation[];
        };
        results.push(parsed.recommendations ?? []);
      }
      return results;
    },

    async identify(inputs: IdentifyInput[]): Promise<IdentifyResult[]> {
      const results: IdentifyResult[] = [];
      for (const input of inputs) {
        const query = `${input.spokenTitle} ${KIND_HINTS[input.kind] ?? ""}`.trim();
        const candidates = await search(query);
        if (input.creator) {
          candidates.push(
            ...(await search(`${input.spokenTitle} ${input.creator}`, { limit: 4 })),
          );
        }
        const seen = new Set<string>();
        const unique = candidates.filter((c) =>
          seen.has(c.page) ? false : (seen.add(c.page), true),
        );
        const pages = unique.map((c) => c.page);

        const fallback: IdentifyResult = {
          found: false,
          title: input.spokenTitle,
          creator: input.creator,
          description: "",
          link: searchUrl(query),
          linkSource: "search",
          confidence: 0.4,
          candidates: pages,
        };
        if (unique.length === 0) {
          results.push({ ...fallback, link: "", linkSource: "none" });
          continue;
        }

        const user =
          `Title as heard: "${input.spokenTitle}"\nAssumed kind: ${input.kind}\n` +
          `Recommended by: ${input.recommendedBy || "unknown"}\n` +
          `Context: "${input.excerpt}"\n\n` +
          `Wikipedia candidates:\n${JSON.stringify(unique, null, 1)}`;
        const verdict = (await chat(model, JUDGE_BRIEF, user, JUDGE_SCHEMA)) as {
          found: boolean;
          page: string;
          title: string;
          creator: string;
          confidence: number;
        };

        // Guard rail: reject a page the model invented rather than picked.
        if (!verdict.found || !pages.includes(verdict.page)) {
          results.push(fallback);
          continue;
        }
        const page = await summary(verdict.page);
        if (!page) {
          results.push(fallback);
          continue;
        }
        results.push({
          found: true,
          title: verdict.title || input.spokenTitle,
          creator: verdict.creator || input.creator,
          description: page.description.slice(0, 600),
          link: page.link,
          linkSource: "reference",
          confidence: verdict.confidence,
          candidates: pages,
        });
      }
      return results;
    },
  };
}
