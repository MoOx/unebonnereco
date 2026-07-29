import { claudeCodeBackend } from "../backends/claude-code.ts";
import { ollamaBackend } from "../backends/ollama.ts";
import type { ExtractionBackend } from "../backends/types.ts";
import type { TranscriptSource } from "../types.ts";

export type CommonOptions = {
  backend: ExtractionBackend;
  source: TranscriptSource;
  /** Inputs per backend call. Only meaningful for the batching backend. */
  batchSize: number;
  episodeIds: string[];
};

const DEFAULT_MODEL: Record<string, string> = {
  ollama: "qwen3:14b",
  "claude-code": "sonnet",
};

/** Batching only pays off where each call carries a fixed overhead. */
const DEFAULT_BATCH: Record<string, number> = {
  ollama: 1,
  "claude-code": 5,
};

const OPTION_NAMES = ["backend", "model", "source", "batch"] as const;

/** Valueless switches the steps read directly off argv. */
const FLAG_NAMES = ["force", "replace", "refresh", "full-speed", "keep-audio"] as const;

/**
 * Split `--name value` pairs from positionals.
 *
 * Hand-rolled rather than `node:util`'s parseArgs because YouTube ids can start
 * with a dash — `-lc9eAEFlUk` is a real episode — and any conventional parser reads
 * that as an unknown option. Only `--name` is treated as a flag; everything else is
 * a positional, dash or not.
 */
function splitArgs(argv: string[]): {
  values: Record<string, string>;
  positionals: string[];
} {
  const values: Record<string, string> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const name = token.startsWith("--") ? token.slice(2) : null;
    if (name && (OPTION_NAMES as readonly string[]).includes(name)) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`missing value for --${name}`);
      values[name] = value;
      i++;
    } else if (name && (FLAG_NAMES as readonly string[]).includes(name)) {
      continue; // a switch, read where it is needed
    } else if (name) {
      throw new Error(`unknown option --${name}`);
    } else {
      positionals.push(token);
    }
  }
  return { values, positionals };
}

export function parseCommonOptions(argv: string[]): CommonOptions {
  const { values, positionals } = splitArgs(argv);

  const name = values.backend ?? "claude-code";
  const model = values.model ?? DEFAULT_MODEL[name];
  if (!model) throw new Error(`unknown backend "${name}" (use ollama or claude-code)`);

  const backend =
    name === "ollama" ? ollamaBackend(model) : claudeCodeBackend(model);

  const source = (values.source ?? "whisper") as TranscriptSource;
  if (source !== "whisper" && source !== "youtube") {
    throw new Error(`unknown source "${source}" (use whisper or youtube)`);
  }

  return {
    backend,
    source,
    batchSize: Number(values.batch ?? DEFAULT_BATCH[name] ?? 1),
    episodeIds: positionals,
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) {
    out.push(items.slice(i, i + Math.max(1, size)));
  }
  return out;
}

/** File suffix distinguishing runs, e.g. ".claude-code.whisper.json". */
export function runSuffix(backend: ExtractionBackend, source: TranscriptSource): string {
  return `.${backend.name}.${source}`;
}
