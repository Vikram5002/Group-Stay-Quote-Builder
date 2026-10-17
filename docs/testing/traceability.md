# Test traceability (Track 1)

Every golden test (blueprint 14.2) and property (14.3) mapped to the tests that prove it.
Core tests are in `packages/core/test/`, API tests in `apps/api/test/` (`data/`, `services/`
and `http/` run against DynamoDB Local). All pass in CI on every push.

## Rubric (25 points)

| Rubric line                                      | Golden tests       | Proven by                                                                                     |
| ------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------- |
| 10 pts: 10 rooms x 2 nights x 2000 = 40000       | T01, T03, T18      | `pricing.golden`, `evaluate.golden`, `services/create-quote`, `http/api` public check 1       |
| 10 pts: 12 requested, 10 available               | T02, T10, T11, T12 | `evaluate.golden`, `services/create-quote`, `services/concurrency`, `http/api` public check 2 |
| 5 pts: below floor needs review, no auto-confirm | T04, T05, T16, T17 | `pricing.golden`, `services/confirm-quote`, `services/review`, `http/api` public check 3      |

## Golden tests T01 to T25

| ID  | Scenario                                         | Tests                                                         |
| --- | ------------------------------------------------ | ------------------------------------------------------------- |
| T01 | Fixture quote: 40000 revenue, 24000 contribution | `pricing.golden`, `evaluate.golden`, `services/create-quote`  |
| T02 | 12 requested, 10 available: partial for 10       | `evaluate.golden`, `services/create-quote`, `data/holds`      |
| T03 | Rate 1800: exactly at the floor passes           | `pricing.golden`                                              |
| T04 | Rate 1799: breach, shortfall 20                  | `pricing.golden`                                              |
| T05 | Rate 1500: review, confirm is 409                | `pricing.golden`, `evaluate.golden`, `services/confirm-quote` |
| T06 | Null cost: contribution null, REVIEW             | `unknowns`, `evaluate.golden`                                 |
| T07 | Bad rooms: 422 with field path                   | `request`, `http/api`                                         |
| T08 | Bad nights or dates: 422                         | `request`, `http/api`                                         |
| T09 | Missing inventory row: NO_INVENTORY_DATA         | `evaluate.golden`                                             |
| T10 | Minimum over nights (10 and 8): 8 offered        | `evaluate.golden` (both floor modes, see D-020)               |
| T11 | Nothing sellable: DECLINE                        | `evaluate.golden`                                             |
| T12 | 20 parallel creates: exactly one holds           | `services/concurrency`                                        |
| T13 | A holds all, B declined, A expires, B holds      | `services/concurrency`, `data/holds`                          |
| T14 | Breakfast bundled: 18000, REVIEW, min rate 2100  | `evaluate.golden`                                             |
| T15 | Confirm after expiry: 410, rooms back            | `services/confirm-quote`, `http/api`                          |
| T16 | Owner approves with reason, confirm succeeds     | `services/review`, `http/review`                              |
| T17 | Terms changed after approval; self-approval 403  | `services/review`, `http/review`                              |
| T18 | Minimum safe rate rounds up to 1753              | `pricing.golden`                                              |
| T19 | Breakfast charged separately: 26000, OFFER       | `evaluate.golden`                                             |
| T20 | Amend 10 to 7: 16800, review under absolute      | `amend`, `services/changes`, `http/changes`                   |
| T21 | Empty CSV cell imports as null, not 0            | `imports`, `services/imports`, `http/files`                   |
| T22 | Re-import unchanged; bad rows listed by number   | `imports`, `services/imports`, `http/files`                   |
| T23 | Evidence bundle with versions and checksums      | `services/exports`, `http/files`                              |
| T24 | Double-submit confirm: one transition            | `services/confirm-quote`, `http/api`                          |
| T25 | Validity 72h; too late to quote                  | `validity`                                                    |

## Properties P1 to P6 (fast-check, `properties`)

| ID  | Invariant                                                   | Also                                   |
| --- | ----------------------------------------------------------- | -------------------------------------- |
| P1  | contribution = revenue - all costs, integers only           |                                        |
| P2  | Revenue never falls as rate, rooms or nights rise           |                                        |
| P3  | Offered rooms never exceed requested or sellable            |                                        |
| P4  | Floor passes at the minimum safe rate, fails one rupee less |                                        |
| P5  | Ledger invariant under any sequence of moves                | `data/holds.model` (DynamoDB vs model) |
| P6  | Unknown never becomes a number                              |                                        |

## Beyond the catalogue

Concurrency and exactly-once: racing releases, confirms, expiries, approvals and amendments
(`data/holds`, `services/*`, `services/worker`). Contract conformance: every HTTP response is
parsed with its contract schema (`http/*`). Roles: every route against every role
(`http/api`). Lambda adapter with HTTP API v2 events (`lambda`). Bundles boot (`npm run bundle`).
Bug-bash regressions (`http/bugbash`, `services/imports`).
