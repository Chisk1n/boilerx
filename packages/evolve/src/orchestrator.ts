import type {
  EvolveRunConfig,
  EvolveRunSummary,
  IterationResult,
  Logger,
} from "@boilerx/shared";
import type { Architect } from "./architect.js";
import type { Judge } from "./judge.js";
import type { Worker } from "./worker.js";

export interface OrchestratorDeps {
  readonly architect: Architect;
  readonly workerFactory: () => Worker;
  readonly judge: Judge;
  readonly logger: Logger;
  readonly clock?: () => number;
}

/**
 * Drives the evaluator-optimizer loop:
 *
 *   while (within budget) {
 *     hypotheses = architect.propose(N)
 *     results    = await Promise.all(hypotheses.map(h => runWorker(h)))
 *     best       = max(results, byScore)
 *     if (best.score > currentBest) keep, else revert
 *   }
 *
 * NOT IMPLEMENTED YET. Phase 2 will add real worktree management, sandboxed
 * judge execution, and resumable JSONL run logs.
 */
export class Orchestrator {
  private readonly architect: Architect;
  private readonly workerFactory: () => Worker;
  private readonly judge: Judge;
  private readonly logger: Logger;
  private readonly now: () => number;

  constructor(deps: OrchestratorDeps) {
    this.architect = deps.architect;
    this.workerFactory = deps.workerFactory;
    this.judge = deps.judge;
    this.logger = deps.logger.child({ component: "orchestrator" });
    this.now = deps.clock ?? Date.now;
  }

  async run(config: EvolveRunConfig): Promise<EvolveRunSummary> {
    const runId = `run-${this.now()}`;
    const startedAt = new Date(this.now()).toISOString();
    this.logger.info("evolve run started", { runId, config });

    const _iterations: IterationResult[] = [];
    void _iterations;
    void this.architect;
    void this.workerFactory;
    void this.judge;
    void startedAt;
    void runId;

    throw new Error(
      "Orchestrator.run not implemented yet (planned for Phase 2). " +
        "See docs/EVOLVE.md for the full design.",
    );
  }
}
