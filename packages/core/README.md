# @c32/core

Pure rules engine and API contract. Imported by the API (authoritative) and by the web app (instant previews), so there is one implementation and one test suite (ADR 3).

**Rule:** no I/O, no AWS, no Express, no Node built-ins. ESLint enforces it.

```
src/
├── contract/   Zod schemas, codes, routes, OpenAPI builder (contract v0.1)
├── domain/     Calendar, integer money, floor rule, pricing engine (decision engine: T1.03 to T1.05)
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
// totals.room_revenue_inr 40000, contribution_inr 24000, min_rate_per_room_night_inr 1800
// floor_ok true; trail[1] "20 x 2000 = 40000 room revenue"
```

| Value                         | Rule                                                           |
| ----------------------------- | -------------------------------------------------------------- |
| `room_revenue_inr`            | Sum over nights of rooms x rate (BR-01)                        |
| `contribution_inr`            | Revenue (rooms + extras) minus cost (variable + extras)        |
| `contribution_floor_inr`      | Absolute package floor, or per room-night x room-nights (G1)   |
| `floor_ok`                    | Contribution at least the floor; equal passes (BR-06)          |
| `min_rate_per_room_night_inr` | Flat rate that just meets the floor, rounded up (BR-20)        |
| any of the above              | `null` when an input it depends on is unknown, never 0 (BR-07) |
