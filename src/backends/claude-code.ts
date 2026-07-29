import { spawn } from "node:child_process";

import { hms } from "../lib/time.ts";
import type { RawRecommendation } from "../types.ts";
import {
  EXTRACTION_BRIEF,
  HOSTS,
  type ExtractInput,
  type ExtractionBackend,
  type IdentifyInput,
  type IdentifyResult,
} from "./types.ts";

/** Read-only tools. The backend must never touch the working tree. */
const ALLOWED_TOOLS = "WebSearch WebFetch";

type ResultEnvelope = {
  type: string;
  subtype: string;
  is_error: boolean;
  result: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
};

/**
 * Invoke `claude -p` and return the parsed JSON payload it produced.
 *
 * The prompt goes over stdin rather than argv: batched prompts run to hundreds of
 * kilobytes, which is uncomfortably close to ARG_MAX.
 */
async function ask<T>(model: string, prompt: string, attempts = 2): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await askOnce<T>(model, prompt);
    } catch (error) {
      if (attempt === attempts) throw error;
      // Malformed JSON is a sampling accident, not a deterministic failure: asking
      // again almost always produces a well-formed answer.
      console.log(`    reply unusable (${error}), asking again`);
    }
  }
  throw new Error("unreachable");
}

async function askOnce<T>(model: string, prompt: string): Promise<T> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--allowed-tools",
    ALLOWED_TOOLS,
  ];

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`claude exited with code ${code}`)),
    );
    child.stdin.end(prompt, "utf8");
  });

  const envelope = JSON.parse(stdout) as ResultEnvelope;
  if (envelope.is_error) throw new Error(`claude reported an error: ${envelope.result}`);
  if (envelope.total_cost_usd !== undefined) {
    console.log(`    (equivalent API cost: $${envelope.total_cost_usd.toFixed(4)})`);
  }
  return parseJsonPayload<T>(envelope.result);
}

/** Pull a JSON value out of a model reply, tolerating a markdown fence around it. */
function parseJsonPayload<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Last resort: the outermost brace-delimited span.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error(`no JSON found in reply: ${text.slice(0, 300)}`);
    }
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  }
}

const JSON_ONLY =
  "Reply with raw JSON only — no prose before or after it, no markdown fence.";

/**
 * Claude Code in headless mode, on the user's subscription.
 *
 * Unlike the local model this one knows the cultural catalogue and can search the
 * web, so identification asks it directly instead of feeding it Wikipedia
 * candidates. Everything is batched: each invocation re-sends Claude Code's system
 * prompt and tool definitions (~15k tokens, ~$0.07 equivalent), so one call per
 * episode would spend most of the budget on overhead.
 */
export function claudeCodeBackend(model: string): ExtractionBackend {
  return {
    name: "claude-code",
    model,

    async extract(inputs: ExtractInput[]): Promise<RawRecommendation[][]> {
      if (inputs.length === 0) return [];

      const episodes = inputs
        .map(({ episode, section }, index) => {
          const body = section.blocks
            .map((block) => `[${hms(block.startS)}] ${block.text}`)
            .join("\n\n");
          // The description usually names the guests — it is what lets the model
          // spell "Orelsan" where the transcription only offers "Aurel".
          const about = (episode.description ?? "").slice(0, 400).replace(/\s+/g, " ");
          return (
            `## Episode index ${index}\nTitle: ${episode.title}\n` +
            (about ? `Description: ${about}\n` : "") +
            `\n${body}`
          );
        })
        .join("\n\n---\n\n");

      const prompt = `${EXTRACTION_BRIEF}

Participants: ${HOSTS}

You are given the end of ${inputs.length} episode(s), separated by \`---\`. Process each
one independently and keep the given episode index.

${JSON_ONLY} Shape:
{"episodes":[{"index":0,"recommendations":[{"spokenTitle":"","correctedTitle":"","kind":"film|series|game|book|comic|show|music|podcast|youtube_channel|documentary|restaurant|other","creator":"","recommendedBy":"","timecode":"[HH:MM:SS]","excerpt":"","confidence":0.0}]}]}

${episodes}`;

      const parsed = await ask<{
        episodes?: { index: number; recommendations?: RawRecommendation[] }[];
      }>(model, prompt);

      const byIndex = new Map<number, RawRecommendation[]>();
      for (const entry of parsed.episodes ?? []) {
        byIndex.set(entry.index, entry.recommendations ?? []);
      }
      return inputs.map((_, index) => byIndex.get(index) ?? []);
    },

    async identify(inputs: IdentifyInput[]): Promise<IdentifyResult[]> {
      if (inputs.length === 0) return [];

      const items = inputs.map((input, index) => ({
        index,
        titleAsHeard: input.spokenTitle,
        assumedKind: input.kind,
        creator: input.creator,
        recommendedBy: input.recommendedBy,
        context: input.excerpt,
      }));

      const prompt = `You identify cultural works recommended in a French podcast. Each title
below was heard through an automatic transcription and may be phonetically distorted
("The Rear Soul" was in fact "The Rehearsal", "Can Folet" was "Ken Follett").

For each item:
- Work out the real work from the title AND the context (creator cited, platform, subject).
- Use web search when you are not certain. Do not guess: a confident wrong answer is
  much worse than a low confidence score.
- \`link\`: the canonical reference page for the WORK ITSELF (Wikipedia, IMDb, an official
  page). Set linkSource "reference" only if the page is genuinely about that work — a
  page that merely mentions it does not count. Otherwise return a search URL with
  linkSource "search", or an empty link with linkSource "none".
- DO NOT construct a reference URL from memory. Guessing a Wikipedia slug produces
  dead links roughly a third of the time — measured, not hypothetical. Open the page
  with a tool and confirm it exists and is about this work before claiming
  "reference". Every link is verified automatically afterwards and dead ones are
  thrown away, so an unverified guess is wasted effort: prefer "search".
- \`description\`: two or three factual sentences in French, 600 characters maximum.
- \`found\`: false when you could not identify the work with reasonable certainty.
- \`confidence\`: 0 to 1.

${JSON_ONLY} Shape:
{"items":[{"index":0,"found":true,"title":"","creator":"","description":"","link":"","linkSource":"reference|search|none","confidence":0.0}]}

${JSON.stringify(items, null, 1)}`;

      const parsed = await ask<{ items?: (IdentifyResult & { index: number })[] }>(
        model,
        prompt,
      );

      const byIndex = new Map<number, IdentifyResult>();
      for (const item of parsed.items ?? []) byIndex.set(item.index, item);

      return inputs.map((input, index) => {
        const found = byIndex.get(index);
        if (!found) {
          return {
            found: false,
            title: input.spokenTitle,
            creator: input.creator,
            description: "",
            link: "",
            linkSource: "none",
            confidence: 0,
          };
        }
        // A "reference" claim with no link is a contradiction — downgrade it.
        const linkSource = found.link ? found.linkSource : "none";
        return { ...found, linkSource };
      });
    },
  };
}
