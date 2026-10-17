import {
  IsoDate,
  PolicyUpdateRequest,
  RoomType,
  daysBetween,
  parseWith,
  type AvailabilityResponse,
} from '@c32/core';
import { z } from 'zod';
import { getInventory } from '../data/catalog.js';
import { savePolicy } from '../data/policy.js';
import { ValidationFailure } from '../errors.js';
import { log } from '../log.js';
import { loadPolicy } from '../services/inputs.js';
import { applyRoomTotals } from '../services/room-totals.js';
import type { Handlers } from './operations.js';

/** Availability calendar and policy operations. */

const MAX_RANGE_DAYS = 92;

const AvailabilityQuery = z
  .strictObject({ room_type: RoomType, from: IsoDate, to: IsoDate })
  .superRefine((q, ctx) => {
    let span: number;
    try {
      span = daysBetween(q.from, q.to);
    } catch {
      return; // reported on the date field itself
    }
    if (span < 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to must be on or after from',
        params: { code: 'DATE_ORDER' },
      });
    } else if (span >= MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `A range can cover at most ${MAX_RANGE_DAYS} nights`,
        params: { code: 'OUT_OF_RANGE' },
      });
    }
  });

export const propertyHandlers: Handlers = {
  getAvailability: async ({ req, deps }) => {
    const q = parseWith(AvailabilityQuery, req.query);
    if (!q.ok) throw new ValidationFailure(q.issues);
    const body: AvailabilityResponse = {
      ...q.value,
      nights: await getInventory(deps.data, q.value.room_type, q.value.from, q.value.to),
    };
    return { status: 200, body };
  },

  getPolicy: async ({ deps }) => ({ status: 200, body: await loadPolicy(deps.data) }),

  /** Optimistic update: send the version you read; a stale version is 409 VERSION_CONFLICT. */
  updatePolicy: async ({ req, deps }) => {
    const p = parseWith(PolicyUpdateRequest, req.body);
    if (!p.ok) throw new ValidationFailure(p.issues);
    const before = await loadPolicy(deps.data);
    const saved = await savePolicy(deps.data, { ...p.value, property_id: deps.data.propertyId });
    if (saved.total_rooms_units !== before.total_rooms_units) {
      // The owner changed how many rooms the hotel has: every future night follows (D-056).
      const r = await applyRoomTotals(
        deps.data,
        saved.total_rooms_units,
        saved.timezone,
        deps.clock.now(),
      );
      log('info', 'room_totals_applied', { total_rooms: saved.total_rooms_units, ...r });
    }
    return { status: 200, body: saved };
  },
};
