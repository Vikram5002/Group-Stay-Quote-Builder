# Case analysis (T4.01)

Case C32, Fynd x NMIMS Hyderabad: a Group Stay Quote Builder for a small hotel.

## The case in one paragraph

A small hotel's sales manager receives group enquiries (a wedding party, a corporate offsite)
and must answer with a dated package: rooms, nights, rate and inclusions. Today that happens in
spreadsheets and by phone. The tool must return a feasible, dated package that respects room
capacity and a contribution floor. The engineering side builds and tests the quote logic; the
business side tests whether hotels would pay for it, runs a growth experiment with a fictional
event organiser, and negotiates one product change: **add room-night availability and quote
expiry** (blueprint 1).

## Rubric (25 points)

| Points | Requirement                                                                  | Where it is met                |
| ------ | ---------------------------------------------------------------------------- | ------------------------------ |
| 10     | 10 rooms x 2 nights x 2000 = 40000 room revenue                              | T01; live on the deployed site |
| 10     | 12 requested, 10 available: a partial alternative or a decline               | T02, T10, T11, T12             |
| 5      | A discount below the contribution floor needs review and cannot auto-confirm | T04, T05, T16, T17             |

Evidence for each line: [test traceability](../testing/traceability.md).

## What we were given, and what was missing

| Given                                  | Missing (and how we closed it)                                                |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| One room type, two nights of inventory | Per-night rate plans and costs (rate plan model, nullable costs)              |
| A contribution floor of 20000          | Whether it is per package or per room-night (both implemented, policy switch) |
| "Expiry" as a requirement              | Any validity rule (72 h, 24 h stay cutoff: hypotheses to tune)                |
| "Inclusions" as a word                 | Costs and guest counts (inclusion model, unknown never treated as 0)          |
| "null means unknown, never zero"       | Enforced everywhere: unknown values lead to review, never a guess             |

## Open questions for the case owners

Send these early; record the answers in the decision log and the ledger.

1. **Is the contribution floor absolute (per package) or per room-night?** This changes outcomes,
   not just numbers: with the absolute 20000 floor, every group of 8 rooms or fewer for 2 nights
   needs owner review, and the T10 example becomes REVIEW instead of a partial offer.
2. Is there a required API shape, file format or file name for hidden checks?
3. Are multi-room-type quotes in scope, or is one room type per quote enough?
4. Is a rack rate available, and should discounts be measured against it?
5. What counts as the saved result: a JSON file, a database record, or screenshots?
6. Are rates ex-tax (our assumption), or must GST be in the contribution?
7. May we contact real hotels and organisers, or must the business work be role-play only?

**Status:** to send. Answers received: none yet.

## Stakeholders

| Stakeholder           | Interest                                                 |
| --------------------- | -------------------------------------------------------- |
| Sales manager (user)  | Answer enquiries fast, never over-promise rooms          |
| Hotel owner (buyer)   | Protect margin and inventory; approve exceptions         |
| Event organiser       | A clear, itemised, time-limited offer                    |
| Case owners, examiner | Correctness, honest evidence, a defensible business case |
