# Negotiated scope record

**Git tag:** `scope-negotiated`. Starting state: [`00-baseline`](00-baseline/README.md)
(tag `baseline-v0`). Final evidence: [`02-final`](02-final/README.md).

**Status:** drafted by the team from the case brief and the built product. The stakeholder
session below has **not yet been held**; complete the session section and sign-off, then keep
this file as the record. Nothing below claims a customer agreed to anything.

## The product change requested

> Add **room-night availability** and **quote expiry** to the quote builder.

(Case C32, the product change the MBA side must negotiate.)

## Why it was needed (from the baseline)

The baseline priced 12 rooms when only 10 existed (₹48,000 for rooms that do not exist), never
let a quote go stale, and could not stop a below-floor discount from being confirmed. See
`00-baseline/baseline-run.json`.

## What was agreed (scope delivered)

| Area                    | Agreed behaviour                                                                    | Evidence                        |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| Room-night availability | Sellable rooms = the minimum over every night of the stay, per room type            | T02, T10, T11                   |
| Shortage                | Offer what exists (partial offer) or decline; never hold more than exists           | T02, T12 (20 parallel requests) |
| Holds                   | Rooms are held atomically for every night or not at all, released exactly once      | T12, T13, model-based test      |
| Quote expiry            | Valid 72 h, and never past 24 h before check-in; expired quotes release their rooms | T15, T25                        |
| Floor safety            | Below the floor needs owner review; the creator cannot approve their own deal       | T05, T16, T17                   |
| Unknown data            | An unknown cost, rate or availability leads to review, never a guess of 0           | T06, S06, S13                   |

## Acceptance criteria (all met, see test traceability)

1. 10 rooms x 2 nights x 2000 = ₹40,000 revenue, ₹24,000 contribution, confirmable.
2. 12 requested with 10 available gives a partial offer for 10, never an over-hold.
3. A rate below the floor needs review and cannot auto-confirm.
4. A quote past its validity cannot be confirmed (410) and its rooms return to inventory.

## Deferred (agreed out of scope for now)

| Item                            | Why deferred                                   | Tier  |
| ------------------------------- | ---------------------------------------------- | ----- |
| Alternative-date suggestions    | Nice to have; no rubric impact                 | COULD |
| PDF quotes and email sending    | Needs SES out of sandbox; manual sending works | COULD |
| Several room types in one quote | The fixture and the case use one room type     | COULD |
| Payments, channel manager, GST  | Different product; rates are treated as ex-tax | WON'T |
| Multi-property chains           | The customer is a single small hotel           | WON'T |

## Open decision that affects the agreed behaviour

**Floor semantics.** The fixture's `contribution_floor_inr: 20000` is implemented as an absolute
package floor by default, with a per-room-night alternative (1000 per room-night) as a policy
switch. Under the absolute floor, small groups always need owner review. The case owners should
choose (case analysis, question 1).

## Stakeholder session (to complete)

| Field                            | Value |
| -------------------------------- | ----- |
| Date                             |       |
| Who (role, not name)             |       |
| Real or role-play                |       |
| Change requested, in their words |       |
| Agreed as above? (yes / changes) |       |
| Deferrals accepted?              |       |
| Floor semantics chosen           |       |

## Sign-off

| Role                  | Name | Date |
| --------------------- | ---- | ---- |
| Product (Track 4)     |      |      |
| Engineering (Track 1) |      |      |
| Mentor / case owner   |      |      |
