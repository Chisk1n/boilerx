import type { Hypothesis } from "@boilerx/shared";

export interface ArchitectContext {
  readonly target: string;
  readonly previousIterations: ReadonlyArray<{ score: number; summary: string }>;
  readonly bestScore: number;
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
  proposeHypotheses(ctx: ArchitectContext, n: number): Promise<readonly Hypothesis[]>;
}
