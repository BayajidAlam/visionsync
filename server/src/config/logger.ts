type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const activeLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[activeLevel]) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
  };
  const line = JSON.stringify(entry) + '\n';
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export const logger = {
  info:  (message: string, meta?: Record<string, unknown>) => log('info',  message, meta),
  warn:  (message: string, meta?: Record<string, unknown>) => log('warn',  message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
};
