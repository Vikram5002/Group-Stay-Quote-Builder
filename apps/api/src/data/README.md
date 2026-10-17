# Data layer (DynamoDB)

Single-table repositories for the API (blueprint section 8). All DynamoDB expressions live here.

| Module       | What it does                                                                   |
| ------------ | ------------------------------------------------------------------------------ |
| `table.ts`   | Table, key and GSI names, `createTableInput` for local use, key builders       |
| `client.ts`  | Document client; DynamoDB Local or the Lambda role, never stored keys          |
| `catalog.ts` | Inventory and rate-plan nights: put, query by room type and date range         |
| `policy.ts`  | Policy get and save with an optimistic version check                           |
| `holds.ts`   | Transactional room-night holds: `acquireHolds`, `releaseHolds`, `confirmHolds` |
| `errors.ts`  | Typed errors the services map to problem+json codes                            |

## Holds in one transaction

Acquire, for every night of the stay:

```
Update INV#type#date  SET available -= n, held += n
                      IF attribute_exists(available_units) AND available_units >= n
Put    HOLD#type#date IF attribute_not_exists(PK)
```

plus one `HOLDSET` marker per quote and any items the caller adds (the quote, its audit event).
Everything succeeds or nothing is written. A night with unknown availability has no
`available_units` attribute, so it can never be held.

Release deletes each `held` line with an existence condition and gives the units back, so it
happens exactly once even when the expiry scheduler and the sweeper race. Confirm flips lines
to `confirmed` and moves units from held to confirmed.

## Running the integration tests

```bash
npm run db:up -w @c32/api            # DynamoDB Local 3.3.2 on http://localhost:8100
DYNAMODB_ENDPOINT=http://localhost:8100 npm test
npm run db:down -w @c32/api
```

No AWS account or credentials are needed. Without `DYNAMODB_ENDPOINT` the data suites are
skipped locally; CI always runs them against a service container.

`test/data/holds.model.test.ts` runs random hold, release and confirm sequences against both
DynamoDB and the pure ledger model in `@c32/core` and requires them to agree after every step.
