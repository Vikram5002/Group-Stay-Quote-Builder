/**
 * Minimal structured JSON logger (one line per event, CloudWatch-friendly).
 * Replaced by Lambda Powertools Logger in T1.09. Never log personal data.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  if (process.env['LOG_SILENT'] === '1') return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}
