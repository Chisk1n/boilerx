import type { Worker, WorkerInput, WorkerOutput } from "./worker.js";

export type StubMutation = (input: WorkerInput) => Promise<readonly string[]> | readonly string[];

export interface StubWorkerOptions {
  readonly mutate: StubMutation;
  readonly costUsd?: number;
  readonly delayMs?: number;
}

/**
 * Deterministic Worker for tests and demos. Calls a user-provided `mutate`
 * function that performs the actual file edits inside `input.worktreePath`,
 * then reports them back as `filesModified`.
 *
 * Real LLM-backed Workers (Cursor SDK / Claude Agent SDK) will implement the
 * same interface in a later PR. The orchestrator does not care which.
 */
export class StubWorker implements Worker {
  private readonly mutate: StubMutation;
  private readonly costUsd: number;
  private readonly delayMs: number;

  constructor(opts: StubWorkerOptions) {
    this.mutate = opts.mutate;
    this.costUsd = opts.costUsd ?? 0;
    this.delayMs = opts.delayMs ?? 0;
  }

  async apply(input: WorkerInput): Promise<WorkerOutput> {
    if (this.delayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, this.delayMs));
    }
    try {
      const filesModified = await this.mutate(input);
      return {
        success: true,
        filesModified,
        notes: `stub worker applied hypothesis ${input.hypothesis.id}`,
        costUsd: this.costUsd,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        filesModified: [],
        notes: `stub worker failed: ${message}`,
        costUsd: this.costUsd,
      };
    }
  }
}
