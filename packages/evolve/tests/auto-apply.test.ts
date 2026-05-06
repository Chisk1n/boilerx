import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@boilerx/shared";
import { WorktreeManager } from "../src/worktree.js";
import { runCommand } from "../src/exec.js";

const SILENT = createLogger({ level: "error" });

async function git(cwd: string, ...args: string[]): Promise<void> {
  const r = await runCommand(`git ${args.map((a) => (/[ "']/.test(a) ? `"${a}"` : a)).join(" ")}`, {
    cwd,
    timeoutMs: 30_000,
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
}

async function readNormalized(path: string): Promise<string> {
  return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
}

describe("WorktreeManager.applyWorktreePatch", () => {
  let baseRepo: string;
  let worktreesDir: string;

  beforeEach(async () => {
    baseRepo = await mkdtemp(join(tmpdir(), "boilerx-apply-"));
    worktreesDir = join(baseRepo, ".evolve", "worktrees");
    await git(baseRepo, "init", "-b", "main");
    await git(baseRepo, "config", "user.email", "test@boilerx.local");
    await git(baseRepo, "config", "user.name", "boilerx-test");
    await writeFile(join(baseRepo, "src.ts"), "export const v = 1;\n");
    await writeFile(join(baseRepo, "keep.txt"), "untouched\n");
    await git(baseRepo, "add", ".");
    await git(baseRepo, "commit", "-m", "initial");
  });

  afterEach(async () => {
    await rm(baseRepo, { recursive: true, force: true });
  });

  async function newManager(): Promise<WorktreeManager> {
    const mgr = new WorktreeManager({
      baseRepoPath: baseRepo,
      worktreesDir,
      logger: SILENT,
    });
    await mgr.ensureLocalIgnore(".evolve");
    return mgr;
  }

  it("commits modifications from the worktree to the base repo and advances HEAD", async () => {
    const mgr = await newManager();
    const wt = await mgr.create("run-1", "h-1");

    await writeFile(join(wt.path, "src.ts"), "export const v = 42;\n");

    const result = await mgr.applyWorktreePatch(wt, "feat(evolve): bump v to 42");
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.files).toContain("src.ts");
      expect(result.commitSha).toMatch(/^[0-9a-f]{12}$/);
    }

    const finalSrc = await readNormalized(join(baseRepo, "src.ts"));
    expect(finalSrc).toBe("export const v = 42;\n");

    const status = await runCommand("git status --porcelain", {
      cwd: baseRepo,
      timeoutMs: 10_000,
    });
    expect(status.stdout.trim()).toBe("");

    const log = await runCommand("git log --pretty=format:%s -1", {
      cwd: baseRepo,
      timeoutMs: 10_000,
    });
    expect(log.stdout).toContain("bump v to 42");

    await mgr.remove(wt);
  });

  it("commits new files (additions)", async () => {
    const mgr = await newManager();
    const wt = await mgr.create("run-2", "h-2");

    await writeFile(join(wt.path, "new-file.ts"), "export const fresh = true;\n");

    const result = await mgr.applyWorktreePatch(wt, "feat(evolve): add fresh");
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.files).toContain("new-file.ts");
    }

    const fresh = await readNormalized(join(baseRepo, "new-file.ts"));
    expect(fresh).toBe("export const fresh = true;\n");

    await mgr.remove(wt);
  });

  it("returns applied=false when worktree has no diff", async () => {
    const mgr = await newManager();
    const wt = await mgr.create("run-3", "h-3");

    const result = await mgr.applyWorktreePatch(wt, "noop commit");
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toMatch(/no diff/i);
    }

    await mgr.remove(wt);
  });

  it("subsequent worktrees see the previously committed winner", async () => {
    const mgr = await newManager();

    const wt1 = await mgr.create("run-4", "h-1");
    await writeFile(join(wt1.path, "src.ts"), "export const v = 100;\n");
    const r1 = await mgr.applyWorktreePatch(wt1, "feat(evolve): bump to 100");
    expect(r1.applied).toBe(true);
    await mgr.remove(wt1);

    const wt2 = await mgr.create("run-4", "h-2");
    const wt2Src = await readNormalized(join(wt2.path, "src.ts"));
    expect(wt2Src).toBe("export const v = 100;\n");

    await mgr.remove(wt2);
  });

  it("preserves untouched files (only committed files in patch advance)", async () => {
    const mgr = await newManager();
    const wt = await mgr.create("run-5", "h-5");

    await writeFile(join(wt.path, "src.ts"), "export const v = 999;\n");

    await mgr.applyWorktreePatch(wt, "feat(evolve): touch src");

    const keep = await readNormalized(join(baseRepo, "keep.txt"));
    expect(keep).toBe("untouched\n");

    await mgr.remove(wt);
  });
});
