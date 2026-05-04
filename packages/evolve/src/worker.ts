import type { Hypothesis } from "@boilerx/shared";

export interface WorkerInput {
  readonly hypothesis: Hypothesis;
  readonly worktreePath: string;
  readonly iteration: number;
}

export interface WorkerOutput {
  readonly success: boolean;
  readonly filesModified: readonly string[];
  readonly notes: string;
  readonly costUsd: number;
}

/**
 * A Worker takes ONE hypothesis and tries to implement it inside its assigned
 * git worktree. Workers MUST NOT touch files outside `hypothesis.affectedFiles`
 * and MUST NOT touch any path under `.judge/` or `.evolve/`.
 *
 * In the hybrid runtime we plan to use, Workers are powered by a coding-agent
 * SDK (Cursor SDK or Claude Agent SDK), but the orchestrator only sees this
 * interface.
 */
export interface Worker {
  apply(input: WorkerInput): Promise<WorkerOutput>;
}
