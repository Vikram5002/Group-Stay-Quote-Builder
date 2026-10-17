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

/**
 * One CloudWatch metric as an Embedded Metric Format log line (namespace C32). CloudWatch turns
 * it into a metric with no extra API call; Track 3's alarms watch these names.
 */
export function metric(
  name: string,
  value: number,
  unit: 'Count' | 'Milliseconds' = 'Count',
): void {
  if (process.env['LOG_SILENT'] === '1') return;
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          { Namespace: 'C32', Dimensions: [[]], Metrics: [{ Name: name, Unit: unit }] },
        ],
      },
      [name]: value,
    }),
  );
}
