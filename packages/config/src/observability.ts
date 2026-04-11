import { hostname } from "node:os";

const HOSTNAME = hostname();

const levelSeverity = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
} as const;

export type StructuredLogLevel = keyof typeof levelSeverity;

export type StructuredLogFields = Record<string, unknown>;

type CreateStructuredLoggerOptions = {
  base?: StructuredLogFields;
  level?: StructuredLogLevel;
  service: string;
};

export type StructuredLogger = {
  child(fields: StructuredLogFields): StructuredLogger;
  debug(message: string, fields?: StructuredLogFields): void;
  error(message: string, fields?: StructuredLogFields): void;
  fatal(message: string, fields?: StructuredLogFields): void;
  info(message: string, fields?: StructuredLogFields): void;
  warn(message: string, fields?: StructuredLogFields): void;
};

export function createStructuredLogger(
  options: CreateStructuredLoggerOptions,
): StructuredLogger {
  const threshold = levelSeverity[resolveLogLevel(options.level)];
  const baseFields = normalizeFields({
    env: process.env.NODE_ENV ?? "development",
    hostname: HOSTNAME,
    pid: process.pid,
    service: options.service,
    ...options.base,
  });

  const write = (level: StructuredLogLevel, message: string, fields = {}) => {
    if (levelSeverity[level] < threshold) {
      return;
    }

    const payload = normalizeFields({
      ...baseFields,
      ...fields,
      level,
      message,
      timestamp: new Date().toISOString(),
    });

    const stream =
      level === "error" || level === "fatal" ? process.stderr : process.stdout;

    stream.write(`${JSON.stringify(payload)}\n`);
  };

  return {
    child(fields) {
      return createStructuredLogger({
        ...options,
        base: {
          ...baseFields,
          ...fields,
        },
      });
    },
    debug(message, fields) {
      write("debug", message, fields);
    },
    error(message, fields) {
      write("error", message, fields);
    },
    fatal(message, fields) {
      write("fatal", message, fields);
    },
    info(message, fields) {
      write("info", message, fields);
    },
    warn(message, fields) {
      write("warn", message, fields);
    },
  };
}

function normalizeFields(fields: StructuredLogFields) {
  const seen = new WeakSet<object>();

  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, normalizeValue(value, seen)] as const)
      .filter(([, value]) => value !== undefined),
  );
}

function normalizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Error) {
    return normalizeError(value, seen);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    const normalizedObject = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, normalizeValue(item, seen)] as const)
        .filter(([, item]) => item !== undefined),
    );

    seen.delete(value);

    return normalizedObject;
  }

  return value;
}

function normalizeError(error: Error, seen: WeakSet<object>) {
  const serializedError: Record<string, unknown> = {
    message: error.message,
    name: error.name,
    stack: error.stack,
  };

  const errorWithMetadata = error as Error & {
    cause?: unknown;
    code?: string;
    details?: unknown;
  };

  if (errorWithMetadata.code !== undefined) {
    serializedError.code = errorWithMetadata.code;
  }

  if (errorWithMetadata.cause !== undefined) {
    serializedError.cause = normalizeValue(errorWithMetadata.cause, seen);
  }

  if (errorWithMetadata.details !== undefined) {
    serializedError.details = normalizeValue(errorWithMetadata.details, seen);
  }

  return serializedError;
}

function resolveLogLevel(level?: string): StructuredLogLevel {
  if (isStructuredLogLevel(level)) {
    return level;
  }

  const envLevel = process.env.LOG_LEVEL;

  return isStructuredLogLevel(envLevel) ? envLevel : "info";
}

function isStructuredLogLevel(value: unknown): value is StructuredLogLevel {
  return (
    typeof value === "string" &&
    Object.hasOwn(levelSeverity, value as StructuredLogLevel)
  );
}
