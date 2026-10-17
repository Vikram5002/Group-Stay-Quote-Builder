# API contract

**Version 0.3.0** (2026-10-18; 0.1.0 was handoff C1, end of week 1). Source of truth: [`packages/core/src/contract`](../../packages/core/src/contract). The [OpenAPI document](openapi.json) is generated from it with `npm run openapi`; a test fails if the two drift.

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

| Method | Path                                     | Roles        | Status |
| ------ | ---------------------------------------- | ------------ | ------ |
| GET    | `/health`                                | public       | live   |
| POST   | `/v1/quotes/preview`                     | Sales, Owner | live   |
| POST   | `/v1/quotes`                             | Sales, Owner | live   |
| GET    | `/v1/quotes`                             | all          | live   |
| GET    | `/v1/quotes/{id}`                        | all          | live   |
| POST   | `/v1/quotes/{id}/confirm`                | Sales, Owner | live   |
| POST   | `/v1/quotes/{id}/approve`                | Owner        | live   |
| POST   | `/v1/quotes/{id}/reject`                 | Owner        | live   |
| POST   | `/v1/quotes/{id}/extend`                 | Sales, Owner | live   |
| POST   | `/v1/quotes/{id}/amendments`             | Sales, Owner | live   |
| POST   | `/v1/quotes/{id}/cancel`                 | Sales, Owner | live   |
| GET    | `/v1/quotes/{id}/audit`                  | all          | live   |
| GET    | `/v1/availability`                       | all          | live   |
| POST   | `/v1/imports/{kind}/uploads`             | Owner        | live   |
| POST   | `/v1/imports/{kind}/{importId}/validate` | Owner        | live   |
| POST   | `/v1/imports/{kind}/{importId}/commit`   | Owner        | live   |
| GET    | `/v1/exports/quotes`                     | all          | live   |
| GET    | `/v1/exports/evidence`                   | all          | live   |
| GET    | `/v1/policy`                             | Owner        | live   |
| PUT    | `/v1/policy`                             | Owner        | live   |

## Changelog

### 0.3.0 (2026-10-18)

Additive: a 0.2.0 client is unaffected, and quotes saved before keep their terms hash.

- `QuoteRequest.discount_inr`: a discount in whole rupees off the full price per room-night. The rate becomes full price - discount, never below 0, and the owner's limit (`max_sales_discount_pct`) still applies. A request gives one of `discount_pct`, `discount_inr` or `rate_per_room_night_inr`; more than one is `INCONSISTENT`.
- `QuoteRequest.note_for_owner`: why Sales offers these terms, shown to the Owner who reviews them. Not part of the commercial terms.
- `Organiser.contact_name`, `email` and `phone`: who the quotation is addressed to. Not part of the commercial terms.
- Also in this contract since 0.2.0: the floor rate rule (D-056: `total_rooms_units`, floor rate = package floor / total rooms) and the Sales discount (D-057: `discount_pct`, `max_sales_discount_pct`, and the full-price totals).

### 0.2.0 (2026-10-18)

Fixes from the audit of the deployed app. Additive: a 0.1.0 client that ignores unknown fields is unaffected.

- `ImportRowIssue` gains an optional `value`: the cell as written in the file (CSV text, or JSON), when the issue is about one cell.
- Import rows whose `room_type` the property does not sell are rejected (`INVALID_ENUM` on `room_type`). The list is `PROPERTY_ROOM_TYPES` in `@c32/core`.
- Import row messages are plain words (for example "Rooms must be 0 or more") instead of the schema library's text.
- `POST /v1/quotes` and `/v1/quotes/preview` refuse a `stay.check_in` before today in the policy time zone with `422 VALIDATION_FAILED` (`OUT_OF_RANGE` on `stay.check_in`). A stay that starts too soon is still a `DECLINE` with `TOO_LATE_TO_QUOTE`.

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
