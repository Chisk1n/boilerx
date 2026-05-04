import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMetricSpec } from "../src/metric-loader.js";

describe("loadMetricSpec", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "boilerx-judge-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  async function writeSpec(content: string): Promise<string> {
    const p = join(tmp, "metric.yaml");
    await writeFile(p, content, "utf8");
    return p;
  }

  it("loads a valid spec with default weights when all commands are present", async () => {
    const p = await writeSpec(`
testsCommand: "npm test"
coverageCommand: "npm run cov"
benchmarkCommand: "npm run bench"
lintCommand: "npm run lint"
llmJudgeRubricPath: "rubric.md"
`);
    const spec = await loadMetricSpec(p);
    expect(spec.testsCommand).toBe("npm test");
    expect(spec.coverageCommand).toBe("npm run cov");
    expect(spec.timeoutSeconds).toBe(300);
    const w = spec.weights;
    const total =
      w.testsPassing + w.coverageDelta + w.benchmarkScore + w.lintScore + w.llmJudgeRubric;
    expect(total).toBeCloseTo(1.0, 6);
  });

  it("loads a minimal spec when extra weights are zeroed out", async () => {
    const p = await writeSpec(`
testsCommand: "npm test"
coverageCommand: "npm run cov"
weights:
  testsPassing: 0.7
  coverageDelta: 0.3
  benchmarkScore: 0.0
  lintScore: 0.0
  llmJudgeRubric: 0.0
`);
    const spec = await loadMetricSpec(p);
    expect(spec.weights.testsPassing).toBe(0.7);
    expect(spec.weights.benchmarkScore).toBe(0);
  });

  it("rejects weights that don't sum to 1.0", async () => {
    const p = await writeSpec(`
testsCommand: "x"
coverageCommand: "x"
weights:
  testsPassing: 0.5
  coverageDelta: 0.1
  benchmarkScore: 0.1
  lintScore: 0.1
  llmJudgeRubric: 0.1
`);
    await expect(loadMetricSpec(p)).rejects.toThrow(/sum to 1\.0/);
  });

  it("rejects missing required fields", async () => {
    const p = await writeSpec(`
testsCommand: "npm test"
`);
    await expect(loadMetricSpec(p)).rejects.toThrow(/coverageCommand/);
  });

  it("rejects benchmark weight without command", async () => {
    const p = await writeSpec(`
testsCommand: "x"
coverageCommand: "x"
weights:
  testsPassing: 0.4
  coverageDelta: 0.15
  benchmarkScore: 0.25
  lintScore: 0.1
  llmJudgeRubric: 0.1
llmJudgeRubricPath: "rubric.md"
lintCommand: "lint"
`);
    await expect(loadMetricSpec(p)).rejects.toThrow(/benchmarkCommand/);
  });

  it("rejects llmJudgeRubric weight without rubric path", async () => {
    const p = await writeSpec(`
testsCommand: "x"
coverageCommand: "x"
weights:
  testsPassing: 0.4
  coverageDelta: 0.15
  benchmarkScore: 0.25
  lintScore: 0.1
  llmJudgeRubric: 0.1
benchmarkCommand: "bench"
lintCommand: "lint"
`);
    await expect(loadMetricSpec(p)).rejects.toThrow(/llmJudgeRubricPath/);
  });

  it("rejects invalid YAML", async () => {
    const p = await writeSpec("this: is: not: yaml::");
    await expect(loadMetricSpec(p)).rejects.toThrow();
  });
});
