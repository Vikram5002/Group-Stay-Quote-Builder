# @c32/core

Pure rules engine and API contract. Imported by the API (authoritative) and by the web app (instant previews), so there is one implementation and one test suite (ADR 3).

**Rule:** no I/O, no AWS, no Express, no Node built-ins. ESLint enforces it.

```
src/
├── contract/   Zod schemas, codes, routes, OpenAPI builder (contract v0.1)
├── domain/     Calendar, time zones, clock, money, floor, pricing, validity, validation, null policy
├── fixtures/   Tested mapping from data/fixtures/fixture.json into domain inputs
└── index.ts    Public exports
scripts/        generate-openapi.ts (writes docs/api/openapi.json)
test/           Vitest suites
```

See the [API contract](../../docs/api/README.md) for what each schema means.

## Pricing (T1.02)

```ts
import { DEFAULT_POLICY, flatNights, price } from '@c32/core';

const { totals, floor_ok, trail } = price({
  rooms: 10,
  nights: flatNights('2026-11-01', 2, 2000, 800), // or nightsFromRatePlan(...)
  floor: DEFAULT_POLICY,
});
// totals.room_revenue_inr 40000, contribution_inr 24000, floor_rate_per_room_night_inr 2000
// floor_ok true; trail[1] "20 x 2000 = 40000 room revenue"
```

| Value                         | Rule                                                           |
| ----------------------------- | -------------------------------------------------------------- |
| `room_revenue_inr`            | Sum over nights of rooms x rate (BR-01)                        |
| `contribution_inr`            | Revenue (rooms + extras) minus cost (variable + extras)        |
| `contribution_floor_inr`      | Floor rate (package floor / total rooms) x room-nights - cost  |
| `floor_ok`                    | Contribution at least the floor; equal passes (BR-06)          |
| `min_rate_per_room_night_inr` | Flat rate that just meets the floor, rounded up (BR-20)        |
| any of the above              | `null` when an input it depends on is unknown, never 0 (BR-07) |

## Validation, validity and unknowns (T1.03)

```ts
import {
  DEFAULT_POLICY,
  computeValidity,
  isExpired,
  systemClock,
  unknownPricingReasons,
  validateQuoteRequest,
} from '@c32/core';

const r = validateQuoteRequest(body, '/v1/quotes');
if (!r.ok) return r.problem; // 422 VALIDATION_FAILED with field paths and codes
// r.value.stay: { check_in, check_out, nights, night_dates } (nights or check_out filled in)

const v = computeValidity(systemClock.now(), r.value.stay.check_in, DEFAULT_POLICY);
// v.valid_until (UTC), v.limited_by, v.too_late -> TOO_LATE_TO_QUOTE
isExpired(v.valid_until, clock.now()); // authoritative on every read and confirm

unknownPricingReasons(nights, extras); // ['UNKNOWN_COST'] / ['UNKNOWN_RATE']; never treated as 0
```

| Piece                       | Rule                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `validateQuoteRequest`      | Rejects bad and unknown fields with stable codes (FR-06, BR-18)          |
| `computeValidity`           | min(issued + validity, check-in start in property zone - cutoff) (BR-09) |
| `isExpired`                 | Expired from `valid_until` onward                                        |
| `Clock`                     | `systemClock` in services; `fixedClock` / `ManualClock` in tests         |
| `formatInZone` / `toUtcIso` | IST for display, UTC for storage (G13)                                   |

## Decision engine (T1.04)

```ts
import { evaluate, systemClock, validateQuoteRequest } from '@c32/core';

const v = validateQuoteRequest(body);
if (!v.ok) return v.problem;
const { evaluation, validity } = evaluate(v.value, {
  inventory, // InventoryNight[] for the property
  ratePlan, // RatePlanNight[]
  policy,
  nowMs: systemClock.now(),
});
// evaluation.decision: OFFER | PARTIAL_OFFER | REVIEW | DECLINE, with reasons and a trail
```

| Order | Condition                                         | Decision      | Reason                 |
| ----- | ------------------------------------------------- | ------------- | ---------------------- |
| 1     | Cutoff leaves less than `min_validity_hours`      | DECLINE       | `TOO_LATE_TO_QUOTE`    |
| 2     | A night has no inventory row                      | DECLINE       | `NO_INVENTORY_DATA`    |
| 3     | Sellable is 0, or short and below minimum partial | DECLINE       | `NO_CAPACITY`          |
| 4     | Availability unknown on a night                   | REVIEW        | `UNKNOWN_AVAILABILITY` |
| 5     | Floor breach or unknown rate or cost              | REVIEW        | `FLOOR_BREACH` etc.    |
| 6     | Short of rooms, otherwise clean                   | PARTIAL_OFFER | `PARTIAL_AVAILABILITY` |
| 7     | Everything fine                                   | OFFER         | none (auto-confirm)    |

Sellable rooms are the minimum over the stay's nights. Offered rooms never exceed it (BR-05).

## Inclusions and counter-offers (T1.05)

```ts
const { evaluation } = evaluate(request, ctx);
// request.inclusions: [{ name: 'Breakfast', basis: 'per_guest_night', unit_cost_inr: 150,
//                        included_in_rate: true }]
// evaluation.counter_offers: [
//   { type: 'RAISE_RATE', rate_per_room_night_inr: 2100, contribution_inr: 20000, ... },
//   { type: 'REPRICE_INCLUSION', inclusions: [...], contribution_inr: 24000, ... },
// ]
```

| Basis             | Units                            | Revenue                                      |
| ----------------- | -------------------------------- | -------------------------------------------- |
| `per_guest_night` | rooms x guests per room x nights | `price_inr` x units, only if not in the rate |
| `per_room_night`  | rooms x nights                   | same                                         |
| unknown           | guests or unit cost `null`       | cost unknown: REVIEW with `UNKNOWN_COST`     |

| Counter-offer       | When                       | Proposal                                        |
| ------------------- | -------------------------- | ----------------------------------------------- |
| `PARTIAL_ROOMS`     | Short of rooms             | The sellable rooms                              |
| `RAISE_RATE`        | Floor breach               | The minimum safe rate                           |
| `REPRICE_INCLUSION` | Floor breach, bundled item | Charge it separately at its unit cost           |
| `CHANGE_VOLUME`     | Floor breach               | Fewest extra rooms (within stock) that clear it |

Each counter-offer is re-run through the engine and kept only if it is a clean OFFER.

## Property tests and the ledger model (T1.06)

`test/properties.test.ts` checks the blueprint's invariants on random inputs (fast-check):

| ID  | Invariant                                                                     |
| --- | ----------------------------------------------------------------------------- |
| P1  | contribution = revenue - all costs; every money value is a safe integer       |
| P2  | revenue never falls when rate, rooms or nights go up                          |
| P3  | offered rooms never exceed requested or sellable, nor do counter-offer rooms  |
| P4  | the floor passes at the minimum safe rate and fails one rupee below           |
| P5  | any sequence of ledger moves keeps total = available + held + confirmed, >= 0 |
| P6  | an unknown input never becomes a number; it is null, or REVIEW with no offers |

`domain/ledger.ts` is the pure reference model for room-night holds (BR-13 to BR-15):
`hold` (all nights or none), `release` (exactly once), `confirm`, `amend`, `cancel`, and
`checkLedger` (drift report). The DynamoDB repository in T1.07 is tested against it.
