# Contributing

## Branches and commits

- **One branch per track**, named `T1`, `T2`, `T3`, `T4`. All of a track's work packages are built on that branch, one after another.
- The end of each work package is marked with an annotated **tag** named after its ID: work package `T1-01` is tag `T1.01`, `T2-03` is tag `T2.03`, and so on.
- `main` is the integration branch. When a work package's "done when" line passes (`npm run verify`), the track owner tags it and merges the track branch into `main` with `git merge --no-ff`.
- Before merging, bring `main` into the track branch and re-run `npm run verify`, so `main` never goes red.
- Every meaningful change is committed and pushed straight away, in small commits.
- Commit messages are short, lowercase, plain words with no prefix and no colon, for example `quote request schema`.
- Changes to `packages/core` should be walked through with someone from a different track before merging.

## Track 1: Core Engine and API (branch `T1`)

| Tag     | Work package                                                                          | Weeks   | Done when                                                                                       |
| ------- | ------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `T1.01` | Monorepo, tooling, contract freeze (Zod schemas, error codes, OpenAPI)                | 1       | Repo builds; lint, typecheck, tests green; contract v0.1 published; API `/health` skeleton (M0) |
| `T1.02` | Core pricing engine: revenue, cost, contribution, margin, floor, minimum safe rate    | 1 to 2  | T01, T03, T04, T05, T18 pass                                                                    |
| `T1.03` | Null and unknown policy, validation, calendar semantics, expiry maths, injected clock | 2 to 3  | T06 to T08, T25 pass                                                                            |
| `T1.04` | Availability, sellable rooms, partial offer, decline, decision engine, reason codes   | 2 to 3  | T02, T09 to T11 pass; core v0.1 tagged (M1)                                                     |
| `T1.05` | Inclusions model and counter-offer generator                                          | 3 to 4  | T14, T19 pass                                                                                   |
| `T1.06` | Property-based tests P1 to P6                                                         | 3 to 4  | P1 to P6 green; coverage gate met                                                               |
| `T1.07` | DynamoDB repositories: single table, transactional holds, release, confirm            | 4 to 5  | Holds via transactions in DynamoDB Local                                                        |
| `T1.08` | Concurrency and idempotency tests                                                     | 5       | T12, T13, T24 pass                                                                              |
| `T1.09` | Express API: routes, RBAC, services, problem+json, Lambda adapter                     | 5 to 7  | Thin slice on dev (M2); full route set                                                          |
| `T1.10` | Approvals, four-eyes rule, terms hash, audit events                                   | 6       | T16, T17 pass                                                                                   |
| `T1.11` | Amendments (partial cancellation), extend, cancel                                     | 7       | T15, T20 pass                                                                                   |
| `T1.12` | CSV and JSON import/export; evidence bundle generator                                 | 7 to 8  | T21 to T23 pass                                                                                 |
| `T1.13` | Expiry worker and nightly reconciliation                                              | 8       | Holds released exactly once; zero drift                                                         |
| `T1.14` | Hardening, optional mutation testing, bug bash                                        | 9 to 10 | No open critical bugs; release candidate (M4)                                                   |

Other tracks follow the same rule on branches `T2`, `T3` and `T4`, with tags `T2.01` to `T2.09`, `T3.01` to `T3.11` and `T4.01` to `T4.09`.

## Tags

Work-package tags as above, plus milestone tags `baseline-v0`, `scope-negotiated`, `core-v0.1` (M1), `rc-1` (M4), `final-v1` (M5).
