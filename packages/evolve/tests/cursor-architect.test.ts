import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@boilerx/shared";
import { CursorArchitect, parseHypothesesJson } from "../src/cursor-architect.js";
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
  return { Agent: { prompt: promptMock }, CursorAgentError };
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

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "boilerx-ca-"));
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.email", "test@boilerx.local");
  await git(repo, "config", "user.name", "boilerx-test");
  await writeFile(join(repo, "src.ts"), "export const v = 1;\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "initial");
  return repo;
}

const baseCtx = (target: string) => ({
  target,
  previousIterations: [],
  bestScore: 0.5,
});

describe("parseHypothesesJson", () => {
  it("parses a clean JSON array", () => {
    const r = parseHypothesesJson(
      `[{"summary":"x","rationale":"y","affectedFiles":["src/a.ts"]}]`,
    );
    expect(r.ok).toBe(true);
  });

  it("strips fenced ```json wrapping", () => {
    const r = parseHypothesesJson('```json\n[{"summary":"a"}]\n```');
    expect(r.ok).toBe(true);
  });

  it("extracts an array embedded in surrounding prose", () => {
    const r = parseHypothesesJson(
      `Sure! Here are my hypotheses:\n\n[{"summary":"a"},{"summary":"b"}]\n\nLet me know.`,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(2);
  });

  it("rejects empty input", () => {
    expect(parseHypothesesJson("").ok).toBe(false);
    expect(parseHypothesesJson("   ").ok).toBe(false);
  });

  it("rejects no array", () => {
    const r = parseHypothesesJson(`{"summary": "x"}`);
    expect(r.ok).toBe(false);
  });

  it("rejects invalid JSON", () => {
    const r = parseHypothesesJson("[{not json");
    expect(r.ok).toBe(false);
  });

  it("rejects an array with no objects", () => {
    expect(parseHypothesesJson("[1, 2, 3]").ok).toBe(false);
    expect(parseHypothesesJson("[]").ok).toBe(false);
  });
});

describe("CursorArchitect", () => {
  let repo: string;

  beforeEach(async () => {
    promptMock.mockReset();
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("rejects construction without an apiKey", () => {
    expect(
      () => new CursorArchitect({ apiKey: "", model: "composer-2", logger: SILENT }),
    ).toThrow(/apiKey/);
  });

  it("returns parsed hypotheses with stable IDs", async () => {
    promptMock.mockResolvedValue({
      status: "finished",
      id: "run-arch",
      result: `[
        {"summary":"refactor handler","rationale":"too long","affectedFiles":["src/handler.ts"]},
        {"summary":"add input validation","rationale":"safety","affectedFiles":["src/handler.ts"]}
      ]`,
    });

    const arch = new CursorArchitect({ apiKey: "test", model: "composer-2", logger: SILENT });
    const out = await arch.proposeHypotheses(baseCtx(repo), 3);

    expect(out.hypotheses.length).toBe(2);
    expect(out.hypotheses[0]?.id).toBe("h-0-0");
    expect(out.hypotheses[1]?.id).toBe("h-0-1");
    expect(out.hypotheses[0]?.summary).toBe("refactor handler");
    expect(out.hypotheses[0]?.affectedFiles).toEqual(["src/handler.ts"]);
    expect(out.costUsd).toBeGreaterThan(0);

    const arch2Calls = await arch.proposeHypotheses(baseCtx(repo), 1);
    expect(arch2Calls.hypotheses[0]?.id).toBe("h-1-0");
  });

  it("filters forbidden paths from affectedFiles", async () => {
    promptMock.mockResolvedValue({
      status: "finished",
      id: "run-arch",
      result: `[
        {"summary":"sneaky","rationale":"x","affectedFiles":[".judge/metric.yaml","src/ok.ts","Makefile",".github/workflows/ci.yml"]}
      ]`,
    });

    const arch = new CursorArchitect({ apiKey: "test", model: "composer-2", logger: SILENT });
    const out = await arch.proposeHypotheses(baseCtx(repo), 1);

    expect(out.hypotheses.length).toBe(1);
    expect(out.hypotheses[0]?.affectedFiles).toEqual(["src/ok.ts"]);
  });

  it("retries once on bad JSON, then succeeds", async () => {
    promptMock
      .mockResolvedValueOnce({ status: "finished", id: "r1", result: "Sure! [malformed JSON" })
      .mockResolvedValueOnce({
        status: "finished",
        id: "r2",
        result: `[{"summary":"recovered","rationale":"","affectedFiles":[]}]`,
      });

    const arch = new CursorArchitect({
      apiKey: "test",
      model: "composer-2",
      logger: SILENT,
      maxRetries: 1,
    });
    const out = await arch.proposeHypotheses(baseCtx(repo), 1);
    expect(out.hypotheses.length).toBe(1);
    expect(out.hypotheses[0]?.summary).toBe("recovered");
    expect(promptMock).toHaveBeenCalledTimes(2);
  });

  it("returns empty hypotheses with non-zero cost when all retries fail (does not throw)", async () => {
    promptMock.mockResolvedValue({ status: "finished", id: "r", result: "no json here" });

    const arch = new CursorArchitect({
      apiKey: "test",
      model: "composer-2",
      logger: SILENT,
      maxRetries: 2,
    });
    const out = await arch.proposeHypotheses(baseCtx(repo), 2);
    expect(out.hypotheses).toEqual([]);
    expect(out.costUsd).toBeGreaterThan(0);
    expect(promptMock).toHaveBeenCalledTimes(3);
  });

  it("reverts any working-tree changes the agent made (read-only enforcement)", async () => {
    promptMock.mockImplementation(async (_p: string, opts: { local: { cwd: string } }) => {
      await writeFile(join(opts.local.cwd, "src.ts"), "export const v = 999;\n");
      await writeFile(join(opts.local.cwd, "leaked.txt"), "should not survive\n");
      return {
        status: "finished",
        id: "r",
        result: `[{"summary":"x","rationale":"y","affectedFiles":["src.ts"]}]`,
      };
    });

    const arch = new CursorArchitect({ apiKey: "test", model: "composer-2", logger: SILENT });
    const out = await arch.proposeHypotheses(baseCtx(repo), 1);
    expect(out.hypotheses.length).toBe(1);

    const src = (await readFile(join(repo, "src.ts"), "utf8")).replace(/\r\n/g, "\n");
    expect(src).toBe("export const v = 1;\n");

    const status = await runCommand("git status --porcelain", { cwd: repo, timeoutMs: 10_000 });
    expect(status.stdout.trim()).toBe("");
  });

  it("clamps the result to n hypotheses when the agent returns more", async () => {
    promptMock.mockResolvedValue({
      status: "finished",
      id: "r",
      result: `[
        {"summary":"a","rationale":"","affectedFiles":[]},
        {"summary":"b","rationale":"","affectedFiles":[]},
        {"summary":"c","rationale":"","affectedFiles":[]},
        {"summary":"d","rationale":"","affectedFiles":[]}
      ]`,
    });
    const arch = new CursorArchitect({ apiKey: "test", model: "composer-2", logger: SILENT });
    const out = await arch.proposeHypotheses(baseCtx(repo), 2);
    expect(out.hypotheses.map((h) => h.summary)).toEqual(["a", "b"]);
  });

  it("treats agent run with status='error' as a recoverable failure (returns empty hypotheses)", async () => {
    promptMock.mockResolvedValue({ status: "error", id: "r", result: "" });
    const arch = new CursorArchitect({
      apiKey: "test",
      model: "composer-2",
      logger: SILENT,
      maxRetries: 0,
    });
    const out = await arch.proposeHypotheses(baseCtx(repo), 2);
    expect(out.hypotheses).toEqual([]);
    expect(out.costUsd).toBeGreaterThanOrEqual(0);
  });
});
