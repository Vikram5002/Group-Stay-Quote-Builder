# Track 1 to Track 3: what to deploy

Everything the API and worker need from the CDK stacks (blueprint sections 7 and 15). Both
functions are built from `apps/api` with esbuild (Node.js 24, arm64).

## Functions

| Function | Entry                    | Handler   | Trigger                                                            |
| -------- | ------------------------ | --------- | ------------------------------------------------------------------ |
| API      | `apps/api/src/lambda.ts` | `handler` | HTTP API (payload v2), Cognito JWT authorizer on every `/v1` route |
| Worker   | `apps/api/src/worker.ts` | `handler` | See the three triggers below; DLQ on failure                       |

The API's `/health` route is public; everything else needs the JWT authorizer. Roles come from
the `cognito:groups` claim (`Sales`, `Owner`, `Viewer`).

## Worker triggers

| Event input                             | Source                                              |
| --------------------------------------- | --------------------------------------------------- |
| `{"type":"expire","quote_id":"<ulid>"}` | EventBridge Scheduler, created per quote by the API |
| `{"type":"sweep"}`                      | EventBridge rule, every 15 minutes                  |
| `{"type":"reconcile"}`                  | EventBridge rule, nightly                           |

All three are idempotent. An unknown event throws, so it lands in the DLQ.

## Environment variables

| Variable                | API | Worker | Meaning                                                     |
| ----------------------- | --- | ------ | ----------------------------------------------------------- |
| `TABLE_NAME`            | yes | yes    | The single table (keys in `apps/api/src/data/table.ts`)     |
| `AWS_REGION`            | yes | yes    | Set by Lambda; default `ap-south-1`                         |
| `PROPERTY_ID`           | yes | yes    | Default `p1`                                                |
| `DOCS_BUCKET`           | yes | yes    | Documents bucket for imports, exports, evidence and reports |
| `CORS_ORIGINS`          | yes |        | Comma list, for example the CloudFront domain               |
| `APP_VERSION`           | yes |        | Shown by `/health` and in the evidence manifest             |
| `EXPIRY_TARGET_ARN`     | yes |        | Worker function ARN (per-quote schedules target it)         |
| `EXPIRY_ROLE_ARN`       | yes |        | Role EventBridge Scheduler assumes to invoke the worker     |
| `EXPIRY_SCHEDULE_GROUP` | yes |        | Optional schedule group (default `default`)                 |

Without `DOCS_BUCKET` the import and export routes are not mounted (404). Without the two
`EXPIRY_*` variables no per-quote schedules are created and the sweeper handles expiry alone.

## Table

`PK` and `SK` (strings), one GSI `GSI1` on `GSI1PK` and `GSI1SK` (strings, projection ALL),
on-demand billing, point-in-time recovery, encryption at rest, TTL attribute `ttl` (cleanup
only; correctness never depends on it).

## IAM (least privilege)

| Principal      | Needs                                                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API role       | Table: Get, Put, Update, Delete, Query, TransactWrite, BatchWrite (and the GSI: Query). Bucket: GetObject, PutObject, ListBucket on `imports/`, `exports/`, `evidence/`. Scheduler: CreateSchedule, UpdateSchedule; `iam:PassRole` on `EXPIRY_ROLE_ARN` only |
| Worker role    | Table: Get, Put, Delete, Query, Scan, TransactWrite (GSI: Query). Bucket: GetObject, ListBucket on `evidence/`, PutObject on `reports/`. The DLQ                                                                                                             |
| Scheduler role | `lambda:InvokeFunction` on the worker only                                                                                                                                                                                                                   |

No function needs table delete, IAM wildcards, or any access key.

## Alarms (metrics are CloudWatch EMF, namespace `C32`)

| Metric            | Alarm when                      |
| ----------------- | ------------------------------- |
| `LedgerDrift`     | Greater than 0 (reconciliation) |
| `ExpiredReleased` | Dashboard only                  |

Logs are one JSON object per line with no personal data. `ledger_drift` is logged at error level
with the drifting nights and suggested counters.

## Seeding dev

`SEED_ALLOW_AWS=1 TABLE_NAME=<table> npm run seed -w @c32/api` loads the C32 fixture into a real
table. Without `SEED_ALLOW_AWS=1` the script only writes to DynamoDB Local.
