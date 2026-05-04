import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@boilerx/shared";
import { WorktreeManager } from "../src/worktree.js";
import { runCommand } from "../src/exec.js";

const SILENT_LOGGER = createLogger({ level: "error" });

async function git(cwd: string, ...args: string[]): Promise<void> {
  const r = await runCommand(`git ${args.map((a) => (/[ "']/.test(a) ? `"${a}"` : a)).join(" ")}`, {
    cwd,
    timeoutMs: 30_000,
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr || r.stdout}`);
  }
}

describe("WorktreeManager", () => {
  let baseRepo: string;
  let worktreesDir: string;

  beforeEach(async () => {
    baseRepo = await mkdtemp(join(tmpdir(), "boilerx-wt-base-"));
    worktreesDir = join(baseRepo, ".evolve", "worktrees");
    await git(baseRepo, "init", "-b", "main");
    await git(baseRepo, "config", "user.email", "test@boilerx.local");
    await git(baseRepo, "config", "user.name", "boilerx-test");
    await writeFile(join(baseRepo, "README.md"), "# initial\n");
    await git(baseRepo, "add", ".");
    await git(baseRepo, "commit", "-m", "initial");
  });

  afterEach(async () => {
    await rm(baseRepo, { recursive: true, force: true });
  });

  function newManager(): WorktreeManager {
    return new WorktreeManager({
      baseRepoPath: baseRepo,
      worktreesDir,
      logger: SILENT_LOGGER,
    });
  }

  it("creates a worktree on a fresh branch from HEAD", async () => {
    const mgr = newManager();
    const handle = await mgr.create("run-1", "h-1");
    expect(handle.branch).toBe("evolve/run-1/h-1");
    expect(handle.path).toBe(join(worktreesDir, "run-1", "h-1"));

    const readme = await readFile(join(handle.path, "README.md"), "utf8");
    expect(readme).toContain("initial");
  });

  it("removes the worktree and its branch", async () => {
    const mgr = newManager();
    const handle = await mgr.create("run-2", "h-2");

    const before = await mgr.list();
    expect(before.some((p) => p.includes("run-2"))).toBe(true);

    await mgr.remove(handle);

    const after = await mgr.list();
    expect(after.some((p) => p.includes("run-2"))).toBe(false);

    const branches = await runCommand("git branch --list evolve/run-2/h-2", {
      cwd: baseRepo,
      timeoutMs: 10_000,
    });
    expect(branches.stdout.trim()).toBe("");
  });

  it("ensureBaseClean rejects when base has uncommitted changes", async () => {
    const mgr = newManager();
    await writeFile(join(baseRepo, "dirty.txt"), "dirty\n");
    await expect(mgr.ensureBaseClean()).rejects.toThrow(/uncommitted changes/);
  });

  it("ensureBaseClean passes on clean repo", async () => {
    const mgr = newManager();
    await expect(mgr.ensureBaseClean()).resolves.toBeUndefined();
  });

  it("rejects ids with shell-unsafe characters", async () => {
    const mgr = newManager();
    await expect(mgr.create("../escape", "ok")).rejects.toThrow(/invalid characters/);
    await expect(mgr.create("ok", "with space")).rejects.toThrow(/invalid characters/);
    await expect(mgr.create("ok", "$(whoami)")).rejects.toThrow(/invalid characters/);
  });

  it("isolates writes between worktrees", async () => {
    const mgr = newManager();
    const a = await mgr.create("run-3", "a");
    const b = await mgr.create("run-3", "b");

    await writeFile(join(a.path, "marker-a.txt"), "from a\n");
    await writeFile(join(b.path, "marker-b.txt"), "from b\n");

    const aFiles = await runCommand("git status --porcelain", { cwd: a.path, timeoutMs: 10_000 });
    const bFiles = await runCommand("git status --porcelain", { cwd: b.path, timeoutMs: 10_000 });
    expect(aFiles.stdout).toContain("marker-a.txt");
    expect(aFiles.stdout).not.toContain("marker-b.txt");
    expect(bFiles.stdout).toContain("marker-b.txt");
    expect(bFiles.stdout).not.toContain("marker-a.txt");

    await mgr.remove(a);
    await mgr.remove(b);
  });
});
