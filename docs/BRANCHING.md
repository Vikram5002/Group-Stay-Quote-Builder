# Branching and phases

## Model

- `main` is the integration branch. It only receives merges from phase branches, through a pull request reviewed by someone from another track. Nobody commits to `main` directly.
- Each track works in **phase branches** named `track-<n>/phase-<m>-<short-name>`, cut from the latest `main`.
- A phase branch is merged (squash or merge commit) when its exit criteria pass in CI. The next phase branch is then cut from the updated `main`.
- Commit messages follow Conventional Commits and reference the work-package ID, for example `feat(core): add quote request schema [T1-01]`.
- Changes to `packages/core` always need a reviewer from a different track.

## Track 1: Core Engine and API (owner: Track 1)

| Phase | Branch | Work packages | Weeks | Exit criteria |
|---|---|---|---|---|
| 1 | `track-1/phase-1-foundations` | T1-01 | 1 | Monorepo builds; lint, typecheck and tests green; contract v0.1 published (schemas, codes, OpenAPI); API `/health` skeleton for Track 3 (milestone M0) |
| 2 | `track-1/phase-2-pricing-engine` | T1-02 | 1 to 2 | T01, T03, T04, T05, T18 pass |
| 3 | `track-1/phase-3-decision-engine` | T1-03, T1-04 | 2 to 3 | T02, T06 to T11, T25 pass; core v0.1 tagged (M1) |
| 4 | `track-1/phase-4-counter-offers` | T1-05, T1-06 | 3 to 4 | T14, T19 pass; property tests P1 to P6 green; coverage gate met |
| 5 | `track-1/phase-5-holds` | T1-07, T1-08 | 4 to 5 | Transactional holds in DynamoDB Local; T12, T13, T24 pass |
| 6 | `track-1/phase-6-api` | T1-09, T1-10, T1-11 | 5 to 7 | Thin slice on dev (M2); T15, T16, T17, T20 pass; full route set |
| 7 | `track-1/phase-7-import-export-worker` | T1-12, T1-13 | 7 to 8 | T21 to T23 pass; worker releases holds exactly once; zero drift |
| 8 | `track-1/phase-8-hardening` | T1-14 | 9 to 10 | No open critical bugs; release candidate (M4) |

## Other tracks (phase 1 branches created; owners define later phases)

| Track | Phase 1 branch | Work packages |
|---|---|---|
| 2 Frontend | `track-2/phase-1-design-system` | T2-01 |
| 3 AWS and DevOps | `track-3/phase-1-aws-foundations` | T3-01 |
| 4 Business and Evidence | `track-4/phase-1-case-analysis` | T4-01 |

## Tags

`baseline-v0`, `scope-negotiated`, `core-v0.1` (M1), `rc-1` (M4), `final-v1` (M5).
