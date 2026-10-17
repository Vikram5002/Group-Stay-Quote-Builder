# Performance (local measurement)

Target (blueprint 4.2): quote preview and create p95 under 500 ms, warm. Cold starts are
documented separately.

**What this is:** the real Express app over HTTP against DynamoDB Local on one laptop,
sequential requests after a warm-up. **What it is not:** an AWS measurement. API Gateway,
Lambda and network add latency, and cold starts are not covered. Repeat on dev with
CloudWatch (Track 3) before claiming the target is met in AWS.

Run: `DYNAMODB_ENDPOINT=http://localhost:8100 npx tsx apps/api/scripts/perf.ts`

| Operation | n   | p50    | p95     | max     |
| --------- | --- | ------ | ------- | ------- |
| preview   | 200 | 2.9 ms | 3.8 ms  | 5.8 ms  |
| create    | 200 | 9.4 ms | 11.1 ms | 14.1 ms |
| confirm   | 200 | 8.4 ms | 10.2 ms | 14.5 ms |

Measured 2026-10-17, Node 24.11, DynamoDB Local 3.3.2, Windows 11. Every p95 is under the
500 ms target locally; the engine itself is not the bottleneck.
