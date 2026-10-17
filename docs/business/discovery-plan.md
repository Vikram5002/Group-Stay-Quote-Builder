# Discovery plan (T4.02)

Goal: find out whether the problem is real and how big it is, before claiming any value
(blueprint 16.1 to 16.2). Every finding goes into the [evidence ledger](../../evidence/ledger.csv)
tagged Observed, Derived or Assumption.

**Honesty rule:** if real hotels cannot be contacted (open question 7), run the sessions as
role-play with classmates or a mentor and label every result **role-play: process evidence, not
market evidence**.

## Hypotheses this plan tests

| ID  | Hypothesis                                                  | Question(s)            |
| --- | ----------------------------------------------------------- | ---------------------- |
| H1  | Small hotels take a long time to answer group enquiries     | Q3, Q4, shadow         |
| H2  | Some past discounts fell below an unseen contribution floor | Q6, Q7                 |
| H3  | Double allocation or hold confusion happens                 | Q8                     |
| H4  | Owners will pay a per-property subscription or workflow fee | Q11, Q12 (price probe) |
| H5  | Quote expiry reduces stale-price disputes                   | Q9                     |
| H6  | Organisers respond faster to dated, itemised quotes         | Growth experiment      |

## Who to talk to (shortlist)

Aim for 3 to 5 sessions. Record why each fits.

| ID     | Profile                                | Why they fit                        | Real or role-play |
| ------ | -------------------------------------- | ----------------------------------- | ----------------- |
| HTL-01 | 25-room business hotel near HITEC City | Corporate offsite groups weekly     | to decide         |
| HTL-02 | 18-room heritage guest house, Old City | Wedding parties, seasonal peaks     | to decide         |
| HTL-03 | 40-room budget hotel near the airport  | Airline crew and tour groups        | to decide         |
| HTL-04 | 12-room resort, outskirts              | Weekend retreats with meals bundled | to decide         |
| HTL-05 | 30-room hotel run by an owner-manager  | Owner also sells: four-eyes tension | to decide         |

These profiles are illustrative targets, not contacted businesses.

## Consent (read at the start)

> We are students on a course project. We would like to ask about how you quote group bookings.
> It takes about 30 minutes. We will not record your name or your hotel's name, and we will
> delete our notes at the end of the course. You can stop at any time. Is that all right?

Store no personal data beyond a profile ID (blueprint 12.2).

## Interview guide (30 minutes)

**Warm-up**

1. What is your role, and how many rooms does the property have?
2. Roughly how many group enquiries (5 or more rooms) do you get in a month?

**Today's process (H1)**

3. Walk me through the last group enquiry you answered, step by step.
4. How long did it take from the enquiry to sending a price? What took the longest?
5. Where do availability and rates live: a system, a spreadsheet, memory?

**Margin (H2)**

6. How do you decide the lowest rate you would accept for a group?
7. Think of the last 10 group quotes. Were any discounted so far that you regretted it?
   How many?

**Inventory (H3)**

8. Has the same room ever been promised to two groups? What happened? How often?

**Expiry (H5)**

9. Has an organiser come back weeks later expecting an old price? How was it resolved?

**Workflow**

10. Who approves a deep discount? How do they find out?

**Willingness to pay (H4, price probe, last)**

11. If a tool answered group enquiries in minutes, never over-promised rooms and flagged
    low-margin deals before confirmation, what would that be worth to you each month?
12. Show the three price cards one at a time (see [pricing](pricing-and-unit-economics.md)):
    "Would you start a free 30-day pilot at this price after the pilot?" Note where they hesitate.

**Close:** "Could we shadow one real enquiry, or quote one in parallel during a pilot?"

## Desk shadowing (H1)

Watch one real (or simulated) group enquiry end to end and time it.

| Step                         | Start | End | Minutes | Notes |
| ---------------------------- | ----- | --- | ------- | ----- |
| Enquiry received             |       |     |         |       |
| Availability checked         |       |     |         |       |
| Rate and discount decided    |       |     |         |       |
| Approval sought (if any)     |       |     |         |       |
| Quote sent                   |       |     |         |       |
| **Enquiry to quote (total)** |       |     |         |       |

Then quote the same enquiry with the tool and time it the same way.

## Recording results

Log every session in [`evidence/discovery/sessions.csv`](../../evidence/discovery/sessions.csv),
one row per session, and copy each finding into the ledger with its type. Record negative
results too ("no double allocation in the last quarter" is a finding).

## Schedule

| Week | Activity                                                           |
| ---- | ------------------------------------------------------------------ |
| 1    | Decide real vs role-play (open question 7); book sessions          |
| 2    | Interviews and shadowing                                           |
| 3    | Pilot in shadow mode and the growth experiment                     |
| 4    | Price probes, pilot ask, update the ledger, go / pivot / stop memo |
