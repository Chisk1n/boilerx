import type { JudgeVerdict, MetricBreakdown } from "@boilerx/shared";

/**
 * The Judge is the only component whose code AND prompt are IMMUTABLE during a
 * run. We hash both at startup and verify the hash before every evaluation; if
 * the hash drifts (e.g. a worker tried to game the judge), the run aborts.
 *
 * The Judge MUST:
 *   - run in an isolated sandbox (Docker, --network=none by default)
 *   - have read-only access to the worktree under evaluation
 *   - return a deterministic numeric score in [0, 1]
 *   - never call back into LLMs unless `llmJudgeRubric` weight > 0
 */
export interface Judge {
  readonly hash: string;
  evaluate(input: JudgeInput): Promise<JudgeVerdict>;
}

export interface JudgeInput {
  readonly worktreePath: string;
  readonly iteration: number;
  readonly previousScore: number | null;
}

/**
 * Composite metric definition. Loaded from `.judge/metric.yaml` at run start
 * and frozen for the duration of the run.
 *
 * Weights MUST sum to 1.0 (validated at load time). Each component returns a
 * raw value in [0, 1], and the final score is a weighted sum.
 */
export interface CompositeMetricSpec {
  readonly weights: MetricWeights;
  readonly testsCommand: string;
  readonly coverageCommand: string;
  readonly benchmarkCommand?: string;
  readonly lintCommand?: string;
  readonly llmJudgeRubricPath?: string;
  readonly timeoutSeconds: number;
}

export interface MetricWeights {
  readonly testsPassing: number;
  readonly coverageDelta: number;
  readonly benchmarkScore: number;
  readonly lintScore: number;
  readonly llmJudgeRubric: number;
}

export const DEFAULT_METRIC_WEIGHTS: MetricWeights = {
  testsPassing: 0.4,
  coverageDelta: 0.15,
  benchmarkScore: 0.25,
  lintScore: 0.1,
  llmJudgeRubric: 0.1,
};

export function validateWeights(weights: MetricWeights): void {
  const sum =
    weights.testsPassing +
    weights.coverageDelta +
    weights.benchmarkScore +
    weights.lintScore +
    weights.llmJudgeRubric;
  if (Math.abs(sum - 1.0) > 1e-6) {
    throw new Error(
      `Judge metric weights must sum to 1.0, got ${sum.toFixed(4)}. Edit .judge/metric.yaml.`,
    );
  }
}

export function combineMetric(breakdown: MetricBreakdown, weights: MetricWeights): number {
  return (
    breakdown.testsPassing * weights.testsPassing +
    breakdown.coverageDelta * weights.coverageDelta +
    breakdown.benchmarkScore * weights.benchmarkScore +
    breakdown.lintScore * weights.lintScore +
    breakdown.llmJudgeRubric * weights.llmJudgeRubric
  );
}
