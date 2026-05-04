export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

interface ConsoleLoggerOptions {
  readonly level?: LogLevel;
  readonly bindings?: Record<string, unknown>;
}

class ConsoleLogger implements Logger {
  private readonly level: LogLevel;
  private readonly bindings: Record<string, unknown>;

  constructor(options: ConsoleLoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.bindings = options.bindings ?? {};
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write("debug", message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.write("info", message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.write("warn", message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.write("error", message, meta);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger({
      level: this.level,
      bindings: { ...this.bindings, ...bindings },
    });
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...this.bindings,
      ...(meta ?? {}),
    };
    const sink = level === "error" ? console.error : console.log;
    sink(JSON.stringify(payload));
  }
}

export function createLogger(options: ConsoleLoggerOptions = {}): Logger {
  return new ConsoleLogger(options);
}
