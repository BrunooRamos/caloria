import { currentRequestId } from "./context";

// Logs estructurados: una línea JSON por evento, con el requestId de la request en curso.
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  write?: (line: string) => void;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|email|^body$/i;
const REDACTED = "[REDACTED]";
const SENSITIVE_PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, // emails
  /Bearer\s+[\w.~+/=-]+/gi, // header Authorization
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWT
];

function scrub(text: string): string {
  return SENSITIVE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, REDACTED), text);
}

function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrub(value);
  if (depth > 5 || typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  const out: LogFields = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, depth + 1);
  }
  return out;
}

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && Object.hasOwn(LEVELS, value);
}

export function createLogger(options: LoggerOptions): Logger {
  const envLevel = process.env.LOG_LEVEL;
  const minLevel = LEVELS[options.level ?? (isLogLevel(envLevel) ? envLevel : "info")];
  const write = options.write ?? ((line: string) => process.stdout.write(line + "\n"));

  const build = (bindings: LogFields): Logger => {
    const log = (level: LogLevel, msg: string, fields?: LogFields) => {
      if (LEVELS[level] < minLevel) return;
      const requestId = bindings.requestId ?? currentRequestId();
      const entry = sanitize({ ...bindings, ...fields }) as LogFields;
      write(
        JSON.stringify({
          time: new Date().toISOString(),
          level,
          service: options.service,
          ...(requestId === undefined ? {} : { requestId }),
          msg: scrub(msg),
          ...entry,
        }),
      );
    };
    return {
      debug: (msg, fields) => log("debug", msg, fields),
      info: (msg, fields) => log("info", msg, fields),
      warn: (msg, fields) => log("warn", msg, fields),
      error: (msg, fields) => log("error", msg, fields),
      child: (extra) => build({ ...bindings, ...extra }),
    };
  };

  return build({});
}

export function serializeError(err: unknown, { stack = false } = {}, depth = 0): LogFields {
  if (!(err instanceof Error)) return { value: String(err) };
  const out: LogFields = { name: err.name, message: err.message };
  if (stack && err.stack) out.stack = err.stack;
  if (err.cause !== undefined && depth < 3) {
    out.cause = serializeError(err.cause, { stack }, depth + 1);
  }
  return out;
}
