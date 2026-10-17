# Group Stay Quote Builder (Case C32)

Fynd x NMIMS Hyderabad, product and business simulation.

A sales manager at a small hotel enters a group request (rooms, dates, room type, inclusions). The system returns a feasible, dated package that respects room-night capacity and a contribution floor. It holds inventory atomically, expires stale quotes, and explains every decision.

> **Honesty note:** all data in this project is synthetic. Nothing here claims live revenue, market demand or production readiness. Items marked HYPOTHESIS or ASSUMPTION must be tested before being treated as fact.

## Stack

React, Node.js, Express, TypeScript, AWS serverless (Lambda, API Gateway, DynamoDB, Cognito, S3, CloudFront, EventBridge Scheduler), defined in CDK.

## Repository layout

```
packages/core/     pure rules engine and API contract (Zod schemas)   Track 1
apps/api/          Express API, services, repositories, Lambda        Track 1
apps/web/          React SPA                                          Track 2
infra/             AWS CDK app                                        Track 3
evidence/          baseline, negotiated scope, final evidence, ledger Track 4
data/fixtures/     case fixture (authoritative schema) and scenarios
docs/              blueprint, roadmap, decisions, OpenAPI, branching
```

## Planning documents

- [Master blueprint](docs/blueprint/C32_Master_Blueprint.docx)
- [Four-track roadmap](docs/blueprint/C32_Roadmap_4_Tracks.docx)
- [Branching and phases](docs/BRANCHING.md)

## Public checks (from the fixture)

| #   | Input                                                  | Expected                                                   |
| --- | ------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | 10 standard rooms, 2 nights from 2026-11-01, rate 2000 | Revenue 40000, contribution 24000, auto-confirm allowed    |
| 2   | Same with 12 rooms, 10 available                       | Partial offer for 10 rooms, or decline; never an over-hold |
| 3   | Rate below the contribution floor                      | Review required; cannot auto-confirm                       |
