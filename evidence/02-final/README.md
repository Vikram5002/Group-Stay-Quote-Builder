# Final evidence (v1)

What the finished product demonstrably does, produced from the real system, not written by hand.

| File                       | What it shows                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `public-checks-live.json`  | The three public checks run against the deployed AWS API: all pass                                                                                           |
| `test-report.json`         | Every automated suite and its result (774 tests, 0 failed)                                                                                                   |
| `deployment.md`            | Live URLs, stack status, smoke-test results                                                                                                                  |
| `evidence-bundle-live.zip` | The evidence bundle exported by the deployed API (`GET /v1/exports/evidence`): quotes, audit trail, inventory, ledger check, manifest with SHA-256 checksums |

Compare with the starting state in [`00-baseline`](../00-baseline/README.md) and the agreed
change in [`01-negotiated-scope.md`](../01-negotiated-scope.md). Claims and their evidence types
are in [`ledger.csv`](../ledger.csv). All data is synthetic.
