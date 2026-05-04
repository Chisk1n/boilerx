import { resolve as resolvePath } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import type { Logger } from "@boilerx/shared";
import { LocalJudge, loadMetricSpec } from "@boilerx/evolve";

const JUDGE_VERSION = "1.0.0";

export function registerJudgeCommand(program: Command, logger: Logger): void {
  program
    .command("judge")
    .description(
      "Run the Judge standalone over a target project. Useful for tuning metrics before wiring evolve.",
    )
    .option("-t, --target <path>", "Path to the project to judge", process.cwd())
    .option("-m, --metric <file>", "Metric spec relative to target", ".judge/metric.yaml")
    .option("-i, --iteration <n>", "Iteration number (for logging only)", "0")
    .option("--json", "Print verdict as JSON instead of human format")
    .action(async (opts: JudgeOptions) => {
      const target = resolvePath(opts.target);
      const metricFilePath = resolvePath(target, opts.metric);
      logger.info("judge starting", { target, metricFilePath });

      const spec = await loadMetricSpec(metricFilePath);
      const judge = await LocalJudge.create({
        metricFilePath,
        metricSpec: spec,
        judgeVersion: JUDGE_VERSION,
        logger,
      });
      const verdict = await judge.evaluate({
        worktreePath: target,
        iteration: Number(opts.iteration),
        previousScore: null,
      });

      if (opts.json) {
        console.log(JSON.stringify(verdict, null, 2));
        return;
      }

      console.log("");
      console.log(pc.bold(pc.cyan("boilerX :: judge verdict")));
      console.log(pc.dim("───────────────────────────────────────────"));
      console.log(`  ${pc.bold("score")}      ${formatScore(verdict.score)}`);
      console.log(`  ${pc.bold("hash")}       ${verdict.judgeHash.slice(0, 16)}…`);
      console.log("");
      console.log(pc.bold("  breakdown"));
      console.log(`    tests        ${bar(verdict.breakdown.testsPassing)} ${pct(verdict.breakdown.testsPassing)}  (w=${spec.weights.testsPassing})`);
      console.log(`    coverage     ${bar(verdict.breakdown.coverageDelta)} ${pct(verdict.breakdown.coverageDelta)}  (w=${spec.weights.coverageDelta})`);
      console.log(`    benchmark    ${bar(verdict.breakdown.benchmarkScore)} ${pct(verdict.breakdown.benchmarkScore)}  (w=${spec.weights.benchmarkScore})`);
      console.log(`    lint         ${bar(verdict.breakdown.lintScore)} ${pct(verdict.breakdown.lintScore)}  (w=${spec.weights.lintScore})`);
      console.log(`    llm-judge    ${bar(verdict.breakdown.llmJudgeRubric)} ${pct(verdict.breakdown.llmJudgeRubric)}  (w=${spec.weights.llmJudgeRubric})`);
      console.log("");
      if (verdict.aborted) {
        console.log(pc.red(`  aborted: ${verdict.abortReason ?? "unknown"}`));
      }
      console.log(pc.dim("  full execution logs in --json mode (`boiler judge --json | jq .logs`)"));
      console.log("");
    });
}

interface JudgeOptions {
  readonly target: string;
  readonly metric: string;
  readonly iteration: string;
  readonly json?: boolean;
}

function formatScore(s: number): string {
  const text = s.toFixed(4);
  if (s >= 0.8) return pc.green(text);
  if (s >= 0.5) return pc.yellow(text);
  return pc.red(text);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1).padStart(5)}%`;
}

function bar(v: number, width = 20): string {
  const filled = Math.round(v * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}
