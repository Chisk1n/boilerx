import type { Hypothesis } from "@boilerx/shared";

export interface ArchitectContext {
  readonly target: string;
  readonly previousIterations: ReadonlyArray<{ score: number; summary: string }>;
  readonly bestScore: number;
}

/**
 * Result of a single `Architect.proposeHypotheses` call.
 *
 * Returns both the hypotheses and the *estimated* USD cost of the proposal
 * call. Cost is 0 for stub architects and an approximation for LLM-backed
 * ones (see `cost.ts` for caveats). The orchestrator threads `costUsd` into
 * its budget circuit-breakers and the JSONL log.
 */
export interface ArchitectProposal {
  readonly hypotheses: readonly Hypothesis[];
  readonly costUsd: number;
}

/**
 * The Architect is read-only over the codebase. Its job is to look at past
 * iterations and propose N hypotheses (small, testable changes) that workers
 * will implement in parallel.
 *
 * Hypotheses MUST:
 *   - be small enough to fit in a single worktree iteration
 *   - list the files they intend to touch (whitelist)
 *   - never list files inside .judge/, .evolve/, or judge fixtures
 */
export interface Architect {
  proposeHypotheses(ctx: ArchitectContext, n: number): Promise<ArchitectProposal>;
}
