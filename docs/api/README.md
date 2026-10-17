# API contract

**Version 0.1.0** (handoff C1, end of week 1). Source of truth: [`packages/core/src/contract`](../../packages/core/src/contract). The [OpenAPI document](openapi.json) is generated from it with `npm run openapi`; a test fails if the two drift.

## Conventions

- Base path `/v1`. Every route needs a Cognito JWT except `GET /health`.
- All money is **integer INR** (`_inr`). Percentages (`_pct`) are display only and never compared by rules.
- **`null` means unknown, never zero.** Unknown cost, rate or availability produces `REVIEW` with a reason code.
- Requests are strict: unknown fields are rejected with `UNKNOWN_FIELD` (BR-18).
- Mutating routes accept an `Idempotency-Key` header (BR-17).
- Errors are RFC 9457 `application/problem+json` with a stable `code` and, for validation, a list of `{ path, code, message }` issues.

## Contents

| Module                                                            | Schemas and constants                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`primitives.ts`](../../packages/core/src/contract/primitives.ts) | `LIMITS`, `IsoDate`, `Instant`, `Inr`, `UnitInr`, `Units`, `RoomType`, `Ulid`, `TermsHash`              |
| [`codes.ts`](../../packages/core/src/contract/codes.ts)           | `Decision`, `QuoteStatus` and transitions, `ReasonCode`, `ErrorCode` with HTTP map, `Role`, enums       |
| [`policy.ts`](../../packages/core/src/contract/policy.ts)         | `Policy`, `PolicyUpdateRequest`, `DEFAULT_POLICY`                                                       |
| [`inventory.ts`](../../packages/core/src/contract/inventory.ts)   | `InventoryNight` (ledger invariant BR-15), `RatePlanNight`, `AvailabilityResponse`                      |
| [`quote.ts`](../../packages/core/src/contract/quote.ts)           | `QuoteRequest`, `Stay`, `InclusionInput`, `Evaluation`, `QuoteTotals`, `CounterOffer`, `Quote`, actions |
| [`problem.ts`](../../packages/core/src/contract/problem.ts)       | `ProblemDetails`, `ValidationIssue`, `problem()` builder                                                |
| [`audit.ts`](../../packages/core/src/contract/audit.ts)           | `QuoteEvent`                                                                                            |
| [`imports.ts`](../../packages/core/src/contract/imports.ts)       | CSV/JSON row schemas, `ImportReport`, `ExportLink`                                                      |
| [`routes.ts`](../../packages/core/src/contract/routes.ts)         | `ROUTES`: method, path, roles, idempotency, request and response schemas                                |
| [`validation.ts`](../../packages/core/src/contract/validation.ts) | `parseWith()`: never throws, maps Zod issues to stable codes                                            |

## Routes

| Method | Path                                     | Roles        | Status          |
| ------ | ---------------------------------------- | ------------ | --------------- |
| GET    | `/health`                                | public       | live            |
| POST   | `/v1/quotes/preview`                     | Sales, Owner | live            |
| POST   | `/v1/quotes`                             | Sales, Owner | live            |
| GET    | `/v1/quotes`                             | all          | live            |
| GET    | `/v1/quotes/{id}`                        | all          | live            |
| POST   | `/v1/quotes/{id}/confirm`                | Sales, Owner | live            |
| POST   | `/v1/quotes/{id}/approve`                | Owner        | live            |
| POST   | `/v1/quotes/{id}/reject`                 | Owner        | live            |
| POST   | `/v1/quotes/{id}/extend`                 | Sales, Owner | live            |
| POST   | `/v1/quotes/{id}/amendments`             | Sales, Owner | live            |
| POST   | `/v1/quotes/{id}/cancel`                 | Sales, Owner | live            |
| GET    | `/v1/quotes/{id}/audit`                  | all          | live            |
| GET    | `/v1/availability`                       | all          | live            |
| POST   | `/v1/imports/{kind}/uploads`             | Owner        | planned (T1.12) |
| POST   | `/v1/imports/{kind}/{importId}/validate` | Owner        | planned (T1.12) |
| POST   | `/v1/imports/{kind}/{importId}/commit`   | Owner        | planned (T1.12) |
| GET    | `/v1/exports/quotes`                     | all          | planned (T1.12) |
| GET    | `/v1/exports/evidence`                   | all          | planned (T1.12) |
| GET    | `/v1/policy`                             | Owner        | live            |
| PUT    | `/v1/policy`                             | Owner        | live            |

## Changelog

### 0.1.0 (2026-10-17)

First published contract. Differences from the blueprint text, all recorded in the [decision log](../architecture/decisions.md):

- Policy has separate `contribution_floor_inr` (absolute) and `floor_per_room_night_inr` (per room-night) fields (D-001).
- Policy gains `min_validity_hours`, which the validity rule needs but the blueprint entity list omitted (D-002).
- `stay` accepts `nights`, `check_out` or both (D-005).
- Error codes add `IDEMPOTENCY_CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413) and `UNSUPPORTED_MEDIA_TYPE` (415) (D-006).
- Imports use three explicit routes per kind: uploads, validate, commit.

## Run it locally

```bash
npm run db:up -w @c32/api      # DynamoDB Local on http://localhost:8100
npm run seed -w @c32/api       # create the table, load the fixture (10 rooms, 2026-11-01 and -02)
npm run dev -w @c32/api        # API on http://localhost:3000, CORS for http://localhost:5173
curl -H 'x-dev-user: sales-1:Sales' -H 'content-type: application/json'   -d '{"organiser":{"name":"Fictional Events"},"stay":{"check_in":"2026-11-01","nights":2},"room_type":"standard","rooms":10,"rate_per_room_night_inr":2000}'   http://localhost:3000/v1/quotes
```

Locally the caller is set with `x-dev-user: <user_id>:<Sales|Owner|Viewer>`. In AWS the same
routes take a Cognito JWT (`Authorization: Bearer ...`); the header is ignored there.
