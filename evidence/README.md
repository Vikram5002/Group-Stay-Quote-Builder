# evidence (Track 4)

The change-negotiation trail the case requires (blueprint 3.3), and the evidence ledger.

| Path                     | Contents                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| `00-baseline/`           | Starting state (tag `baseline-v0`): pricing only; over-sells, no expiry  |
| `01-negotiated-scope.md` | The agreed change (tag `scope-negotiated`); stakeholder sign-off pending |
| `02-final/`              | Live public checks, test report, deployment proof, live evidence bundle  |
| `ledger.csv`             | Every claim tagged Observed, Derived, Assumption or Not yet tested       |
| `discovery/sessions.csv` | Interview log (empty until sessions are held)                            |
| `experiment/`            | Growth-experiment offers (A from the live system, B manual) and log      |

Rules: never present synthetic or role-play data as live revenue or market demand; record
negative results; get consent from anyone contacted; never add a log row for something that did
not happen.

The deployed API reads this folder from `s3://<docs bucket>/evidence/` for the evidence bundle;
sync it after changes: `aws s3 sync evidence s3://<docs bucket>/evidence/ --exclude "*.zip"`.
