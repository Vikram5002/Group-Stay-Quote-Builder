import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_POLICY, Policy } from '@c32/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getInventory,
  getRatePlan,
  putInventory,
  putRatePlan,
  type DataContext,
} from '../../src/data/catalog.js';
import { VersionConflictError } from '../../src/data/errors.js';
import { getPolicy, savePolicy, upgradeStoredPolicy } from '../../src/data/policy.js';
import { keys } from '../../src/data/table.js';
import { createTestTable, hasDb, night } from './local-db.js';

describe.skipIf(!hasDb)('catalog and policy repositories (DynamoDB Local)', () => {
  let ctx: DataContext;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ ctx, drop } = await createTestTable());
    await putInventory(ctx, [
      night('2026-11-01', 10),
      night('2026-11-02', 10),
      night('2026-11-03', null),
      night('2026-11-01', 4, 'deluxe'),
    ]);
    await putRatePlan(ctx, [
      {
        date: '2026-11-01',
        room_type: 'standard',
        rate_per_room_night_inr: 2000,
        variable_cost_per_room_night_inr: 800,
        rack_rate_inr: 2600,
      },
      {
        date: '2026-11-02',
        room_type: 'standard',
        rate_per_room_night_inr: 2000,
        variable_cost_per_room_night_inr: null,
        rack_rate_inr: null,
      },
    ]);
  });
  afterAll(async () => drop());

  it('reads inventory by room type and inclusive date range', async () => {
    const nights = await getInventory(ctx, 'standard', '2026-11-01', '2026-11-02');
    expect(nights).toEqual([night('2026-11-01', 10), night('2026-11-02', 10)]);
    expect(await getInventory(ctx, 'deluxe', '2026-11-01', '2026-11-30')).toEqual([
      night('2026-11-01', 4, 'deluxe'),
    ]);
  });

  it('round-trips unknown availability as null, stored with no available_units attribute', async () => {
    expect(await getInventory(ctx, 'standard', '2026-11-03', '2026-11-03')).toEqual([
      night('2026-11-03', null),
    ]);
    const raw = await ctx.doc.send(
      new GetCommand({
        TableName: ctx.tableName,
        Key: { PK: keys.property('p1'), SK: keys.inventory('standard', '2026-11-03') },
      }),
    );
    expect(raw.Item).not.toHaveProperty('available_units');
    expect(raw.Item?.['total_units']).toBeNull();
  });

  it('round-trips the rate plan, keeping a null cost as null (never 0)', async () => {
    const plan = await getRatePlan(ctx, 'standard', '2026-11-01', '2026-11-02');
    expect(plan.map((r) => r.variable_cost_per_room_night_inr)).toEqual([800, null]);
    expect(plan[0]?.rack_rate_inr).toBe(2600);
  });

  it('returns nothing for a range with no rows', async () => {
    expect(await getInventory(ctx, 'standard', '2026-12-01', '2026-12-31')).toEqual([]);
  });

  it('saves the policy with an optimistic version check', async () => {
    expect(await getPolicy(ctx)).toBeNull();
    const v1 = await savePolicy(ctx, { ...DEFAULT_POLICY, version: 0 });
    expect(v1.version).toBe(1);
    expect(await getPolicy(ctx)).toEqual(v1);

    const v2 = await savePolicy(ctx, { ...v1, validity_hours: 48 });
    expect(v2).toMatchObject({ version: 2, validity_hours: 48 });

    // A writer still holding version 1 loses.
    await expect(savePolicy(ctx, { ...v1, validity_hours: 24 })).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    // Creating again from version 0 also loses once a policy exists.
    await expect(savePolicy(ctx, { ...DEFAULT_POLICY, version: 0 })).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    expect((await getPolicy(ctx))?.validity_hours).toBe(48);
  });
});

describe('stored policies from before D-056', () => {
  it('drop the retired floor mode fields and default total rooms', () => {
    const legacy = {
      property_id: 'p1',
      timezone: 'Asia/Kolkata',
      floor_mode: 'absolute',
      contribution_floor_inr: 20000,
      floor_per_room_night_inr: null,
      validity_hours: 24,
      stay_cutoff_hours: 24,
      min_validity_hours: 2,
      min_partial_rooms_units: 1,
      guests_per_room_units: 2,
      version: 6,
    };
    expect(Policy.parse(upgradeStoredPolicy(legacy))).toMatchObject({
      total_rooms_units: 10,
      max_sales_discount_pct: 10,
      version: 6,
      validity_hours: 24,
    });
    expect(upgradeStoredPolicy({ ...legacy, total_rooms_units: 30 })).toMatchObject({
      total_rooms_units: 30,
    });
  });
});
