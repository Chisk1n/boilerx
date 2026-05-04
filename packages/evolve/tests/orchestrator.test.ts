import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type EvolveRunConfig, type JudgeInput, type JudgeVerdict } from "@boilerx/shared";
import { Orchestrator } from "../src/orchestrator.js";
import { StubArchitect } from "../src/stub-architect.js";
import { StubWorker } from "../src/stub-worker.js";
import { WorktreeManager } from "../src/worktree.js";
import { readRunLog } from "../src/run-log.js";
import { runCommand } from "../src/exec.js";
import type { Judge } from "../src/judge.js";

const SILENT_LOGGER = createLogger({ level: "error" });

async function git(cwd: string, ...args: string[]): Promise<void> {
  const r = await runCommand(`git ${args.map((a) => (/[ "']/.test(a) ? `"${a}"` : a)).join(" ")}`, {
    cwd,
    timeoutMs: 30_000,
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
}

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "boilerx-orch-"));
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.email", "test@boilerx.local");
  await git(repo, "config", "user.name", "boilerx-test");
  await writeFile(join(repo, "score.txt"), "0\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "initial");
  return repo;
}

class ProgrammableJudge implements Judge {
  readonly hash: string;
  private readonly scoreFn: (input: JudgeInput) => Promise<number> | number;
  private readonly hashOverride?: () => string;

  constructor(opts: {
    hash: string;
    scoreFn: (input: JudgeInput) => Promise<number> | number;
    hashOverride?: () => string;
  }) {
    this.hash = opts.hash;
    this.scoreFn = opts.scoreFn;
    this.hashOverride = opts.hashOverride;
  }

  async evaluate(input: JudgeInput): Promise<JudgeVerdict> {
    const score = await this.scoreFn(input);
    const judgeHash = this.hashOverride ? this.hashOverride() : this.hash;
    return {
      score,
      breakdown: {
        testsPassing: score,
        coverageDelta: 0,
        benchmarkScore: 0,
        lintScore: 0,
        llmJudgeRubric: 0,
      },
      logs: "",
      aborted: false,
      judgeHash,
    };
  }
}

describe("Orchestrator", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  function makeOrch(opts: {
    judge: Judge;
    workerMutate?: (input: { worktreePath: string; iteration: number }) => Promise<readonly string[]> | readonly string[];
    workerCostUsd?: number;
  }): Orchestrator {
    const wt = new WorktreeManager({
      baseRepoPath: repo,
      worktreesDir: join(repo, ".evolve", "worktrees"),
      logger: SILENT_LOGGER,
    });
    const arch = new StubArchitect({
      hypotheses: [
        { summary: "stub change A", rationale: "test", affectedFiles: ["score.txt"] },
        { summary: "stub change B", rationale: "test", affectedFiles: ["score.txt"] },
      ],
    });
    return new Orchestrator({
      architect: arch,
      workerFactory: () =>
        new StubWorker({
          mutate: async (input) => {
            if (opts.workerMutate) {
              return await opts.workerMutate({ worktreePath: input.worktreePath, iteration: input.iteration });
            }
            return [];
          },
          costUsd: opts.workerCostUsd ?? 0.01,
        }),
      judge: opts.judge,
      worktreeManager: wt,
      logger: SILENT_LOGGER,
      runDirOverride: join(repo, ".evolve", "runs"),
    });
  }

  const baseConfig = (overrides: Partial<EvolveRunConfig> = {}): EvolveRunConfig => ({
    target: "/will-be-overridden",
    metricFile: ".judge/metric.yaml",
    maxIterations: 3,
    maxWallTimeMs: 60_000,
    maxCostUsd: 1.0,
    workersPerIteration: 2,
    model: "test",
    ...overrides,
  });

  it("runs to completion, keeps the best score, and writes a valid JSONL log", async () => {
    let calls = 0;
    const judge = new ProgrammableJudge({
      hash: "deadbeef",
      scoreFn: () => {
        calls++;
        if (calls === 1) return 0.4;
        return Math.min(0.9, 0.4 + calls * 0.1);
      },
    });
    const orch = makeOrch({
      judge,
      workerMutate: async (input) => {
        await writeFile(join(input.worktreePath, "score.txt"), `${input.iteration}\n`);
        return ["score.txt"];
      },
    });
    const summary = await orch.run(baseConfig({ target: repo, maxIterations: 3, workersPerIteration: 2 }));

    expect(summary.totalIterations).toBe(3);
    expect(summary.bestScore).toBeGreaterThan(0.4);

    const records = await readRunLog(join(repo, ".evolve", "runs", `${summary.runId}.jsonl`));
    expect(records[0]?.type).toBe("start");
    expect(records.at(-1)?.type).toBe("end");
    expect(records.filter((r) => r.type === "iteration").length).toBe(3);
  });

  it("aborts on judge-hash-drift detected during baseline", async () => {
    const judge = new ProgrammableJudge({
      hash: "expected",
      scoreFn: () => 0.5,
      hashOverride: () => "drifted",
    });
    const orch = makeOrch({ judge });
    const summary = await orch.run(baseConfig({ target: repo }));

    const records = await readRunLog(join(repo, ".evolve", "runs", `${summary.runId}.jsonl`));
    expect(records[0]?.type).toBe("abort");
    expect((records[0] as { reason?: string }).reason).toBe("judge-hash-drift");
    expect(summary.totalIterations).toBe(0);
  });

  it("aborts on cost budget exceeded", async () => {
    const judge = new ProgrammableJudge({ hash: "h", scoreFn: () => 0.5 });
    const orch = makeOrch({ judge, workerCostUsd: 0.6 });
    const summary = await orch.run(
      baseConfig({ target: repo, maxIterations: 5, maxCostUsd: 0.5, workersPerIteration: 1 }),
    );

    const records = await readRunLog(join(repo, ".evolve", "runs", `${summary.runId}.jsonl`));
    const aborts = records.filter((r) => r.type === "abort");
    expect(aborts.length).toBe(1);
    expect((aborts[0] as { reason?: string }).reason).toBe("budget-cost");
  });

  it("aborts when working tree is dirty before start", async () => {
    await writeFile(join(repo, "dirty.txt"), "uncommitted\n");
    const judge = new ProgrammableJudge({ hash: "h", scoreFn: () => 0.5 });
    const orch = makeOrch({ judge });
    const summary = await orch.run(baseConfig({ target: repo }));

    expect(summary.totalIterations).toBe(0);
    const records = await readRunLog(join(repo, ".evolve", "runs", `${summary.runId}.jsonl`));
    expect(records.some((r) => r.type === "abort" && r.reason === "internal-error")).toBe(true);
  });

  it("reports kept=false when no hypothesis improves the baseline", async () => {
    let n = 0;
    const judge = new ProgrammableJudge({
      hash: "h",
      scoreFn: () => {
        n++;
        return n === 1 ? 0.9 : 0.5;
      },
    });
    const orch = makeOrch({ judge });
    const summary = await orch.run(baseConfig({ target: repo, maxIterations: 2, workersPerIteration: 1 }));

    expect(summary.bestScore).toBeCloseTo(0.9);
    expect(summary.bestIteration).toBeUndefined();

    const records = await readRunLog(join(repo, ".evolve", "runs", `${summary.runId}.jsonl`));
    const iters = records.filter((r) => r.type === "iteration") as Array<{ kept: boolean }>;
    expect(iters.every((r) => r.kept === false)).toBe(true);
  });

  it("cleans up all worktrees at end of every iteration", async () => {
    const judge = new ProgrammableJudge({ hash: "h", scoreFn: () => 0.7 });
    const orch = makeOrch({ judge });
    await orch.run(baseConfig({ target: repo, maxIterations: 2, workersPerIteration: 2 }));

    const wt = new WorktreeManager({
      baseRepoPath: repo,
      worktreesDir: join(repo, ".evolve", "worktrees"),
      logger: SILENT_LOGGER,
    });
    const list = await wt.list();
    const evolveOnly = list.filter((p) => p.includes("evolve"));
    expect(evolveOnly.length).toBe(0);
  });
});

describe("StubArchitect / StubWorker", () => {
  it("StubArchitect cycles through pool with stable IDs per call", async () => {
    const arch = new StubArchitect({
      hypotheses: [
        { summary: "a", rationale: "", affectedFiles: ["a"] },
        { summary: "b", rationale: "", affectedFiles: ["b"] },
      ],
    });
    const ctx = { target: "/x", previousIterations: [], bestScore: 0 };
    const first = await arch.proposeHypotheses(ctx, 3);
    const second = await arch.proposeHypotheses(ctx, 3);
    expect(first.map((h) => h.summary)).toEqual(["a", "b", "a"]);
    expect(second.map((h) => h.summary)).toEqual(["b", "a", "b"]);
    expect(first[0]?.id).toBe("h-0-0");
    expect(second[0]?.id).toBe("h-1-0");
  });

  it("StubWorker reports failures on mutate throwing", async () => {
    const worker = new StubWorker({
      mutate: () => {
        throw new Error("boom");
      },
    });
    const out = await worker.apply({
      hypothesis: { id: "x", summary: "", rationale: "", affectedFiles: [] },
      worktreePath: "/x",
      iteration: 1,
    });
    expect(out.success).toBe(false);
    expect(out.notes).toContain("boom");
  });
});
