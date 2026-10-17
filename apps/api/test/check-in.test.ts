import { ManualClock, ProblemDetails, QuotePreviewResponse } from '@c32/core';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import request from 'supertest';
import { monotonicFactory } from 'ulid';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { devAuthenticate } from '../src/auth.js';

process.env['LOG_SILENT'] = '1';

/**
 * No DynamoDB needed: an empty table (no saved policy, so the defaults apply, and no inventory).
 * The check-in rule runs before anything is written.
 */
const emptyTable = {
  send: async (command: { constructor: { name: string } }) =>
    command.constructor.name === 'QueryCommand' ? { Items: [] } : {},
} as unknown as DynamoDBDocumentClient;

function app() {
  return createApp({
    deps: {
      data: { doc: emptyTable, tableName: 'stub', propertyId: 'p1' },
      // 18 Oct 2026, 09:00 IST
      clock: new ManualClock('2026-10-18T09:00:00+05:30'),
      newId: monotonicFactory(),
    },
    authenticate: devAuthenticate,
    corsOrigins: [],
  });
}

const body = (check_in: string) => ({
  organiser: { name: 'Fictional Events Pvt Ltd' },
  stay: { check_in, nights: 2 },
  room_type: 'standard',
  rooms: 10,
});

describe('a check-in before today (property time zone) is refused with a field error', () => {
  it.each(['/v1/quotes/preview', '/v1/quotes'])('%s', async (path) => {
    const res = await request(app())
      .post(path)
      .set('x-dev-user', 'sales-1:Sales')
      .set('Idempotency-Key', 'past-check-in-1')
      .send(body('2025-01-01'))
      .expect(422);
    expect(ProblemDetails.parse(res.body)).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [
        {
          path: 'stay.check_in',
          code: 'OUT_OF_RANGE',
          message: 'Check-in must be today (2026-10-18) or later',
        },
      ],
    });
  });

  it('today is still quoted (here declined as too late, which is a decision, not an error)', async () => {
    const res = await request(app())
      .post('/v1/quotes/preview')
      .set('x-dev-user', 'sales-1:Sales')
      .send(body('2026-10-18'))
      .expect(200);
    expect(QuotePreviewResponse.parse(res.body).evaluation).toMatchObject({
      decision: 'DECLINE',
      reasons: ['TOO_LATE_TO_QUOTE'],
    });
  });
});
