import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Logger } from "@boilerx/shared";
import { runCommand } from "./exec.js";

export interface WorktreeManagerOptions {
  readonly baseRepoPath: string;
  readonly worktreesDir: string;
  readonly logger: Logger;
  readonly gitTimeoutMs?: number;
}

export interface WorktreeHandle {
  readonly path: string;
  readonly branch: string;
}

/**
 * Manages ephemeral git worktrees for parallel hypothesis exploration.
 *
 * Each worker gets its own worktree on its own throwaway branch, so they can
 * write freely without stepping on each other or the base checkout.
 *
 * Layout:
 *   <repo>/
 *     .evolve/
 *       worktrees/
 *         <runId>/
 *           <hypothesisId>/   ← actual worktree, branch evolve/<runId>/<hypId>
 *
 * INVARIANT: Worktrees and their branches are removed together. We never
 * leave dangling branches even if `git worktree remove` partially fails.
 */
export class WorktreeManager {
  private readonly baseRepoPath: string;
  private readonly worktreesDir: string;
  private readonly logger: Logger;
  private readonly gitTimeoutMs: number;

  constructor(opts: WorktreeManagerOptions) {
    this.baseRepoPath = resolve(opts.baseRepoPath);
    this.worktreesDir = resolve(opts.worktreesDir);
    this.logger = opts.logger.child({ component: "worktree" });
    this.gitTimeoutMs = opts.gitTimeoutMs ?? 30_000;
  }

  get baseRepo(): string {
    return this.baseRepoPath;
  }

  /**
   * Adds a gitignore-style pattern to `.git/info/exclude` (the per-clone local
   * ignore file). Idempotent. Useful for ignoring orchestrator runtime
   * artifacts (`.evolve/`) without modifying the tracked `.gitignore`.
   */
  async ensureLocalIgnore(pattern: string): Promise<void> {
    const excludePath = join(this.baseRepoPath, ".git", "info", "exclude");
    let current = "";
    try {
      current = await readFile(excludePath, "utf8");
    } catch {
      // file may not exist on a fresh repo; we'll create it
      await mkdir(dirname(excludePath), { recursive: true });
    }
    const lines = current.split(/\r?\n/);
    if (lines.some((l) => l.trim() === pattern)) return;
    const next =
      current.length > 0 && !current.endsWith("\n") ? `${current}\n${pattern}\n` : `${current}${pattern}\n`;
    await writeFile(excludePath, next, "utf8");
    this.logger.info("local ignore pattern added", { pattern });
  }

  async ensureBaseClean(): Promise<void> {
    const result = await this.git(["status", "--porcelain"]);
    if (result.exitCode !== 0) {
      throw new Error(
        `git status failed in ${this.baseRepoPath} (exit ${String(result.exitCode)}):\n${result.stderr}`,
      );
    }
    if (result.stdout.trim() !== "") {
      throw new Error(
        `Base repo at ${this.baseRepoPath} has uncommitted changes. Commit or stash before starting an evolve run.\n${result.stdout}`,
      );
    }
  }

  async create(runId: string, hypothesisId: string): Promise<WorktreeHandle> {
    sanitizeId(runId, "runId");
    sanitizeId(hypothesisId, "hypothesisId");

    const wtPath = join(this.worktreesDir, runId, hypothesisId);
    const branch = `evolve/${runId}/${hypothesisId}`;
    await mkdir(dirname(wtPath), { recursive: true });

    const result = await this.git(["worktree", "add", "-b", branch, wtPath, "HEAD"]);
    if (result.exitCode !== 0) {
      throw new Error(
        `git worktree add failed for ${branch}:\n${result.stderr || result.stdout}`,
      );
    }
    this.logger.info("worktree created", { runId, hypothesisId, branch, path: wtPath });
    return { path: wtPath, branch };
  }

  /**
   * Copies the working-tree changes from `handle` back into the base repo
   * AND commits them. We commit (not just apply) because subsequent
   * iterations create worktrees from `HEAD` — without the commit they would
   * never see the previous winner's improvements. After this method, the
   * base repo's HEAD has advanced by exactly one commit.
   *
   * Mechanism:
   *   1. `git diff --binary HEAD` in the worktree → unified patch.
   *   2. `git apply --3way` in the base repo → working tree has changes.
   *   3. `git add -A && git commit -m <message>` in the base repo → HEAD
   *      moves forward.
   *
   * Returns `{ applied: true, files, commitSha }` on success. On any
   * failure (no diff, apply rejected, commit failed) returns
   * `{ applied: false, reason }` — never throws. The base repo's working
   * tree is restored with `git checkout HEAD -- . && git clean -fd .` if
   * apply succeeded but commit failed, so we never leave a dirty base.
   *
   * Commit author is hard-coded to `boilerx-evolve <evolve@boilerx.local>`
   * so a `git log --author=boilerx-evolve` filter is trivial. The user's
   * git config is untouched; we use `-c user.name -c user.email` per call.
   */
  async applyWorktreePatch(
    handle: WorktreeHandle,
    commitMessage: string,
  ): Promise<
    | { applied: true; files: readonly string[]; commitSha: string }
    | { applied: false; reason: string }
  > {
    const intentResult = await runCommand("git add -N .", {
      cwd: handle.path,
      timeoutMs: this.gitTimeoutMs,
    });
    if (intentResult.exitCode !== 0) {
      return {
        applied: false,
        reason: `git add -N . failed in ${handle.path}: ${intentResult.stderr || intentResult.stdout}`,
      };
    }

    const diffResult = await runCommand("git diff --binary HEAD", {
      cwd: handle.path,
      timeoutMs: this.gitTimeoutMs,
    });
    if (diffResult.exitCode !== 0) {
      return {
        applied: false,
        reason: `git diff failed in ${handle.path}: ${diffResult.stderr || diffResult.stdout}`,
      };
    }
    if (diffResult.stdout.trim() === "") {
      return { applied: false, reason: "no diff to apply (worktree had no changes)" };
    }

    const filesResult = await runCommand("git diff --name-only HEAD", {
      cwd: handle.path,
      timeoutMs: this.gitTimeoutMs,
    });
    const files =
      filesResult.exitCode === 0
        ? filesResult.stdout
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];

    const patchPath = join(this.baseRepoPath, ".git", "boilerx-apply.patch");
    await writeFile(patchPath, diffResult.stdout, "utf8");

    const applyResult = await runCommand(`git apply --3way "${patchPath}"`, {
      cwd: this.baseRepoPath,
      timeoutMs: this.gitTimeoutMs,
    });

    try {
      await rm(patchPath, { force: true });
    } catch {
      // ignore
    }

    if (applyResult.exitCode !== 0) {
      return {
        applied: false,
        reason: `git apply failed: ${applyResult.stderr || applyResult.stdout}`,
      };
    }

    const stageResult = await runCommand("git add -A", {
      cwd: this.baseRepoPath,
      timeoutMs: this.gitTimeoutMs,
    });
    if (stageResult.exitCode !== 0) {
      this.logger.warn("git add -A failed before commit", { stderr: stageResult.stderr });
    }

    const sanitizedMessage = commitMessage.replace(/"/g, '\\"');
    const commitCmd =
      `git -c user.name=boilerx-evolve -c user.email=evolve@boilerx.local ` +
      `commit -m "${sanitizedMessage}" --no-verify --no-gpg-sign`;
    const commitResult = await runCommand(commitCmd, {
      cwd: this.baseRepoPath,
      timeoutMs: this.gitTimeoutMs,
    });

    if (commitResult.exitCode !== 0) {
      this.logger.warn("commit of applied patch failed; reverting working tree", {
        stderr: commitResult.stderr,
      });
      await runCommand("git checkout HEAD -- .", {
        cwd: this.baseRepoPath,
        timeoutMs: this.gitTimeoutMs,
      });
      await runCommand("git clean -fd .", {
        cwd: this.baseRepoPath,
        timeoutMs: this.gitTimeoutMs,
      });
      return {
        applied: false,
        reason: `git commit failed: ${commitResult.stderr || commitResult.stdout}`,
      };
    }

    const shaResult = await runCommand("git rev-parse HEAD", {
      cwd: this.baseRepoPath,
      timeoutMs: this.gitTimeoutMs,
    });
    const commitSha =
      shaResult.exitCode === 0 ? shaResult.stdout.trim().slice(0, 12) : "(unknown)";

    this.logger.info("winner patch applied and committed", {
      branch: handle.branch,
      files,
      commitSha,
    });
    return { applied: true, files, commitSha };
  }

  async remove(handle: WorktreeHandle): Promise<void> {
    const removeResult = await this.git(["worktree", "remove", "--force", handle.path]);
    if (removeResult.exitCode !== 0) {
      this.logger.warn("git worktree remove failed; falling back to rm + prune", {
        path: handle.path,
        stderr: removeResult.stderr,
      });
      await rm(handle.path, { recursive: true, force: true });
      await this.git(["worktree", "prune"]);
    }

    const branchResult = await this.git(["branch", "-D", handle.branch]);
    if (branchResult.exitCode !== 0) {
      this.logger.warn("git branch -D failed (branch may already be gone)", {
        branch: handle.branch,
        stderr: branchResult.stderr,
      });
    }
    this.logger.info("worktree removed", { branch: handle.branch, path: handle.path });
  }

  async list(): Promise<readonly string[]> {
    const result = await this.git(["worktree", "list", "--porcelain"]);
    if (result.exitCode !== 0) {
      throw new Error(`git worktree list failed:\n${result.stderr}`);
    }
    return result.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim());
  }

  private async git(args: readonly string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const command = `git ${args.map(quoteArg).join(" ")}`;
    const result = await runCommand(command, {
      cwd: this.baseRepoPath,
      timeoutMs: this.gitTimeoutMs,
    });
    return result;
  }
}

function sanitizeId(id: string, label: string): void {
  if (!/^[A-Za-z0-9_.\-]+$/.test(id)) {
    throw new Error(
      `${label} contains invalid characters: '${id}'. Allowed: letters, digits, '_', '.', '-'.`,
    );
  }
}

function quoteArg(arg: string): string {
  if (/^[A-Za-z0-9_.\-/=:]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}
