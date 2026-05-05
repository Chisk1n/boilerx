import { Agent, CursorAgentError } from "@cursor/sdk";
import type { Hypothesis, Logger } from "@boilerx/shared";
import { runCommand } from "./exec.js";
import type { Architect, ArchitectContext } from "./architect.js";

export interface CursorArchitectOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly logger: Logger;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly forbiddenPaths?: readonly string[];
  readonly promptBuilder?: (ctx: ArchitectContext, n: number) => string;
}

const DEFAULT_FORBIDDEN: readonly string[] = [
  ".judge/",
  ".evolve/",
  "tests/judge/",
  "Makefile",
  ".git/",
  ".github/",
];

/**
 * LLM-backed Architect on top of `@cursor/sdk` (local runtime).
 *
 * The Architect is supposed to be **read-only** over the codebase. The SDK
 * does not enforce that, so we do it ourselves: after every `Agent.prompt`,
 * we run `git checkout -- .` and `git clean -fd .` in `ctx.target` to discard
 * any changes the LLM might have made while exploring. The orchestrator
 * already aborts on judge-hash-drift, so any tampering is detected anyway,
 * but reverting cheaply prevents a useless iteration.
 *
 * The agent is asked to emit a JSON array of hypotheses. We parse it, drop
 * malformed entries, and assign stable IDs (`h-<callIndex>-<i>`). If parsing
 * fails entirely, we retry up to `maxRetries`, then return what we have
 * (which may be the empty array — the orchestrator will record the iteration
 * as "all workers failed" and move on, never crashing the run).
 */
export class CursorArchitect implements Architect {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly forbiddenPaths: readonly string[];
  private readonly promptBuilder: (ctx: ArchitectContext, n: number) => string;
  private callCount = 0;

  constructor(opts: CursorArchitectOptions) {
    if (!opts.apiKey || opts.apiKey.trim() === "") {
      throw new Error("CursorArchitect requires a non-empty apiKey.");
    }
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.logger = opts.logger.child({ component: "cursor-architect" });
    this.timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    this.maxRetries = opts.maxRetries ?? 1;
    this.forbiddenPaths = opts.forbiddenPaths ?? DEFAULT_FORBIDDEN;
    this.promptBuilder = opts.promptBuilder ?? defaultPromptBuilder;
  }

  async proposeHypotheses(ctx: ArchitectContext, n: number): Promise<readonly Hypothesis[]> {
    if (n < 1) throw new Error(`proposeHypotheses requires n >= 1, got ${n}.`);
    const callIndex = this.callCount++;
    const prompt = this.promptBuilder(ctx, n);
    this.logger.info("architect proposing", { callIndex, n, target: ctx.target });

    let lastErr: string | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await withTimeout(
          Agent.prompt(attempt === 0 ? prompt : retryPrompt(prompt, lastErr ?? "?"), {
            apiKey: this.apiKey,
            model: { id: this.model },
            local: { cwd: ctx.target, settingSources: [] },
          }),
          this.timeoutMs,
        );
        await this.discardWorkingTreeChanges(ctx.target);

        if (result.status !== "finished") {
          lastErr = `agent ended with status='${result.status}'`;
          continue;
        }
        const text = typeof result.result === "string" ? result.result : "";
        const parsed = parseHypothesesJson(text);
        if (!parsed.ok) {
          lastErr = parsed.error;
          this.logger.warn("architect json parse failed", { attempt, error: parsed.error });
          continue;
        }
        const cleaned = this.normalize(parsed.value, callIndex, n);
        if (cleaned.length === 0) {
          lastErr = "no usable hypotheses after filtering";
          continue;
        }
        return cleaned;
      } catch (err) {
        await this.discardWorkingTreeChanges(ctx.target).catch(() => undefined);
        if (err instanceof CursorAgentError) {
          this.logger.warn("architect startup failed", {
            attempt,
            retryable: err.isRetryable,
            error: err.message,
          });
          lastErr = `startup: ${err.message}`;
          if (!err.isRetryable) break;
          continue;
        }
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.warn("architect call failed", { attempt, error: detail });
        lastErr = detail;
      }
    }

    this.logger.warn("architect returning empty hypothesis batch", { lastErr });
    return [];
  }

  private normalize(
    raw: ReadonlyArray<RawHypothesis>,
    callIndex: number,
    n: number,
  ): Hypothesis[] {
    const out: Hypothesis[] = [];
    for (let i = 0; i < raw.length && out.length < n; i++) {
      const h = raw[i]!;
      const summary = typeof h.summary === "string" ? h.summary.trim() : "";
      const rationale = typeof h.rationale === "string" ? h.rationale.trim() : "";
      if (!summary) continue;
      const affected = Array.isArray(h.affectedFiles)
        ? h.affectedFiles
            .filter((f): f is string => typeof f === "string" && f.trim() !== "")
            .map((f) => normalizePath(f))
            .filter((f) => !this.isForbidden(f))
        : [];
      out.push({
        id: `h-${callIndex}-${i}`,
        summary,
        rationale: rationale || "(no rationale provided)",
        affectedFiles: affected,
      });
    }
    return out;
  }

  private isForbidden(path: string): boolean {
    return this.forbiddenPaths.some((p) => path.startsWith(normalizePath(p)));
  }

  private async discardWorkingTreeChanges(cwd: string): Promise<void> {
    const reset = await runCommand("git checkout HEAD -- .", { cwd, timeoutMs: 15_000 });
    if (reset.exitCode !== 0) {
      this.logger.debug("architect post-prompt reset stderr", { stderr: reset.stderr });
    }
    const clean = await runCommand("git clean -fd .", { cwd, timeoutMs: 15_000 });
    if (clean.exitCode !== 0) {
      this.logger.debug("architect post-prompt clean stderr", { stderr: clean.stderr });
    }
  }
}

interface RawHypothesis {
  readonly summary?: unknown;
  readonly rationale?: unknown;
  readonly affectedFiles?: unknown;
}

type ParseResult =
  | { ok: true; value: ReadonlyArray<RawHypothesis> }
  | { ok: false; error: string };

export function parseHypothesesJson(text: string): ParseResult {
  if (!text || text.trim() === "") {
    return { ok: false, error: "empty result" };
  }
  const arrayText = extractJsonArray(text);
  if (!arrayText) return { ok: false, error: "no JSON array found in output" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `JSON.parse failed: ${detail}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "top-level JSON value is not an array" };
  }
  const items: RawHypothesis[] = [];
  for (const item of parsed) {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      items.push(item as RawHypothesis);
    }
  }
  if (items.length === 0) return { ok: false, error: "array contained no objects" };
  return { ok: true, value: items };
}

function extractJsonArray(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/i);
  if (fence) return fence[1] ?? null;
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

const defaultPromptBuilder = (ctx: ArchitectContext, n: number): string => {
  const history = ctx.previousIterations.length
    ? ctx.previousIterations
        .slice(-5)
        .reverse()
        .map((h, i) => `  ${i + 1}. score=${h.score.toFixed(4)} — ${h.summary}`)
        .join("\n")
    : "  (none yet — this is the first iteration)";
  return [
    "You are the Architect of an autonomous code-evolution loop.",
    "Your ONLY job in this turn is to propose hypotheses. You may read files to",
    "understand the codebase, but DO NOT modify anything — your changes will be",
    "discarded after you finish.",
    "",
    `Project root: ${ctx.target}`,
    `Best score so far: ${ctx.bestScore.toFixed(4)}`,
    "",
    "Recent iterations (most recent first):",
    history,
    "",
    `Propose ${n} distinct, surgical hypotheses for the next iteration.`,
    "Each hypothesis must:",
    "  - target a SPECIFIC small change (one bug, one refactor, one feature flag, etc.)",
    "  - list the files the worker is allowed to touch",
    "  - never list .judge/, .evolve/, tests/judge/, .git/, .github/, or Makefile",
    "  - be different from the others (different approaches, not slight variants)",
    "  - be small enough to implement in one short worker iteration",
    "",
    "Output ONLY a JSON array, no prose, no markdown fences. Example:",
    `[
  {
    "summary": "validate input length in handler",
    "rationale": "request handler accepts arbitrarily long bodies; tests fail on >10MB.",
    "affectedFiles": ["src/handler.ts", "src/handler.test.ts"]
  }
]`,
  ].join("\n");
};

const retryPrompt = (original: string, lastErr: string): string =>
  `${original}\n\n---\nIMPORTANT: previous attempt failed with: "${lastErr}". Output ONLY a valid JSON array. No prose. No markdown fences. No commentary.`;

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`CursorArchitect timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
