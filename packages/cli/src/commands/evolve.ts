import { resolve as resolvePath } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import type { Logger } from "@boilerx/shared";
import {
  CursorWorker,
  LocalJudge,
  Orchestrator,
  StubArchitect,
  StubWorker,
  WorktreeManager,
  loadMetricSpec,
  type Worker,
} from "@boilerx/evolve";

const JUDGE_VERSION = "1.0.0";
const RUNTIMES = ["stub", "cursor"] as const;
type Runtime = (typeof RUNTIMES)[number];

export function registerEvolveCommand(program: Command, logger: Logger): void {
  program
    .command("evolve")
    .description(
      "Run the autonomous code-evolution loop (architect + workers + judge) over a target project.",
    )
    .option("-t, --target <path>", "Path to the project to evolve", process.cwd())
    .option("-m, --metric <file>", "Metric spec relative to target", ".judge/metric.yaml")
    .option("-i, --max-iterations <n>", "Hard cap on iterations", "5")
    .option("-w, --workers <n>", "Workers per iteration", "2")
    .option("--max-cost-usd <usd>", "Hard cap on LLM spend (USD)", "1.00")
    .option("--max-wall-min <min>", "Hard cap on wall-clock minutes", "30")
    .option("--model <id>", "LLM model identifier (Cursor SDK model id)", "composer-2")
    .option(
      "--runtime <kind>",
      `Worker runtime: ${RUNTIMES.join(" | ")}. Default 'stub' (deterministic, no LLM).`,
      "stub",
    )
    .action(async (opts: EvolveOptions) => {
      const target = resolvePath(opts.target);
      const metricFilePath = resolvePath(target, opts.metric);
      const runtime = parseRuntime(opts.runtime);

      logger.info("evolve starting", { target, metricFilePath, runtime, model: opts.model });

      const spec = await loadMetricSpec(metricFilePath);
      const judge = await LocalJudge.create({
        metricFilePath,
        metricSpec: spec,
        judgeVersion: JUDGE_VERSION,
        logger,
      });
      const wt = new WorktreeManager({
        baseRepoPath: target,
        worktreesDir: resolvePath(target, ".evolve", "worktrees"),
        logger,
      });
      const architect = new StubArchitect({
        hypotheses: [
          {
            summary: "no-op exploration baseline",
            rationale:
              "Stub architect: every hypothesis is a no-op until a real LLM-backed Architect ships.",
            affectedFiles: [],
          },
        ],
      });

      const workerFactory = buildWorkerFactory(runtime, opts.model, logger);

      const orch = new Orchestrator({
        architect,
        workerFactory,
        judge,
        worktreeManager: wt,
        logger,
      });

      const summary = await orch.run({
        target,
        metricFile: metricFilePath,
        maxIterations: Number(opts.maxIterations),
        workersPerIteration: Number(opts.workers),
        maxCostUsd: Number(opts.maxCostUsd),
        maxWallTimeMs: Number(opts.maxWallMin) * 60_000,
        model: opts.model,
      });

      console.log("");
      console.log(pc.bold(pc.magenta("boilerX :: evolve summary")));
      console.log(pc.dim("───────────────────────────────────────────"));
      console.log(`  ${pc.bold("runId")}            ${summary.runId}`);
      console.log(`  ${pc.bold("runtime")}          ${runtime}`);
      console.log(`  ${pc.bold("model")}            ${opts.model}`);
      console.log(`  ${pc.bold("started")}          ${summary.startedAt}`);
      console.log(`  ${pc.bold("ended")}            ${summary.endedAt ?? "(in progress)"}`);
      console.log(`  ${pc.bold("iterations")}       ${summary.totalIterations}`);
      console.log(`  ${pc.bold("best score")}       ${summary.bestScore.toFixed(4)}`);
      console.log(
        `  ${pc.bold("best iteration")}   ${summary.bestIteration ?? pc.dim("(baseline still best)")}`,
      );
      console.log(`  ${pc.bold("total cost")}       $${summary.totalCostUsd.toFixed(4)}`);
      console.log("");
      console.log(pc.dim(`  log: ${target}/.evolve/runs/${summary.runId}.jsonl`));
      console.log("");
    });
}

function parseRuntime(value: string): Runtime {
  if ((RUNTIMES as readonly string[]).includes(value)) return value as Runtime;
  throw new Error(`Unknown runtime '${value}'. Valid: ${RUNTIMES.join(", ")}`);
}

function buildWorkerFactory(runtime: Runtime, model: string, logger: Logger): () => Worker {
  switch (runtime) {
    case "stub":
      return () => new StubWorker({ mutate: () => [], costUsd: 0 });
    case "cursor": {
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey || apiKey.trim() === "") {
        throw new Error(
          "CURSOR_API_KEY is required for runtime=cursor. Set it in .env or your shell, then re-run with `node --env-file=.env packages/cli/dist/index.js evolve --runtime cursor`.",
        );
      }
      return () => new CursorWorker({ apiKey, model, logger });
    }
  }
}

interface EvolveOptions {
  readonly target: string;
  readonly metric: string;
  readonly maxIterations: string;
  readonly workers: string;
  readonly maxCostUsd: string;
  readonly maxWallMin: string;
  readonly model: string;
  readonly runtime: string;
}
