# Pricing hypotheses and unit economics (T4.03)

Everything numeric here is a probe or a model, not a finding (blueprint 16). The model is
executable: change [`model/inputs.json`](model/inputs.json) and run
`node docs/business/model/unit-economics.mjs > docs/business/model/output.md`.
Current output: [model/output.md](model/output.md).

## Customer and value hypothesis

| Item        | Statement                                                                                                                     | Status     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Customer    | A small independent hotel: the owner plus one sales or front-office manager                                                   | Assumption |
| Problem     | Group quotes built in spreadsheets; availability checked by memory; discounts given without seeing contribution; stale quotes | Assumption |
| Value       | Faster, safer quotes: instant feasibility, no over-allocation, no sub-floor deal confirmed by accident, clear expiry          | Hypothesis |
| Alternative | Spreadsheet plus phone. We must beat it on speed and safety, not features                                                     | To verify  |

## What the product demonstrably does (Observed in tests and on the live dev site)

- Prices a group in one step and explains every number (T01, trail).
- Refuses to over-sell: 12 requested, 10 available gives a partial offer for 10 (T02, T12).
- Stops a below-floor discount from being confirmed without an owner (T05, T16, T17).
- Expires stale quotes and gives the rooms back (T15, T25).

These are product facts. Whether hotels value them enough to pay is the open question.

## Pricing options to test

| Model                        | Idea                                           | Probe values                         |
| ---------------------------- | ---------------------------------------------- | ------------------------------------ |
| A. Per-property subscription | Flat monthly fee, unlimited quotes             | ₹999, ₹1,999, ₹2,999 per month       |
| B. Per-confirmed-group fee   | A share of each confirmed group's contribution | 2%: ₹480 for a fixture-size group    |
| C. Hybrid                    | Low base fee plus a per-group fee              | Only if A and B both meet resistance |

### Price cards for interviews (show one at a time, cheapest last)

> **Card 1:** Group Quote Builder, ₹2,999 per month per property. Unlimited quotes, owner
> approvals, automatic expiry. Free 30-day pilot.
>
> **Card 2:** Same, ₹1,999 per month.
>
> **Card 3:** Same, ₹999 per month.
>
> Ask after each: "Would you start the free pilot and keep it at this price?" Record the first
> price at which they say yes, and what they say when they hesitate.

## Value arithmetic (Derived from the fixture)

Preventing one sub-floor confirmation like the rate-1500 case protects ₹6,000 of contribution
against the floor (T05). If a hotel avoids one such deal a month, a ₹1,999 subscription pays
back three times over; at one every six months, only ₹999 pays back. **The real frequency is
unknown** and is what interview question 7 measures.

## Model summary (see [model/output.md](model/output.md))

- With an assumed ₹300 to ₹800 AWS cost and an hour of support a month, ₹1,999 keeps a gross
  margin of 45% to 70% and breaks even at 3 to 4 properties against ₹3,000 of fixed costs.
- ₹999 loses money per property if AWS cost reaches ₹800, so it is only viable if the measured
  cost to serve is low (T4.07).
- The per-group fee earns ₹960 to ₹3,840 per property per month at 2 to 8 confirmed groups,
  but it ties revenue to volume the hotel controls.

**Working recommendation to test (not a conclusion):** lead with the ₹1,999 subscription and a
free 30-day shadow pilot; fall back to the hybrid if owners resist a fixed fee.

## Cost to serve (formulas)

```
gross_margin_pct       = 100 x (monthly_price - monthly_cost_to_serve) / monthly_price
break_even_properties  = fixed_monthly_costs / (monthly_price - variable_cost_per_property)
cost_to_serve          = AWS cost per property + support minutes x support rate
```

AWS cost per property is measured in [cost-to-serve.md](cost-to-serve.md).

## What would change our mind

- Owners say discounts below cost never happen and double bookings are rare: the safety value
  collapses; position on speed, or stop.
- No owner agrees to a free pilot at any price card: no evidence of demand; record it and stop.
- Measured cost to serve is above ₹800 per property: drop the ₹999 option.
