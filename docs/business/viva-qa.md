# Viva preparation: likely questions and answers

Everyone should know: **40000** revenue, **16000** cost, **24000** contribution, floor
**20000**, minimum safe rate **1800**, and that all data is synthetic.

## Product and business (Track 4 leads)

**Who is the customer?** A small independent hotel: the owner, who buys, and one sales manager,
who uses it. Status: assumption to test in interviews.

**What problem does it solve?** Group quotes built in spreadsheets: slow answers, rooms promised
twice, discounts given without seeing contribution, stale prices. Status: hypotheses H1 to H5.

**What did you prove, and what not?** Proven (tested and live): correct pricing, no over-selling
even under 20 parallel requests, below-floor deals blocked until a different owner approves,
expiry that releases rooms. **Not proven:** that hotels have the problem at the size we assume,
or that they will pay. Our ledger tags those as Assumption, with the test for each.

**Why should a hotel pay?** Preventing one below-floor deal like the rate-1500 case protects
₹6,000 of contribution. At ₹1,999 a month, the tool pays back if that happens about once every
three months. How often it happens is exactly what interview question 7 measures.

**What does it cost you to serve a hotel?** Measured AWS cost is under ₹1 per hotel per month at
100 quotes; support time dominates. So price is limited by what owners will pay, not our costs.

**What would make you stop?** Owners say below-cost discounts and double bookings never happen,
or no owner accepts a free pilot at any price card.

**How did the growth experiment work?** Role-play organisers receive either the tool's dated,
itemised offer or a vague manual reply; we compare minutes to first response and the outcome
tier. Role-play results are process evidence, not market demand.

## Engineering (Track 1 leads)

**Walk me through the fixture quote.** 10 rooms x 2 nights = 20 room-nights; 20 x 2000 = 40000
revenue; 20 x 800 = 16000 cost; 24000 contribution, 4000 above the 20000 floor. Minimum safe
rate = ceil((20000 + 16000) / 20) = 1800.

**What happens with 12 rooms?** Sellable rooms are the minimum over every night (10), so it is a
partial offer for 10 with a shortfall of 2. It can never hold 12: holds are DynamoDB
transactions that check availability on every night at once.

**How do you stop two quotes taking the same rooms?** One transaction per quote decrements
available rooms on every night under a condition that enough remain. If another quote got there
first, the transaction fails as a whole and we re-evaluate. Tested with 20 parallel requests: one
wins, 19 are declined, nothing is over-held.

**What does null mean?** Unknown, never zero. An unknown cost makes contribution unknown, and the
quote goes to review. We never guess.

**Why is the floor absolute?** It matches the fixture field; we also implemented a per-room-night
floor and flagged the choice as question 1 for the case owners, because it changes outcomes.

**How is an approval protected?** It records the terms hash. Any change to rooms, dates, rate or
inclusions changes the hash and voids the approval. The creator cannot approve their own quote.

**What if the same confirm is clicked twice?** Idempotency keys: the second request gets the
first one's stored response; one transition only (T24).

**How do quotes expire?** Every action checks validity; a per-quote EventBridge schedule and a
15-minute sweeper release rooms exactly once.

## Frontend (Track 2 leads)

**Why is the meter instant?** The browser runs the same rules engine as the server for the
preview; the server stays authoritative on holds and confirmation.

**Why is confirm not optimistic?** Only the server knows whether rooms are still held and the
quote is still valid, so the UI waits for its answer.

**Accessibility?** Keyboard use, labels, contrast and focus checked with axe in end-to-end tests.

## Infrastructure (Track 3 leads)

**Why serverless?** Near-zero idle cost and nothing to patch: Lambda, API Gateway, DynamoDB,
S3 with CloudFront, Cognito. No VPC or NAT gateway.

**How is it secured?** Cognito JWTs on every API route, least-privilege roles per function, no
public buckets, no stored AWS keys (GitHub deploys through OIDC). Tests fail the build if any of
that slips.

**How do you know it works in AWS, not just locally?** The three public checks were run against
the deployed API with real Cognito logins: `evidence/02-final/public-checks-live.json`.

## Hard questions to expect

- **"Isn't this just a calculator?"** The arithmetic is the easy part. The value is safety:
  no over-selling under concurrency, no unapproved below-floor deal, no stale quote, and every
  number explained.
- **"Your business evidence is thin."** Agreed, and we say so: the ledger shows what is
  Observed, Derived and Assumption, and the 30-day plan tests each assumption.
- **"What would you build next?"** Answers from the case owners on the floor, then a real pilot
  in shadow mode; then alternative-date suggestions and emailed PDF quotes.
