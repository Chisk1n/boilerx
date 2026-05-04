import { mkdir, rm } from "node:fs/promises";
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
