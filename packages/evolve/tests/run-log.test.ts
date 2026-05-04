import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunRecord } from "@boilerx/shared";
import { RunLogger, readRunLog, summarizeRunLog } from "../src/run-log.js";

describe("RunLogger", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "boilerx-runlog-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("appends records as JSONL and reads them back losslessly", async () => {
    const log = await RunLogger.create("run-1", tmp);
    const records: RunRecord[] = [
      {
        type: "start",
        timestamp: "2026-05-04T00:00:00Z",
        runId: "run-1",
        config: {
          target: "/x",
          metricFile: "m.yaml",
          maxIterations: 5,
          maxWallTimeMs: 60_000,
          maxCostUsd: 1,
          workersPerIteration: 2,
          model: "test",
        },
        judgeHash: "abc",
        baselineScore: 0.5,
      },
      {
        type: "iteration",
        timestamp: "2026-05-04T00:00:10Z",
        iteration: 1,
        hypothesisId: "h-1",
        worktree: "/x/.evolve/worktrees/run-1/h-1",
        score: 0.6,
        previousBest: 0.5,
        kept: true,
        reason: "score improved",
        costUsd: 0.01,
      },
      {
        type: "end",
        timestamp: "2026-05-04T00:01:00Z",
        bestScore: 0.6,
        bestIteration: 1,
        totalIterations: 1,
        totalCostUsd: 0.01,
      },
    ];
    for (const r of records) await log.append(r);
    await log.close();

    const read = await readRunLog(log.path);
    expect(read).toEqual(records);
  });

  it("rejects appends after close", async () => {
    const log = await RunLogger.create("run-2", tmp);
    await log.close();
    await expect(
      log.append({
        type: "abort",
        timestamp: "now",
        reason: "user-cancelled",
      }),
    ).rejects.toThrow(/already closed/);
  });

  it("rejects unsafe runId characters", async () => {
    await expect(RunLogger.create("../etc/passwd", tmp)).rejects.toThrow();
  });

  it("readRunLog rejects malformed JSON", async () => {
    const log = await RunLogger.create("run-3", tmp);
    await log.append({ type: "start", timestamp: "t", runId: "run-3", config: {} as never, judgeHash: "h", baselineScore: 0 });
    await log.close();

    const { writeFile, readFile } = await import("node:fs/promises");
    const corrupted = (await readFile(log.path, "utf8")) + "\nthis is not json\n";
    await writeFile(log.path, corrupted, "utf8");

    await expect(readRunLog(log.path)).rejects.toThrow(/Invalid JSON/);
  });

  it("readRunLog rejects records with unknown type", async () => {
    const log = await RunLogger.create("run-4", tmp);
    await log.close();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(log.path, `${JSON.stringify({ type: "bogus" })}\n`, "utf8");
    await expect(readRunLog(log.path)).rejects.toThrow(/RunRecord/);
  });

  describe("summarizeRunLog", () => {
    it("returns the best score across kept iterations", () => {
      const records: RunRecord[] = [
        { type: "start", timestamp: "t", runId: "r", config: {} as never, judgeHash: "h", baselineScore: 0.4 },
        { type: "iteration", timestamp: "t", iteration: 1, hypothesisId: "h1", worktree: "/", score: 0.5, previousBest: 0.4, kept: true, reason: "", costUsd: 0.1 },
        { type: "iteration", timestamp: "t", iteration: 2, hypothesisId: "h2", worktree: "/", score: 0.7, previousBest: 0.5, kept: true, reason: "", costUsd: 0.1 },
        { type: "iteration", timestamp: "t", iteration: 3, hypothesisId: "h3", worktree: "/", score: 0.6, previousBest: 0.7, kept: false, reason: "regressed", costUsd: 0.1 },
        { type: "end", timestamp: "t", bestScore: 0.7, bestIteration: 2, totalIterations: 3, totalCostUsd: 0.3 },
      ];
      const s = summarizeRunLog(records);
      expect(s.bestScore).toBeCloseTo(0.7);
      expect(s.bestIteration).toBe(2);
      expect(s.totalIterations).toBe(3);
      expect(s.totalCostUsd).toBeCloseTo(0.3);
      expect(s.aborted).toBe(false);
    });

    it("flags aborted runs", () => {
      const s = summarizeRunLog([
        { type: "start", timestamp: "t", runId: "r", config: {} as never, judgeHash: "h", baselineScore: 0 },
        { type: "abort", timestamp: "t", reason: "judge-hash-drift", detail: "expected x, got y" },
      ]);
      expect(s.aborted).toBe(true);
      expect(s.abortReason).toBe("judge-hash-drift: expected x, got y");
    });
  });
});
