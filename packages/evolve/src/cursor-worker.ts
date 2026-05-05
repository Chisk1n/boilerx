import { Agent, CursorAgentError } from "@cursor/sdk";
import type { Logger } from "@boilerx/shared";
import { runCommand } from "./exec.js";
import type { Worker, WorkerInput, WorkerOutput } from "./worker.js";

export interface CursorWorkerOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly logger: Logger;
  readonly timeoutMs?: number;
  readonly promptBuilder?: PromptBuilder;
  readonly enforceWhitelist?: boolean;
  readonly forbiddenPaths?: readonly string[];
}

export type PromptBuilder = (input: WorkerInput) => string;

const DEFAULT_FORBIDDEN: readonly string[] = [
  ".judge/",
  ".evolve/",
  "tests/judge/",
  "Makefile",
  ".git/",
  ".github/",
];

/**
 * LLM-backed Worker on top of `@cursor/sdk` (local runtime).
 *
 * Each `apply()` call runs `Agent.prompt(...)` against the assigned worktree.
 * The agent is allowed to read and edit files inside `input.worktreePath`,
 * but two safeguards run after the agent exits:
 *
 *   1. Files modified outside `hypothesis.affectedFiles` are reverted with
 *      `git checkout -- <file>` (so a misbehaving agent can't sneak in
 *      changes the Architect didn't authorize).
 *   2. Files matching any `forbiddenPaths` prefix are reverted unconditionally.
 *      Defaults: `.judge/`, `.evolve/`, `tests/judge/`, `.git/`, `.github/`,
 *      `Makefile`. These are the orchestrator's anti-Goodhart fences.
 *
 * The orchestrator sees a `WorkerOutput` with `filesModified` already filtered
 * to authorized files only.
 */
export class CursorWorker implements Worker {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly promptBuilder: PromptBuilder;
  private readonly enforceWhitelist: boolean;
  private readonly forbiddenPaths: readonly string[];

  constructor(opts: CursorWorkerOptions) {
    if (!opts.apiKey || opts.apiKey.trim() === "") {
      throw new Error("CursorWorker requires a non-empty apiKey.");
    }
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.logger = opts.logger.child({ component: "cursor-worker" });
    this.timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    this.promptBuilder = opts.promptBuilder ?? defaultPromptBuilder;
    this.enforceWhitelist = opts.enforceWhitelist ?? true;
    this.forbiddenPaths = opts.forbiddenPaths ?? DEFAULT_FORBIDDEN;
  }

  async apply(input: WorkerInput): Promise<WorkerOutput> {
    const prompt = this.promptBuilder(input);
    this.logger.info("worker apply", {
      hypothesisId: input.hypothesis.id,
      iteration: input.iteration,
      worktreePath: input.worktreePath,
    });

    try {
      const result = await withTimeout(
        Agent.prompt(prompt, {
          apiKey: this.apiKey,
          model: { id: this.model },
          local: { cwd: input.worktreePath, settingSources: [] },
        }),
        this.timeoutMs,
      );

      if (result.status !== "finished") {
        return {
          success: false,
          filesModified: [],
          notes: `cursor agent ended with status='${result.status}' (id=${result.id})`,
          costUsd: 0,
        };
      }

      const allModified = await detectModifiedFiles(input.worktreePath);
      const enforcement = this.enforceWhitelist
        ? await this.enforceFileFences(
            input.worktreePath,
            input.hypothesis.affectedFiles,
            allModified,
          )
        : { kept: [...allModified], reverted: [] as string[], reasons: new Map<string, string>() };

      return {
        success: true,
        filesModified: enforcement.kept,
        notes: this.summarizeNotes(result, enforcement),
        costUsd: 0,
      };
    } catch (err) {
      if (err instanceof CursorAgentError) {
        return {
          success: false,
          filesModified: [],
          notes: `cursor startup failed (retryable=${err.isRetryable}): ${err.message}`,
          costUsd: 0,
        };
      }
      const detail = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        filesModified: [],
        notes: `unexpected worker failure: ${detail}`,
        costUsd: 0,
      };
    }
  }

  private async enforceFileFences(
    cwd: string,
    whitelist: readonly string[],
    modified: readonly string[],
  ): Promise<{ kept: string[]; reverted: string[]; reasons: Map<string, string> }> {
    const wl = new Set(whitelist.map(normalizePath));
    const kept: string[] = [];
    const reverted: string[] = [];
    const reasons = new Map<string, string>();

    for (const file of modified) {
      const norm = normalizePath(file);
      const forbiddenHit = this.forbiddenPaths.find((p) => norm.startsWith(normalizePath(p)));
      if (forbiddenHit) {
        await this.revertFile(cwd, file);
        reverted.push(file);
        reasons.set(file, `forbidden path (${forbiddenHit})`);
        continue;
      }
      if (wl.size > 0 && !wl.has(norm)) {
        await this.revertFile(cwd, file);
        reverted.push(file);
        reasons.set(file, "outside hypothesis whitelist");
        continue;
      }
      kept.push(file);
    }

    if (reverted.length > 0) {
      this.logger.warn("reverted out-of-bounds modifications", {
        count: reverted.length,
        files: reverted,
      });
    }

    return { kept, reverted, reasons };
  }

  private async revertFile(cwd: string, file: string): Promise<void> {
    const cmd = `git checkout HEAD -- "${file.replace(/"/g, '\\"')}"`;
    const result = await runCommand(cmd, { cwd, timeoutMs: 15_000 });
    if (result.exitCode !== 0) {
      const cleanup = await runCommand(`git clean -f -- "${file.replace(/"/g, '\\"')}"`, {
        cwd,
        timeoutMs: 15_000,
      });
      if (cleanup.exitCode !== 0) {
        this.logger.warn("revert failed", {
          file,
          checkoutStderr: result.stderr,
          cleanStderr: cleanup.stderr,
        });
      }
    }
  }

  private summarizeNotes(
    result: { id?: string; result?: unknown },
    enforcement: { kept: string[]; reverted: string[]; reasons: Map<string, string> },
  ): string {
    const lines: string[] = [];
    if (result.id) lines.push(`run=${result.id}`);
    if (typeof result.result === "string" && result.result.length > 0) {
      lines.push(`result=${result.result.slice(0, 500)}`);
    }
    if (enforcement.reverted.length > 0) {
      lines.push(`reverted ${enforcement.reverted.length} out-of-bounds file(s):`);
      for (const f of enforcement.reverted) {
        lines.push(`  - ${f}: ${enforcement.reasons.get(f) ?? "?"}`);
      }
    }
    return lines.join("\n");
  }
}

const defaultPromptBuilder: PromptBuilder = (input) => {
  const files = input.hypothesis.affectedFiles.length
    ? input.hypothesis.affectedFiles.map((f) => `  - ${f}`).join("\n")
    : "  (none specified — keep changes minimal and contained)";

  return [
    "You are a coding agent applying a single, surgical change to a codebase.",
    "",
    `Hypothesis: ${input.hypothesis.summary}`,
    `Rationale:  ${input.hypothesis.rationale}`,
    "",
    "Files you may modify (whitelist):",
    files,
    "",
    "Hard rules:",
    "- Do NOT modify any file outside the whitelist above.",
    "- Do NOT modify anything under .judge/, .evolve/, .git/, .github/, tests/judge/, or the Makefile.",
    "- Do NOT commit. Leave the working tree dirty; the orchestrator handles git.",
    "- Do NOT delete files unless the hypothesis explicitly requires it.",
    "- Make the smallest possible change that implements the hypothesis.",
    "",
    "When you finish, briefly describe what you changed.",
  ].join("\n");
};

async function detectModifiedFiles(cwd: string): Promise<readonly string[]> {
  const result = await runCommand("git status --porcelain", { cwd, timeoutMs: 15_000 });
  if (result.exitCode !== 0) return [];
  const files: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const path = line.slice(3).trim();
    const arrow = path.indexOf(" -> ");
    files.push(arrow >= 0 ? path.slice(arrow + 4) : path);
  }
  return files;
}

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
          () => reject(new Error(`CursorWorker timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
