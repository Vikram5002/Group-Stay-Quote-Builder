# Acceptance scenarios (Track 4, T4.04)

Business situations with expected outputs, run through the real engine by
`packages/core/test/scenarios.test.ts` on every CI run. Add a scenario by adding a file.

Each file: `request` (a quote request), optional `policy` overrides, optional `inventory` and
`rate_plan` (default: the case fixture), `now` (the issue instant), and `expect` (a partial
evaluation that must match). All data is synthetic; S14 and S15 use illustrative numbers.

| ID  | Situation                                      | Expected                     |
| --- | ---------------------------------------------- | ---------------------------- |
| S01 | Fixture: 10 rooms x 2 nights at 2000           | OFFER, 40000 / 24000         |
| S02 | 12 requested, 10 available                     | PARTIAL_OFFER for 10         |
| S03 | Rate 2000 (exactly the floor rate)             | OFFER, headroom 0            |
| S04 | Rate 1999                                      | REVIEW, shortfall 20         |
| S05 | Rate 1500                                      | REVIEW, counter-offer 2000   |
| S06 | Unknown variable cost                          | REVIEW, contribution unknown |
| S07 | Second night missing                           | DECLINE, not on sale         |
| S08 | 10 then 8 rooms free                           | PARTIAL_OFFER for 8          |
| S09 | Nothing sellable                               | DECLINE                      |
| S10 | Breakfast bundled                              | REVIEW, minimum rate 2300    |
| S11 | Breakfast charged separately                   | OFFER, 26000                 |
| S12 | After the stay cutoff                          | DECLINE, too late            |
| S13 | Availability unknown                           | REVIEW, no hold              |
| S14 | Wedding: 6 rooms x 3 nights at 2500, breakfast | OFFER, 23400 vs floor 19800  |
| S15 | Corporate offsite: 4 rooms x 2 nights at 3000  | OFFER, above the floor rate  |

Expected values follow the floor rule of D-056: floor rate = package floor / total rooms
(20000 / 10 = 2000 per room-night), variable cost included.
