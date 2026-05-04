/**
 * Output parsers for the composite metric components.
 *
 * Each parser is total: it always returns a number in [0, 1] even when input
 * is malformed (worst-case 0). The Judge logs the raw output for auditability.
 */

import type { RunResult } from "./exec.js";

export interface ParsedAxis {
  readonly value: number;
  readonly note: string;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Tests-passing axis.
 *
 * Strategy:
 *   1. If exitCode === 0, assume 100% pass and return 1.0.
 *   2. If exitCode !== 0, look for `passed: X / Y` style output. If we can't
 *      find it, return 0 (penalize unparseable failures).
 *
 * This is intentionally conservative. Stack templates (Phase 1) will emit a
 * structured summary the parser can latch onto.
 */
export function parseTestsResult(run: RunResult): ParsedAxis {
  if (run.timedOut) return { value: 0, note: "tests timed out" };
  if (run.exitCode === 0) return { value: 1, note: "all tests passed" };

  const combined = `${run.stdout}\n${run.stderr}`;
  const jest = combined.match(/Tests:\s+(\d+)\s+passed.*?(\d+)\s+total/is);
  if (jest) {
    const passed = Number(jest[1]);
    const total = Number(jest[2]);
    if (total > 0) {
      return { value: clamp01(passed / total), note: `${passed}/${total} (jest)` };
    }
  }

  const mocha = combined.match(/(\d+)\s+passing[\s\S]*?(\d+)\s+failing/i);
  if (mocha) {
    const passed = Number(mocha[1]);
    const failing = Number(mocha[2]);
    const total = passed + failing;
    if (total > 0) {
      return { value: clamp01(passed / total), note: `${passed}/${total} (mocha)` };
    }
  }

  const slash = combined.match(/(\d+)\/(\d+)\s+(?:passed|tests passing)/i);
  if (slash) {
    const passed = Number(slash[1]);
    const total = Number(slash[2]);
    if (total > 0) {
      return { value: clamp01(passed / total), note: `${passed}/${total} (slash)` };
    }
  }

  const nodeTest = combined.match(/(?:ℹ\s*)?pass\s+(\d+)[\s\S]*?(?:ℹ\s*)?fail\s+(\d+)/i);
  if (nodeTest) {
    const passed = Number(nodeTest[1]);
    const failing = Number(nodeTest[2]);
    const total = passed + failing;
    if (total > 0) {
      return { value: clamp01(passed / total), note: `${passed}/${total} (node:test)` };
    }
  }

  return { value: 0, note: `tests failed (exit ${String(run.exitCode)})` };
}

/**
 * Coverage axis. Looks for `All files | XX.YY |` in Istanbul/c8/lcov-summary
 * style output, or `TOTAL ... XX%` for coverage.py. Returns coverage / 100.
 *
 * NOTE: The contract type calls this "coverageDelta" but for the standalone
 * judge we use absolute coverage. Phase 2 turns this into a delta vs baseline.
 */
export function parseCoverageResult(run: RunResult): ParsedAxis {
  if (run.timedOut) return { value: 0, note: "coverage timed out" };

  const combined = `${run.stdout}\n${run.stderr}`;

  const istanbul = combined.match(/all files\s*\|\s*([\d.]+)\s*\|/i);
  if (istanbul) {
    const pct = Number(istanbul[1]);
    if (!Number.isNaN(pct)) {
      return { value: clamp01(pct / 100), note: `${pct.toFixed(2)}% (istanbul/node:test)` };
    }
  }

  const coveragePy = combined.match(/^TOTAL\s+\d+\s+\d+\s+(\d+)%/m);
  if (coveragePy) {
    const pct = Number(coveragePy[1]);
    if (!Number.isNaN(pct)) {
      return { value: clamp01(pct / 100), note: `${pct}% (coverage.py)` };
    }
  }

  const generic = combined.match(/coverage[^%\n]*?([\d.]+)\s*%/i);
  if (generic) {
    const pct = Number(generic[1]);
    if (!Number.isNaN(pct)) {
      return { value: clamp01(pct / 100), note: `${pct}% (heuristic)` };
    }
  }

  return { value: 0, note: "coverage not parseable" };
}

/**
 * Lint axis. Counts violations and converts to a [0,1] score. `maxViolations`
 * is the floor at which score becomes 0. Default 50 is conservative — projects
 * with stricter expectations should override via the metric file (future).
 */
export function parseLintResult(run: RunResult, maxViolations = 50): ParsedAxis {
  if (run.timedOut) return { value: 0, note: "lint timed out" };
  if (run.exitCode === 0) return { value: 1, note: "lint clean" };

  const combined = `${run.stdout}\n${run.stderr}`;

  const eslint = combined.match(/(\d+)\s+problems?\s*\(/i);
  if (eslint) {
    const violations = Number(eslint[1]);
    return {
      value: clamp01(1 - violations / maxViolations),
      note: `${violations} violations (eslint)`,
    };
  }

  const ruff = combined.match(/Found\s+(\d+)\s+errors?/i);
  if (ruff) {
    const violations = Number(ruff[1]);
    return {
      value: clamp01(1 - violations / maxViolations),
      note: `${violations} violations (ruff)`,
    };
  }

  const biome = combined.match(/(\d+)\s+errors?/i);
  if (biome) {
    const violations = Number(biome[1]);
    return {
      value: clamp01(1 - violations / maxViolations),
      note: `${violations} violations (heuristic)`,
    };
  }

  return { value: 0, note: `lint failed (exit ${String(run.exitCode)})` };
}

/**
 * Benchmark axis. Looks for a single line like
 *   `EVOLVE_BENCHMARK_SCORE=0.84`
 * which projects opt into emitting from their bench harness. Anything else is
 * untrustworthy noise we'd rather refuse than guess at.
 */
export function parseBenchmarkResult(run: RunResult): ParsedAxis {
  if (run.timedOut) return { value: 0, note: "benchmark timed out" };

  const combined = `${run.stdout}\n${run.stderr}`;
  const match = combined.match(/EVOLVE_BENCHMARK_SCORE\s*=\s*([\d.]+)/);
  if (match) {
    const value = Number(match[1]);
    if (!Number.isNaN(value)) {
      return { value: clamp01(value), note: `${value}` };
    }
  }
  return { value: 0, note: "no EVOLVE_BENCHMARK_SCORE=… line found" };
}
