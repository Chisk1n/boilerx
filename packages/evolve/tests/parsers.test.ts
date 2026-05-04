import { describe, expect, it } from "vitest";
import {
  parseBenchmarkResult,
  parseCoverageResult,
  parseLintResult,
  parseTestsResult,
} from "../src/parsers.js";
import type { RunResult } from "../src/exec.js";

const ok = (stdout: string, stderr = ""): RunResult => ({
  exitCode: 0,
  stdout,
  stderr,
  timedOut: false,
  durationMs: 1,
});
const fail = (stdout: string, stderr = "", code = 1): RunResult => ({
  exitCode: code,
  stdout,
  stderr,
  timedOut: false,
  durationMs: 1,
});
const timeout: RunResult = {
  exitCode: null,
  stdout: "",
  stderr: "",
  timedOut: true,
  durationMs: 60_000,
};

describe("parseTestsResult", () => {
  it("returns 1 on exit 0", () => {
    expect(parseTestsResult(ok("any output")).value).toBe(1);
  });
  it("parses jest-style 'Tests: X passed, Y total'", () => {
    const r = fail("...\nTests:       3 passed, 5 total\n");
    expect(parseTestsResult(r).value).toBeCloseTo(3 / 5, 6);
  });
  it("parses mocha-style 'X passing / Y failing' as passed/(passed+failing)", () => {
    const r = fail("8 passing\n2 failing\n");
    expect(parseTestsResult(r).value).toBeCloseTo(8 / 10, 6);
  });

  it("parses node:test 'pass N / fail M' lines", () => {
    const r = fail(
      "ℹ tests 5\nℹ pass 4\nℹ fail 1\nℹ skipped 0\n",
    );
    expect(parseTestsResult(r).value).toBeCloseTo(4 / 5, 6);
  });
  it("returns 0 on timeout", () => {
    expect(parseTestsResult(timeout).value).toBe(0);
  });
  it("returns 0 when output is unparseable failure", () => {
    expect(parseTestsResult(fail("garbage")).value).toBe(0);
  });
});

describe("parseCoverageResult", () => {
  it("parses istanbul 'All files | 87.50 |'", () => {
    const r = ok("------------|---------|\nAll files   |   87.50 |\n");
    expect(parseCoverageResult(r).value).toBeCloseTo(0.875, 6);
  });
  it("parses coverage.py 'TOTAL ... 92%'", () => {
    const r = ok("Name      Stmts   Miss  Cover\nTOTAL       100     8    92%\n");
    expect(parseCoverageResult(r).value).toBeCloseTo(0.92, 6);
  });
  it("falls back to generic '... coverage 73.4%'", () => {
    const r = ok("statement coverage 73.4%");
    expect(parseCoverageResult(r).value).toBeCloseTo(0.734, 6);
  });
  it("returns 0 when nothing matches", () => {
    expect(parseCoverageResult(ok("nothing useful")).value).toBe(0);
  });
});

describe("parseLintResult", () => {
  it("returns 1 on exit 0", () => {
    expect(parseLintResult(ok("clean")).value).toBe(1);
  });
  it("parses eslint '12 problems ('", () => {
    const r = fail("✖ 12 problems (10 errors, 2 warnings)");
    expect(parseLintResult(r, 50).value).toBeCloseTo(1 - 12 / 50, 6);
  });
  it("parses ruff 'Found 3 errors'", () => {
    const r = fail("Found 3 errors.");
    expect(parseLintResult(r, 50).value).toBeCloseTo(1 - 3 / 50, 6);
  });
  it("clamps to 0 when violations exceed max", () => {
    const r = fail("99 problems (");
    expect(parseLintResult(r, 50).value).toBe(0);
  });
});

describe("parseBenchmarkResult", () => {
  it("parses EVOLVE_BENCHMARK_SCORE=0.84", () => {
    expect(parseBenchmarkResult(ok("EVOLVE_BENCHMARK_SCORE=0.84")).value).toBeCloseTo(0.84, 6);
  });
  it("clamps over-1 values", () => {
    expect(parseBenchmarkResult(ok("EVOLVE_BENCHMARK_SCORE=2.5")).value).toBe(1);
  });
  it("returns 0 when no marker is present", () => {
    expect(parseBenchmarkResult(ok("just noise")).value).toBe(0);
  });
});
