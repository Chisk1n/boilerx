/**
 * Types for the Capa-2 autonomous code-evolution loop.
 *
 * Mental model (Karpathy's autoresearch + Anthropic's evaluator-optimizer):
 *
 *   Architect (read-only) -> proposes hypotheses
 *      |
 *      v
 *   N Workers (write, isolated in git worktrees) -> apply 1 hypothesis each
 *      |
 *      v
 *   Judge (read-only, IMMUTABLE prompt + scoring code, hash-pinned)
 *      |
 *      v
 *   Orchestrator: keep best, revert worse, log JSONL, enforce budget.
 */

export type IsoTimestamp = string;

export interface EvolveRunConfig {
  readonly target: string;
  readonly metricFile: string;
  readonly maxIterations: number;
  readonly maxWallTimeMs: number;
  readonly maxCostUsd: number;
  readonly workersPerIteration: number;
  readonly model: string;
  readonly seed?: number;
}

export interface Hypothesis {
  readonly id: string;
  readonly summary: string;
  readonly rationale: string;
  readonly affectedFiles: readonly string[];
}

export interface MetricBreakdown {
  readonly testsPassing: number;
  readonly coverageDelta: number;
  readonly benchmarkScore: number;
  readonly lintScore: number;
  readonly llmJudgeRubric: number;
}

export interface JudgeVerdict {
  readonly score: number;
  readonly breakdown: MetricBreakdown;
  readonly logs: string;
  readonly aborted: boolean;
  readonly abortReason?: string;
  readonly judgeHash: string;
}

export interface IterationResult {
  readonly iteration: number;
  readonly timestamp: IsoTimestamp;
  readonly hypothesisId: string;
  readonly worktree: string;
  readonly verdict: JudgeVerdict;
  readonly kept: boolean;
  readonly reason: string;
  readonly costUsd: number;
}

export interface EvolveRunSummary {
  readonly runId: string;
  readonly startedAt: IsoTimestamp;
  readonly endedAt?: IsoTimestamp;
  readonly config: EvolveRunConfig;
  readonly bestScore: number;
  readonly bestIteration?: number;
  readonly totalIterations: number;
  readonly totalCostUsd: number;
}
