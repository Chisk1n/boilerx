import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLogger } from "@boilerx/shared";
import { LocalJudge } from "../src/local-judge.js";
import { loadMetricSpec } from "../src/metric-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/sample-node-api");
const SILENT_LOGGER = createLogger({ level: "error" });

describe("LocalJudge end-to-end on fixture", () => {
  it("hash is deterministic across instances with same inputs", async () => {
    const metricFilePath = resolve(FIXTURE, ".judge/metric.yaml");
    const spec = await loadMetricSpec(metricFilePath);
    const j1 = await LocalJudge.create({
      metricFilePath,
      metricSpec: spec,
      judgeVersion: "test",
      logger: SILENT_LOGGER,
    });
    const j2 = await LocalJudge.create({
      metricFilePath,
      metricSpec: spec,
      judgeVersion: "test",
      logger: SILENT_LOGGER,
    });
    expect(j1.hash).toBe(j2.hash);
    expect(j1.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash changes when judgeVersion changes (anti-tamper signal)", async () => {
    const metricFilePath = resolve(FIXTURE, ".judge/metric.yaml");
    const spec = await loadMetricSpec(metricFilePath);
    const j1 = await LocalJudge.create({
      metricFilePath,
      metricSpec: spec,
      judgeVersion: "v1",
      logger: SILENT_LOGGER,
    });
    const j2 = await LocalJudge.create({
      metricFilePath,
      metricSpec: spec,
      judgeVersion: "v2",
      logger: SILENT_LOGGER,
    });
    expect(j1.hash).not.toBe(j2.hash);
  });

  it("evaluates the sample-node-api fixture and produces a score in [0,1]", async () => {
    const metricFilePath = resolve(FIXTURE, ".judge/metric.yaml");
    const spec = await loadMetricSpec(metricFilePath);
    const judge = await LocalJudge.create({
      metricFilePath,
      metricSpec: spec,
      judgeVersion: "test",
      logger: SILENT_LOGGER,
    });
    const verdict = await judge.evaluate({
      worktreePath: FIXTURE,
      iteration: 1,
      previousScore: null,
    });

    expect(verdict.aborted).toBe(false);
    expect(verdict.score).toBeGreaterThanOrEqual(0);
    expect(verdict.score).toBeLessThanOrEqual(1);
    expect(verdict.judgeHash).toBe(judge.hash);

    expect(verdict.breakdown.testsPassing).toBeGreaterThanOrEqual(0.99);
    expect(verdict.breakdown.lintScore).toBe(1);

    expect(verdict.score).toBeGreaterThanOrEqual(0.6);
  }, 60_000);
});
