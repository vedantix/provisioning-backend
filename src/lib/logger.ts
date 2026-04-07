import { env } from '../config/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogMeta = Record<string, unknown> | undefined;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldLog(level: LogLevel): boolean {
  const configured = (env.logLevel as LogLevel) || 'info';
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[configured];
}

function sanitizeError(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function toLogLine(level: LogLevel, message: string, meta?: LogMeta): string {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: 'provisioning-backend',
    env: env.nodeEnv,
    ...meta,
  };

  if (env.prettyLogs) {
    return JSON.stringify(payload, null, 2);
  }

  return JSON.stringify(payload);
}

function write(level: LogLevel, message: string, meta?: LogMeta): void {
  if (!shouldLog(level)) {
    return;
  }

  const line = toLogLine(level, message, meta);

  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`);
    return;
  }

  process.stdout.write(`${line}\n`);
}

export const logger = {
  debug(message: string, meta?: LogMeta): void {
    write('debug', message, meta);
  },

  info(message: string, meta?: LogMeta): void {
    write('info', message, meta);
  },

  warn(message: string, meta?: LogMeta): void {
    write('warn', message, meta);
  },

  error(message: string, meta?: LogMeta): void {
    write('error', message, meta);
  },

  exception(message: string, error: unknown, meta?: LogMeta): void {
    write('error', message, {
      ...meta,
      error: sanitizeError(error),
    });
  },
};