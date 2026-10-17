# Acceptance scenarios (Track 4, T4.04)

Business situations with expected outputs, run through the real engine by
`packages/core/test/scenarios.test.ts` on every CI run. Add a scenario by adding a file.

Each file: `request` (a quote request), optional `policy` overrides, optional `inventory` and
`rate_plan` (default: the case fixture), `now` (the issue instant), and `expect` (a partial
evaluation that must match). All data is synthetic; S14 and S15 use illustrative numbers.

| ID  | Situation                                              | Expected                        |
| --- | ------------------------------------------------------ | ------------------------------- |
| S01 | Fixture: 10 rooms x 2 nights at 2000                   | OFFER, 40000 / 24000            |
| S02 | 12 requested, 10 available                             | PARTIAL_OFFER for 10            |
| S03 | Rate 1800 (exactly the minimum)                        | OFFER, headroom 0               |
| S04 | Rate 1799                                              | REVIEW, shortfall 20            |
| S05 | Rate 1500                                              | REVIEW, counter-offer 1800      |
| S06 | Unknown variable cost                                  | REVIEW, contribution unknown    |
| S07 | Second night missing                                   | DECLINE, not on sale            |
| S08 | 10 then 8 rooms free, per-room-night floor             | PARTIAL_OFFER for 8             |
| S09 | Nothing sellable                                       | DECLINE                         |
| S10 | Breakfast bundled                                      | REVIEW, minimum rate 2100       |
| S11 | Breakfast charged separately                           | OFFER, 26000                    |
| S12 | After the stay cutoff                                  | DECLINE, too late               |
| S13 | Availability unknown                                   | REVIEW, no hold                 |
| S14 | Wedding: 6 rooms x 3 nights, breakfast, per-room-night | OFFER, 23400 vs floor 18000     |
| S15 | Corporate offsite: 4 rooms x 2 nights at 3000          | REVIEW; raise to 3300 or book 5 |
