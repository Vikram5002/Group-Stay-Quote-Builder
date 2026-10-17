# Cost to serve (T4.07, with Track 3)

How much AWS costs per hotel per month, so the pricing model uses a number instead of a guess.

## Measured on dev (CloudWatch, 2026-10-16 to 2026-10-18)

| Metric                       | Value                                       | Source                       |
| ---------------------------- | ------------------------------------------- | ---------------------------- |
| API Lambda invocations       | 90                                          | `AWS/Lambda Invocations`     |
| API Lambda duration, average | **18.6 ms** (1024 MB, arm64)                | `AWS/Lambda Duration`        |
| Worker invocations           | 4                                           | `AWS/Lambda Invocations`     |
| HTTP API requests            | 120 (incl. rejected 401s)                   | `AWS/ApiGateway Count`       |
| DynamoDB write units         | 409 (mostly the one-off demo-calendar load) | `ConsumedWriteCapacityUnits` |
| DynamoDB read units          | 151                                         | `ConsumedReadCapacityUnits`  |

Type: **Observed**. The sample is small (smoke tests and a demo), so treat it as an order of
magnitude, not a benchmark.

## Per-property estimate

Usage assumption (**Assumption**, to replace with pilot data): 100 quotes a month per hotel,
about 15 API calls per quote (previews while editing, create, view, list, confirm), so 1,500
calls a month.

| Item               | Calculation                                             | Approx. USD / month         |
| ------------------ | ------------------------------------------------------- | --------------------------- |
| Lambda compute     | 1,500 x 0.019 s x 1 GB = 28 GB-s x $0.0000133 / GB-s    | $0.0004                     |
| Lambda requests    | 1,500 x $0.20 / million                                 | $0.0003                     |
| HTTP API           | 1,500 x $1.00 / million                                 | $0.0015                     |
| DynamoDB writes    | about 30 write units per quote x 100 x $0.625 / million | $0.0019                     |
| DynamoDB reads     | about 20 read units per quote x 100 x $0.125 / million  | $0.0003                     |
| CloudWatch logs    | about 1 KB per call, 1.5 MB x $0.50 / GB                | $0.0008                     |
| **Total variable** |                                                         | **about $0.005 (under ₹1)** |

Shared, fixed for the whole deployment (not per hotel): CloudFront and S3 hosting (cents at this
scale), Cognito (free for the first 10,000 monthly active users at the time of writing),
CloudWatch alarms (about $0.10 each, 5 alarms), and the dashboard (free tier: 3 dashboards).

Prices are **approximate list prices** for illustration (Lambda arm64, HTTP API, DynamoDB
on-demand, CloudWatch Logs ingestion); they vary by region and change over time. Type:
**Derived (measured usage x list prices)**. Verify in the AWS Pricing Calculator for
`ap-south-1` before quoting them.

## What it means for pricing

AWS variable cost per hotel is **well under ₹10 a month**, far below the ₹100 to ₹800 band the
first model assumed. The real cost to serve is **support and onboarding time**, not cloud
compute. The model's AWS band is updated to ₹1 / ₹10 / ₹100
([inputs.json](model/inputs.json)); support remains the dominant cost and is still an
assumption until the pilot log measures it.

## To do

- Activate the `project` cost-allocation tag in Billing (it becomes selectable about 24 hours
  after tagged resources exist), then read real cost per service from Cost Explorer after a week
  of use. The account also hosts unrelated resources, so untagged totals would overstate cost.
- Replace the usage assumption with the pilot's real calls per quote.
