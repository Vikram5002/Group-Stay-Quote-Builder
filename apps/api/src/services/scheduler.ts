import {
  ConflictException,
  CreateScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
  type CreateScheduleCommandInput,
} from '@aws-sdk/client-scheduler';
import { log } from '../log.js';

/**
 * Per-quote expiry schedules (blueprint 5.7, ADR 6). One EventBridge Scheduler one-time schedule
 * per open quote fires the worker at valid_until; it deletes itself afterwards. Scheduling is
 * best effort after the commit: a failure is logged and the 15-minute sweeper heals it, so a
 * quote is never refused because a schedule could not be created (blueprint 11.4).
 */
export interface ExpiryScheduler {
  /** Create or move the quote's expiry schedule to `at` (UTC ISO). */
  schedule(quoteId: string, at: string): Promise<void>;
}

/** The worker event a schedule delivers. */
export interface ExpireEvent {
  type: 'expire';
  quote_id: string;
}

/** EventBridge Scheduler wants "at(yyyy-mm-ddThh:mm:ss)" in UTC. */
export function atExpression(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new RangeError(`Not an instant: ${iso}`);
  return `at(${d.toISOString().slice(0, 19)})`;
}

export const scheduleName = (quoteId: string) => `c32-expire-${quoteId}`;

export class EventBridgeExpiryScheduler implements ExpiryScheduler {
  constructor(
    private readonly client: SchedulerClient,
    private readonly opts: { targetArn: string; roleArn: string; group?: string },
  ) {}

  async schedule(quoteId: string, at: string): Promise<void> {
    const event: ExpireEvent = { type: 'expire', quote_id: quoteId };
    const input: CreateScheduleCommandInput = {
      Name: scheduleName(quoteId),
      GroupName: this.opts.group ?? 'default',
      ScheduleExpression: atExpression(at),
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE',
      Target: {
        Arn: this.opts.targetArn,
        RoleArn: this.opts.roleArn,
        Input: JSON.stringify(event),
        RetryPolicy: { MaximumRetryAttempts: 3 },
      },
    };
    try {
      await this.client.send(new CreateScheduleCommand(input));
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      await this.client.send(new UpdateScheduleCommand(input)); // extended quote: move it
    }
  }
}

/** Schedule without ever failing the caller; the sweeper is the safety net. */
export async function scheduleQuietly(
  scheduler: ExpiryScheduler | undefined,
  quoteId: string,
  at: string | null,
): Promise<void> {
  if (!scheduler || at === null) return;
  try {
    await scheduler.schedule(quoteId, at);
  } catch (err) {
    log('warn', 'expiry_schedule_failed', {
      quote_id: quoteId,
      at,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function schedulerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ExpiryScheduler | undefined {
  const targetArn = env['EXPIRY_TARGET_ARN'];
  const roleArn = env['EXPIRY_ROLE_ARN'];
  if (!targetArn || !roleArn) return undefined;
  return new EventBridgeExpiryScheduler(
    new SchedulerClient({ region: env['AWS_REGION'] ?? 'ap-south-1' }),
    {
      targetArn,
      roleArn,
      ...(env['EXPIRY_SCHEDULE_GROUP'] ? { group: env['EXPIRY_SCHEDULE_GROUP'] } : {}),
    },
  );
}
