# Group Stay Quote Builder

**Case C32 · Fynd x NMIMS Hyderabad · product and business simulation**

A sales manager at a small hotel enters a group request (rooms, dates, room type, inclusions). The system returns a feasible, dated package that respects room-night capacity and a contribution floor. It holds inventory atomically, expires stale quotes, and explains every decision with reason codes and an arithmetic trail.

> **Honesty note:** all data in this project is synthetic. Nothing here claims live revenue, market demand or production readiness. Items marked HYPOTHESIS or ASSUMPTION must be tested before being treated as fact.

## Repository layout

```
.
├── apps/
│   ├── api/            Express API, runs locally and in AWS Lambda           Track 1
│   └── web/            React single-page app                                 Track 2
├── packages/
│   └── core/           Pure rules engine and API contract (Zod)              Track 1
├── infra/              AWS CDK app (TypeScript)                              Track 3
├── evidence/           Baseline, negotiated scope, final evidence, ledger    Track 4
├── data/
│   └── fixtures/       Case fixture (authoritative) and test scenarios
├── docs/
│   ├── api/            OpenAPI 3.1 document generated from the contract
│   ├── architecture/   Decision log, Track 1 deployment handoff
│   ├── testing/        Test traceability, local performance
│   └── blueprint/      Master blueprint and four-track roadmap
└── .github/workflows/  Continuous integration
```

## Track 1 status (core engine and API)

All 14 work packages are done (tags `T1.01` to `T1.14`, `core-v0.1`). Every golden test T01 to T25
and property P1 to P6 passes in CI; see [test traceability](docs/testing/traceability.md). The API
implements every route in the contract. Deploying it is Track 3's job:
[what to deploy](docs/architecture/track1-handoff.md).

Run it locally (Docker for DynamoDB Local, no AWS account needed):

```bash
npm install
npm run db:up -w @c32/api && npm run seed -w @c32/api
npm run dev -w @c32/api        # http://localhost:3000, caller set with x-dev-user: sales-1:Sales
DYNAMODB_ENDPOINT=http://localhost:8100 npm run verify   # everything CI runs, with the database tests
```

## Getting started

Requires Node.js 22.12 or later (24 recommended).

```bash
npm install
npm run verify        # format check, lint, typecheck, tests with coverage
npm run dev -w @c32/api   # API on http://localhost:3000 (GET /health)
```

| Script                  | What it does                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `npm run build`         | Compile all TypeScript project references                    |
| `npm run typecheck`     | Type-check sources and tests                                 |
| `npm run lint`          | ESLint, including the purity rules for `@c32/core`           |
| `npm test`              | Run all unit and API tests (Vitest)                          |
| `npm run test:coverage` | Tests with the coverage gate (core: 95% lines, 90% branches) |
| `npm run openapi`       | Regenerate `docs/api/openapi.json` from the Zod contract     |
| `npm run verify`        | Everything CI runs                                           |

## Public checks (from the fixture)

| #   | Input                                                  | Expected                                                   |
| --- | ------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | 10 standard rooms, 2 nights from 2026-11-01, rate 2000 | Revenue 40000, contribution 24000, auto-confirm allowed    |
| 2   | Same with 12 rooms, 10 available                       | Partial offer for 10 rooms, or decline; never an over-hold |
| 3   | Rate below the contribution floor                      | Review required; cannot auto-confirm                       |

## Further reading

- [Contributing: branches and commits](.github/CONTRIBUTING.md)
- [Documentation index](docs/README.md)
- [API contract v0.1](docs/api/README.md)
- [Decision log](docs/architecture/decisions.md)
