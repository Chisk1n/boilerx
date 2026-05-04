import type { Command } from "commander";
import pc from "picocolors";
import type { Logger } from "@boilerx/shared";

export function registerEvolveCommand(program: Command, logger: Logger): void {
  program
    .command("evolve")
    .description(
      "Run the autonomous code-evolution loop (Capa 2: architect + workers + judge).",
    )
    .option("-t, --target <path>", "Path to the project to evolve", process.cwd())
    .option("-m, --metric <file>", "Path to the judge metric spec", ".judge/metric.yaml")
    .option("-i, --max-iterations <n>", "Hard cap on iterations", "20")
    .option("-w, --workers <n>", "Workers per iteration", "3")
    .option("--max-cost-usd <usd>", "Hard cap on LLM spend (USD)", "5.00")
    .option("--max-wall-min <min>", "Hard cap on wall-clock minutes", "60")
    .option("--model <id>", "LLM model identifier", "claude-sonnet-4-5")
    .action(async (opts: EvolveOptions) => {
      logger.info("evolve invoked (Phase 0 stub)", { ...opts });
      console.log("");
      console.log(pc.bold(pc.magenta("boilerX :: evolve")));
      console.log(pc.dim("───────────────────────────────────────────"));
      console.log(`  target           ${opts.target}`);
      console.log(`  metric           ${opts.metric}`);
      console.log(`  max iterations   ${opts.maxIterations}`);
      console.log(`  workers/iter     ${opts.workers}`);
      console.log(`  max cost (USD)   $${opts.maxCostUsd}`);
      console.log(`  max wall (min)   ${opts.maxWallMin}`);
      console.log(`  model            ${opts.model}`);
      console.log("");
      console.log(
        pc.yellow(
          "[ Phase 0 ] Orchestrator not implemented yet. " +
            "Design lives in docs/EVOLVE.md; implementation lands in Phase 2.",
        ),
      );
      console.log("");
    });
}

interface EvolveOptions {
  readonly target: string;
  readonly metric: string;
  readonly maxIterations: string;
  readonly workers: string;
  readonly maxCostUsd: string;
  readonly maxWallMin: string;
  readonly model: string;
}
