import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import type { JudgeVerdict, Logger, MetricBreakdown } from "@boilerx/shared";
import { combineMetric, type CompositeMetricSpec, type Judge, type JudgeInput } from "./judge.js";
import { runCommand, type RunResult } from "./exec.js";
import {
  parseBenchmarkResult,
  parseCoverageResult,
  parseLintResult,
  parseTestsResult,
} from "./parsers.js";

export interface LocalJudgeOptions {
  readonly metricFilePath: string;
  readonly metricSpec: CompositeMetricSpec;
  readonly judgeVersion: string;
  readonly logger: Logger;
}

/**
 * Runs the Judge in-process on the host (no Docker sandbox yet — Phase 2).
 *
 * `hash` pins:
 *   sha256(judgeVersion || metricFile contents || metric spec JSON)
 *
 * Workers cannot influence any of these inputs without modifying tracked
 * files; the Orchestrator (Phase 2) will refuse to keep any iteration that
 * causes the hash to drift.
 */
export class LocalJudge implements Judge {
  readonly hash: string;
  private readonly spec: CompositeMetricSpec;
  private readonly logger: Logger;

  private constructor(opts: LocalJudgeOptions, hash: string) {
    this.spec = opts.metricSpec;
    this.logger = opts.logger.child({ component: "judge" });
    this.hash = hash;
  }

  static async create(opts: LocalJudgeOptions): Promise<LocalJudge> {
    const metricFileContents = await readFile(resolvePath(opts.metricFilePath), "utf8");
    const hash = createHash("sha256")
      .update(`v=${opts.judgeVersion}\n`)
      .update(metricFileContents)
      .update("\n---spec---\n")
      .update(JSON.stringify(opts.metricSpec))
      .digest("hex");
    return new LocalJudge(opts, hash);
  }

  async evaluate(input: JudgeInput): Promise<JudgeVerdict> {
    const cwd = resolvePath(input.worktreePath);
    const timeoutMs = this.spec.timeoutSeconds * 1000;
    this.logger.info("evaluating", { cwd, iteration: input.iteration, hash: this.hash });

    const breakdown: { -readonly [K in keyof MetricBreakdown]: number } = {
      testsPassing: 0,
      coverageDelta: 0,
      benchmarkScore: 0,
      lintScore: 0,
      llmJudgeRubric: 0,
    };
    const logs: string[] = [];

    const tests = await runAndLog("tests", this.spec.testsCommand, cwd, timeoutMs, logs);
    breakdown.testsPassing = parseTestsResult(tests).value;

    const cov = await runAndLog("coverage", this.spec.coverageCommand, cwd, timeoutMs, logs);
    breakdown.coverageDelta = parseCoverageResult(cov).value;

    if (this.spec.lintCommand && this.spec.weights.lintScore > 0) {
      const lint = await runAndLog("lint", this.spec.lintCommand, cwd, timeoutMs, logs);
      breakdown.lintScore = parseLintResult(lint).value;
    }

    if (this.spec.benchmarkCommand && this.spec.weights.benchmarkScore > 0) {
      const bench = await runAndLog("benchmark", this.spec.benchmarkCommand, cwd, timeoutMs, logs);
      breakdown.benchmarkScore = parseBenchmarkResult(bench).value;
    }

    if (this.spec.weights.llmJudgeRubric > 0) {
      logs.push("[llm-judge] not implemented in standalone Judge; weight ignored.");
    }

    const score = combineMetric(breakdown, this.spec.weights);
    this.logger.info("verdict", { score, breakdown, hash: this.hash });

    return {
      score,
      breakdown,
      logs: logs.join("\n\n"),
      aborted: false,
      judgeHash: this.hash,
    };
  }
}

async function runAndLog(
  label: string,
  command: string,
  cwd: string,
  timeoutMs: number,
  logs: string[],
): Promise<RunResult> {
  const result = await runCommand(command, { cwd, timeoutMs });
  logs.push(
    `--- ${label}: \`${command}\` (exit=${String(result.exitCode)}, ${result.durationMs}ms${result.timedOut ? ", TIMED OUT" : ""}) ---\n` +
      `[stdout]\n${truncate(result.stdout)}\n[stderr]\n${truncate(result.stderr)}`,
  );
  return result;
}

function truncate(s: string, max = 4000): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}
