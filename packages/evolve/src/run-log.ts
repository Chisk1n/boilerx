import { mkdir, readFile } from "node:fs/promises";
import { open, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { RunRecord } from "@boilerx/shared";

/**
 * Append-only JSONL writer for evolve runs.
 *
 * One file per run: `<runDir>/<runId>.jsonl`. Each line is exactly one
 * `RunRecord`. Crash-safe: writes are flushed via `fsync()` so a power loss
 * mid-run still leaves a parseable prefix.
 */
export class RunLogger {
  private readonly filePath: string;
  private readonly handle: FileHandle;
  private closed = false;

  private constructor(filePath: string, handle: FileHandle) {
    this.filePath = filePath;
    this.handle = handle;
  }

  static async create(runId: string, runDir: string): Promise<RunLogger> {
    if (!/^[A-Za-z0-9_.\-]+$/.test(runId)) {
      throw new Error(`runId contains invalid characters: '${runId}'.`);
    }
    const absRunDir = resolve(runDir);
    await mkdir(absRunDir, { recursive: true });
    const filePath = join(absRunDir, `${runId}.jsonl`);
    const handle = await open(filePath, "a");
    return new RunLogger(filePath, handle);
  }

  get path(): string {
    return this.filePath;
  }

  async append(record: RunRecord): Promise<void> {
    if (this.closed) {
      throw new Error(`RunLogger for ${this.filePath} is already closed.`);
    }
    const line = `${JSON.stringify(record)}\n`;
    await this.handle.write(line);
    await this.handle.sync();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close();
  }
}

export async function readRunLog(filePath: string): Promise<readonly RunRecord[]> {
  const absPath = resolve(filePath);
  const content = await readFile(absPath, "utf8");
  const records: RunRecord[] = [];
  let lineNumber = 0;
  for (const line of content.split(/\r?\n/)) {
    lineNumber++;
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid JSON at ${absPath}:${lineNumber}`, { cause: err });
    }
    if (!isRunRecord(parsed)) {
      throw new Error(
        `Line ${lineNumber} in ${absPath} is not a valid RunRecord (missing or unknown 'type').`,
      );
    }
    records.push(parsed);
  }
  return records;
}

export function summarizeRunLog(records: readonly RunRecord[]): RunLogSummary {
  let bestScore = -Infinity;
  let bestIteration: number | undefined;
  let totalIterations = 0;
  let totalCostUsd = 0;
  let aborted = false;
  let abortReason: string | undefined;
  let runId: string | undefined;
  let started: string | undefined;
  let ended: string | undefined;

  for (const record of records) {
    switch (record.type) {
      case "start":
        runId = record.runId;
        started = record.timestamp;
        bestScore = record.baselineScore;
        break;
      case "iteration":
        totalIterations++;
        totalCostUsd += record.costUsd;
        if (record.kept && record.score > bestScore) {
          bestScore = record.score;
          bestIteration = record.iteration;
        }
        break;
      case "abort":
        aborted = true;
        abortReason = record.reason + (record.detail ? `: ${record.detail}` : "");
        ended = record.timestamp;
        break;
      case "end":
        ended = record.timestamp;
        if (record.bestScore > bestScore) {
          bestScore = record.bestScore;
          bestIteration = record.bestIteration;
        }
        break;
    }
  }

  return {
    runId,
    started,
    ended,
    bestScore: bestScore === -Infinity ? 0 : bestScore,
    bestIteration,
    totalIterations,
    totalCostUsd,
    aborted,
    abortReason,
  };
}

export interface RunLogSummary {
  readonly runId?: string;
  readonly started?: string;
  readonly ended?: string;
  readonly bestScore: number;
  readonly bestIteration?: number;
  readonly totalIterations: number;
  readonly totalCostUsd: number;
  readonly aborted: boolean;
  readonly abortReason?: string;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(["start", "iteration", "abort", "end"]);

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== "object" || value === null) return false;
  const t = (value as { type?: unknown }).type;
  return typeof t === "string" && KNOWN_TYPES.has(t);
}
