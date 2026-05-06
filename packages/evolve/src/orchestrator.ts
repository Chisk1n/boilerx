import { join } from "node:path";
import type {
  AbortReason,
  EvolveRunConfig,
  EvolveRunSummary,
  Hypothesis,
  Logger,
  RunIterationRecord,
} from "@boilerx/shared";
import type { Architect } from "./architect.js";
import type { Judge } from "./judge.js";
import type { Worker, WorkerOutput } from "./worker.js";
import { RunLogger } from "./run-log.js";
import { WorktreeManager, type WorktreeHandle } from "./worktree.js";

export interface OrchestratorDeps {
  readonly architect: Architect;
  readonly workerFactory: () => Worker;
  readonly judge: Judge;
  readonly worktreeManager: WorktreeManager;
  readonly logger: Logger;
  readonly clock?: () => number;
  readonly runDirOverride?: string;
  /**
   * If `true` (default), the orchestrator copies the winning iteration's
   * working-tree changes back into the base repo via `git diff` + `git apply`.
   * The base ends up with a dirty working tree the user can review and
   * commit. If `false`, the orchestrator only logs the winning worktree
   * path and leaves the base untouched (legacy behavior).
   */
  readonly autoApplyWinner?: boolean;
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
 * Invariants:
 *   - The Judge's hash is captured at start and verified before every keep
 *     decision. Drift aborts the run immediately.
 *   - Each iteration's worktrees are removed before returning, regardless of
 *     keep/revert outcome. Phase 4 will add an opt-in to keep the winning
 *     worktree for human inspection.
 *   - Budget breaches (cost / iterations / wall-time) emit an `abort` record
 *     and exit the loop cleanly.
 */
export class Orchestrator {
  private readonly architect: Architect;
  private readonly workerFactory: () => Worker;
  private readonly judge: Judge;
  private readonly worktrees: WorktreeManager;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly runDirOverride: string | undefined;
  private readonly autoApplyWinner: boolean;

  constructor(deps: OrchestratorDeps) {
    this.architect = deps.architect;
    this.workerFactory = deps.workerFactory;
    this.judge = deps.judge;
    this.worktrees = deps.worktreeManager;
    this.logger = deps.logger.child({ component: "orchestrator" });
    this.now = deps.clock ?? Date.now;
    this.runDirOverride = deps.runDirOverride;
    this.autoApplyWinner = deps.autoApplyWinner ?? true;
  }

  async run(config: EvolveRunConfig): Promise<EvolveRunSummary> {
    const runId = `run-${this.now()}`;
    const startedAtMs = this.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const runDir = this.runDirOverride ?? join(config.target, ".evolve", "runs");
    const expectedJudgeHash = this.judge.hash;

    await this.worktrees.ensureLocalIgnore(".evolve");
    const log = await RunLogger.create(runId, runDir);
    this.logger.info("evolve run started", { runId, config, judgeHash: expectedJudgeHash });

    let bestScore = 0;
    let bestIteration: number | undefined;
    let totalIterations = 0;
    let totalCostUsd = 0;
    let endedAt = startedAt;

    try {
      await this.worktrees.ensureBaseClean();

      const baseline = await this.judge.evaluate({
        worktreePath: config.target,
        iteration: 0,
        previousScore: null,
      });
      if (baseline.judgeHash !== expectedJudgeHash) {
        await this.abort(log, "judge-hash-drift", `baseline hash ${baseline.judgeHash}`);
        endedAt = new Date(this.now()).toISOString();
        return { runId, startedAt, endedAt, config, bestScore, totalIterations, totalCostUsd };
      }
      bestScore = baseline.score;

      await log.append({
        type: "start",
        timestamp: startedAt,
        runId,
        config,
        judgeHash: expectedJudgeHash,
        baselineScore: baseline.score,
      });

      const history: { score: number; summary: string }[] = [];

      for (let i = 1; i <= config.maxIterations; i++) {
        const elapsed = this.now() - startedAtMs;
        if (totalCostUsd >= config.maxCostUsd) {
          await this.abort(log, "budget-cost", `${totalCostUsd.toFixed(4)} USD`);
          break;
        }
        if (elapsed >= config.maxWallTimeMs) {
          await this.abort(log, "budget-wall-time", `${elapsed}ms`);
          break;
        }

        const proposal = await this.architect.proposeHypotheses(
          { target: config.target, previousIterations: history, bestScore },
          config.workersPerIteration,
        );
        totalCostUsd += proposal.costUsd;

        const evaluated = await this.runIteration(i, proposal.hypotheses, expectedJudgeHash);

        if (evaluated.driftDetected) {
          await this.abort(log, "judge-hash-drift", evaluated.driftDetail ?? "(no detail)");
          await this.cleanupAll(evaluated.worktrees);
          break;
        }

        const successful = evaluated.results.filter((r) => r.verdict !== undefined);
        const workerCost = evaluated.results.reduce((sum, r) => sum + r.costUsd, 0);

        if (successful.length === 0) {
          await this.appendIteration(log, {
            iteration: i,
            hypothesisId: proposal.hypotheses[0]?.id ?? "(none)",
            worktree: "",
            score: bestScore,
            previousBest: bestScore,
            kept: false,
            reason: "all workers failed",
            costUsd: workerCost + proposal.costUsd,
          });
          totalCostUsd += workerCost;
          totalIterations++;
          await this.cleanupAll(evaluated.worktrees);
          continue;
        }

        const best = successful.reduce((a, b) =>
          (b.verdict?.score ?? -Infinity) > (a.verdict?.score ?? -Infinity) ? b : a,
        );
        const bestVerdict = best.verdict!;
        const kept = bestVerdict.score > bestScore;
        const iterCost = workerCost + proposal.costUsd;

        await this.appendIteration(log, {
          iteration: i,
          hypothesisId: best.hypothesis.id,
          worktree: best.worktree.path,
          score: bestVerdict.score,
          previousBest: bestScore,
          kept,
          reason: kept ? "score improved" : "score did not improve",
          costUsd: iterCost,
        });

        history.push({ score: bestVerdict.score, summary: best.hypothesis.summary });
        totalCostUsd += workerCost;
        totalIterations++;
        if (kept) {
          bestScore = bestVerdict.score;
          bestIteration = i;
          if (this.autoApplyWinner) {
            const message = `feat(evolve): ${best.hypothesis.summary} (iter=${i}, score=${bestVerdict.score.toFixed(4)})`;
            const apply = await this.worktrees.applyWorktreePatch(best.worktree, message);
            if (apply.applied) {
              this.logger.info("winner applied and committed to base", {
                iteration: i,
                files: apply.files,
                commitSha: apply.commitSha,
              });
            } else {
              this.logger.warn("winner apply skipped or failed", {
                iteration: i,
                reason: apply.reason,
              });
            }
          }
        }

        await this.cleanupAll(evaluated.worktrees);
      }

      endedAt = new Date(this.now()).toISOString();
      await log.append({
        type: "end",
        timestamp: endedAt,
        bestScore,
        bestIteration,
        totalIterations,
        totalCostUsd,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error("evolve run failed", { detail });
      try {
        await this.abort(log, "internal-error", detail);
      } catch {
        // ignore: log may already be closed
      }
      endedAt = new Date(this.now()).toISOString();
    } finally {
      await log.close();
    }

    return { runId, startedAt, endedAt, config, bestScore, bestIteration, totalIterations, totalCostUsd };
  }

  private async runIteration(
    iteration: number,
    hypotheses: readonly Hypothesis[],
    expectedJudgeHash: string,
  ): Promise<{
    results: ReadonlyArray<{
      hypothesis: Hypothesis;
      worktree: WorktreeHandle;
      workerOutput: WorkerOutput | undefined;
      verdict: Awaited<ReturnType<Judge["evaluate"]>> | undefined;
      costUsd: number;
    }>;
    worktrees: readonly WorktreeHandle[];
    driftDetected: boolean;
    driftDetail?: string;
  }> {
    const created: WorktreeHandle[] = [];
    let driftDetail: string | undefined;

    for (const h of hypotheses) {
      const wt = await this.worktrees.create(`iter-${iteration}`, h.id);
      created.push(wt);
    }

    const settled = await Promise.all(
      hypotheses.map(async (h, idx) => {
        const wt = created[idx]!;
        try {
          const worker = this.workerFactory();
          const out = await worker.apply({ hypothesis: h, worktreePath: wt.path, iteration });
          if (!out.success) {
            return { hypothesis: h, worktree: wt, workerOutput: out, verdict: undefined, costUsd: out.costUsd };
          }
          const verdict = await this.judge.evaluate({
            worktreePath: wt.path,
            iteration,
            previousScore: null,
          });
          if (verdict.judgeHash !== expectedJudgeHash) {
            driftDetail = `iteration ${iteration} hypothesis ${h.id}: expected ${expectedJudgeHash}, got ${verdict.judgeHash}`;
            return { hypothesis: h, worktree: wt, workerOutput: out, verdict: undefined, costUsd: out.costUsd };
          }
          return { hypothesis: h, worktree: wt, workerOutput: out, verdict, costUsd: out.costUsd };
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          this.logger.warn("worker iteration failed", { hypothesisId: h.id, detail });
          return { hypothesis: h, worktree: wt, workerOutput: undefined, verdict: undefined, costUsd: 0 };
        }
      }),
    );

    return {
      results: settled,
      worktrees: created,
      driftDetected: driftDetail !== undefined,
      driftDetail,
    };
  }

  private async appendIteration(
    log: RunLogger,
    payload: Omit<RunIterationRecord, "type" | "timestamp">,
  ): Promise<void> {
    await log.append({
      type: "iteration",
      timestamp: new Date(this.now()).toISOString(),
      ...payload,
    });
  }

  private async abort(log: RunLogger, reason: AbortReason, detail: string): Promise<void> {
    this.logger.warn("evolve run aborting", { reason, detail });
    await log.append({
      type: "abort",
      timestamp: new Date(this.now()).toISOString(),
      reason,
      detail,
    });
  }

  private async cleanupAll(handles: readonly WorktreeHandle[]): Promise<void> {
    for (const h of handles) {
      try {
        await this.worktrees.remove(h);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.warn("worktree cleanup failed", { branch: h.branch, detail });
      }
    }
  }
}
