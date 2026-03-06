import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface TraceContext {
  traceId: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId;
}

function formatLogEntry(
  level: string,
  message: string,
  meta?: Record<string, unknown>
): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    traceId: getTraceId(),
    message,
    ...meta,
  };
  return JSON.stringify(entry);
}

export const logger = {
  error(message: string, err?: unknown): void {
    const meta: Record<string, unknown> = {};
    if (err instanceof Error) {
      meta.error = err.message;
      meta.errorName = err.name;
      if (err.stack) meta.stack = err.stack;
    } else if (err !== undefined) {
      meta.error = String(err);
    }
    process.stderr.write(formatLogEntry('error', message, meta) + '\n');
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    process.stderr.write(formatLogEntry('warn', message, meta) + '\n');
  },

  info(message: string, meta?: Record<string, unknown>): void {
    process.stdout.write(formatLogEntry('info', message, meta) + '\n');
  },
};

/**
 * Runs the given async function within a trace context.
 * Generates a trace ID and propagates it via AsyncLocalStorage.
 */
export async function runWithTrace<T>(fn: () => Promise<T>): Promise<T> {
  const traceId = randomUUID();
  return traceStorage.run({ traceId }, fn);
}

/**
 * Returns the current trace ID from the async context, or undefined if not in a trace.
 */
export function getCurrentTraceId(): string | undefined {
  return getTraceId();
}
