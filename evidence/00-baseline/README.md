# Baseline v0: the starting state

**Git tag:** `baseline-v0` (commit `e9f20b3`, the same commit as work package tag `T1.02`).

The case asks us to save the starting state before the negotiated product change (blueprint 3.3).
Our starting state is the first working quote builder: it prices a group package and checks the
contribution floor, and nothing else.

## What it does

- Room revenue, variable cost, contribution, margin.
- Contribution floor check and the minimum safe rate.
- An arithmetic trail explaining each number.

## What it does not do (the gap the negotiated change closes)

| Missing                    | Consequence, shown in `baseline-run.json`                                         |
| -------------------------- | --------------------------------------------------------------------------------- |
| Room-night availability    | 12 rooms are priced at ₹48,000 although the hotel has only 10: it would over-sell |
| Partial offer or decline   | No way to offer the 10 rooms that exist                                           |
| Quote expiry               | A quote never goes stale; prices and rooms are promised forever                   |
| Holds                      | Two quotes can promise the same rooms                                             |
| Decisions and reason codes | A floor breach is only a flag; nothing stops it being confirmed                   |

## Evidence

`baseline-run.json` was produced by running `price()` from `packages/core` **at that commit**
on the case fixture (10 standard rooms on 2026-11-01 and 2026-11-02, rate 2000, cost 800,
floor 20000), for the three public checks:

| Check                       | Baseline result                         | Correct behaviour (final)                |
| --------------------------- | --------------------------------------- | ---------------------------------------- |
| 10 rooms x 2 nights at 2000 | ₹40,000 revenue, ₹24,000 contribution   | Same, plus an OFFER with a 72 h expiry   |
| 12 rooms, 10 available      | Prices 12 rooms: ₹48,000 (over-sell)    | PARTIAL_OFFER for 10, never an over-hold |
| Rate 1500                   | `floor_ok: false`, but nothing enforced | REVIEW; confirm refused until approved   |

To reproduce: `git checkout baseline-v0`, `npm ci`, `npx tsc -b packages/core`, then call
`price()` as in the file's `generated_by` note.

All data is synthetic.
