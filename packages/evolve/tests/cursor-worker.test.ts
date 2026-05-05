import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@boilerx/shared";
import { CursorWorker } from "../src/cursor-worker.js";
import { runCommand } from "../src/exec.js";

const SILENT = createLogger({ level: "error" });

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

vi.mock("@cursor/sdk", () => {
  class CursorAgentError extends Error {
    isRetryable: boolean;
    constructor(message: string, retryable = false) {
      super(message);
      this.name = "CursorAgentError";
      this.isRetryable = retryable;
    }
  }
  return {
    Agent: { prompt: promptMock },
    CursorAgentError,
  };
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  const r = await runCommand(`git ${args.map((a) => (/[ "']/.test(a) ? `"${a}"` : a)).join(" ")}`, {
    cwd,
    timeoutMs: 30_000,
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
}

async function makeRepoWithFiles(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "boilerx-cw-"));
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.email", "test@boilerx.local");
  await git(repo, "config", "user.name", "boilerx-test");
  for (const [path, content] of Object.entries(files)) {
    const abs = join(repo, path);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "initial");
  return repo;
}

describe("CursorWorker", () => {
  let repo: string;

  beforeEach(async () => {
    promptMock.mockReset();
    repo = await makeRepoWithFiles({
      "src/math.ts": "export const add = (a: number, b: number) => a + b;\n",
      "src/util.ts": "export const noop = () => {};\n",
      ".judge/metric.yaml": "weights: { testsPassing: 1.0 }\n",
      "tests/judge/fixture.txt": "frozen\n",
      "Makefile": "test:\n\techo ok\n",
    });
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("rejects construction without an apiKey", () => {
    expect(() => new CursorWorker({ apiKey: "", model: "composer-2", logger: SILENT })).toThrow(
      /apiKey/,
    );
  });

  it("returns success and reports modified files inside the whitelist", async () => {
    promptMock.mockImplementation(async (_prompt: string, opts: { local: { cwd: string } }) => {
      await writeFile(
        join(opts.local.cwd, "src/math.ts"),
        "export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a - b;\n",
      );
      return { status: "finished", id: "run-abc", result: "added sub" };
    });

    const worker = new CursorWorker({ apiKey: "test", model: "composer-2", logger: SILENT });
    const out = await worker.apply({
      hypothesis: {
        id: "h-1",
        summary: "add sub",
        rationale: "completeness",
        affectedFiles: ["src/math.ts"],
      },
      worktreePath: repo,
      iteration: 1,
    });

    expect(out.success).toBe(true);
    expect(out.filesModified).toEqual(["src/math.ts"]);
    expect(out.notes).toContain("run-abc");
  });

  it("reverts files modified outside the whitelist and reports them as enforced", async () => {
    promptMock.mockImplementation(async (_p: string, opts: { local: { cwd: string } }) => {
      await writeFile(
        join(opts.local.cwd, "src/math.ts"),
        "export const add = (a: number, b: number) => a + b;\n// allowed change\n",
      );
      await writeFile(
        join(opts.local.cwd, "src/util.ts"),
        "export const noop = () => {};\n// SNEAKY\n",
      );
      return { status: "finished", id: "run-bad", result: "tried to be clever" };
    });

    const worker = new CursorWorker({ apiKey: "test", model: "composer-2", logger: SILENT });
    const out = await worker.apply({
      hypothesis: {
        id: "h-2",
        summary: "edit math only",
        rationale: "test",
        affectedFiles: ["src/math.ts"],
      },
      worktreePath: repo,
      iteration: 1,
    });

    expect(out.success).toBe(true);
    expect(out.filesModified).toEqual(["src/math.ts"]);

    const utilContent = await readFile(join(repo, "src/util.ts"), "utf8");
    expect(utilContent).not.toContain("SNEAKY");
    expect(out.notes).toMatch(/reverted 1/);
    expect(out.notes).toMatch(/src\/util\.ts/);
  });

  it("reverts forbidden paths even if they are listed in the whitelist", async () => {
    promptMock.mockImplementation(async (_p: string, opts: { local: { cwd: string } }) => {
      await writeFile(
        join(opts.local.cwd, ".judge/metric.yaml"),
        "weights: { testsPassing: 0.0, lintScore: 1.0 }\n",
      );
      return { status: "finished", id: "run-cheat", result: "rigged the judge" };
    });

    const worker = new CursorWorker({ apiKey: "test", model: "composer-2", logger: SILENT });
    const out = await worker.apply({
      hypothesis: {
        id: "h-3",
        summary: "tweak metric",
        rationale: "should be denied",
        affectedFiles: [".judge/metric.yaml"],
      },
      worktreePath: repo,
      iteration: 1,
    });

    expect(out.success).toBe(true);
    expect(out.filesModified).toEqual([]);
    const metricContent = (await readFile(join(repo, ".judge/metric.yaml"), "utf8")).replace(
      /\r\n/g,
      "\n",
    );
    expect(metricContent).toBe("weights: { testsPassing: 1.0 }\n");
    expect(out.notes).toMatch(/forbidden path/);
  });

  it("treats an agent run with status='error' as a failed apply", async () => {
    promptMock.mockResolvedValue({ status: "error", id: "run-err", result: "agent crashed" });

    const worker = new CursorWorker({ apiKey: "test", model: "composer-2", logger: SILENT });
    const out = await worker.apply({
      hypothesis: { id: "h-4", summary: "x", rationale: "x", affectedFiles: [] },
      worktreePath: repo,
      iteration: 1,
    });

    expect(out.success).toBe(false);
    expect(out.notes).toContain("status='error'");
  });

  it("maps CursorAgentError thrown at startup into a failed (non-throwing) apply", async () => {
    const sdk = await import("@cursor/sdk");
    promptMock.mockRejectedValueOnce(new sdk.CursorAgentError("auth invalid", false));

    const worker = new CursorWorker({ apiKey: "test", model: "composer-2", logger: SILENT });
    const out = await worker.apply({
      hypothesis: { id: "h-5", summary: "x", rationale: "x", affectedFiles: [] },
      worktreePath: repo,
      iteration: 1,
    });

    expect(out.success).toBe(false);
    expect(out.notes).toMatch(/cursor startup failed/);
    expect(out.notes).toMatch(/auth invalid/);
  });

  it("times out long-running prompts and reports failure", async () => {
    promptMock.mockImplementation(
      () => new Promise(() => undefined),
    );

    const worker = new CursorWorker({
      apiKey: "test",
      model: "composer-2",
      logger: SILENT,
      timeoutMs: 50,
    });
    const out = await worker.apply({
      hypothesis: { id: "h-6", summary: "x", rationale: "x", affectedFiles: [] },
      worktreePath: repo,
      iteration: 1,
    });

    expect(out.success).toBe(false);
    expect(out.notes).toMatch(/timed out/i);
  });

  it("uses the default prompt builder unless overridden", async () => {
    let captured = "";
    promptMock.mockImplementation((p: string) => {
      captured = p;
      return Promise.resolve({ status: "finished", id: "run-x", result: "" });
    });

    const worker = new CursorWorker({ apiKey: "test", model: "composer-2", logger: SILENT });
    await worker.apply({
      hypothesis: {
        id: "h-7",
        summary: "summary-marker",
        rationale: "rationale-marker",
        affectedFiles: ["only/this.ts"],
      },
      worktreePath: repo,
      iteration: 1,
    });

    expect(captured).toContain("summary-marker");
    expect(captured).toContain("rationale-marker");
    expect(captured).toContain("only/this.ts");
    expect(captured).toMatch(/Do NOT modify any file outside the whitelist/);
    expect(captured).toMatch(/Do NOT modify anything under \.judge\//);
  });
});
