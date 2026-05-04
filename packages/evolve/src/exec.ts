import { spawn } from "node:child_process";

export interface RunOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly shell?: boolean;
}

export interface RunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

/**
 * Runs a shell command, captures stdout/stderr, and enforces a hard timeout.
 *
 * NOTE: We default to `shell: true` so that `metric.yaml` authors can write
 * pipelines like `npm test -- --reporter=json | jq …`. The Judge runs this in
 * a sandboxed worktree (and ideally inside Docker, added in Phase 2).
 */
export function runCommand(command: string, opts: RunOptions): Promise<RunResult> {
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: opts.shell ?? true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: null,
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
