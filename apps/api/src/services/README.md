# Services (use cases)

The only layer that knows the workflow (blueprint 11.1): load data, call `@c32/core`, commit one
DynamoDB transaction, append the audit event. Routes (T1.09) stay thin and call these.

| Service        | What it does                                                                          |
| -------------- | ------------------------------------------------------------------------------------- |
| `createQuote`  | Evaluate, then holds + quote + `QUOTE_CREATED` in one transaction; retries on a race  |
| `confirmQuote` | BR-10 checks; holds to confirmed + quote + `CONFIRMED`; expired quotes give 410       |
| `expireQuote`  | Mark EXPIRED, release holds, append `EXPIRED`; safe to call from anywhere, many times |
| `termsHash`    | SHA-256 of the canonical commercial terms that approvals bind to (BR-11)              |

Refusals are `ServiceError(code)`, where `code` is a contract error code (`APPROVAL_REQUIRED`,
`QUOTE_EXPIRED`, `INVALID_STATE`, ...). Time comes from the injected `Clock`; ids from `newId`.

Idempotency (`data/idempotency.ts`) wraps any mutating call:

```ts
await withIdempotency(
  ctx,
  { scope: `${actor.user_id}:confirm:${id}`, key, requestHash: requestHash(req), nowMs },
  async () => ({ status: 200, body: await confirmQuote(deps, id, actor) }),
);
```

Concurrency is tested for real against DynamoDB Local: 20 parallel creates (T12), expiry then
rebook (T13), racing expiries and confirms, and double-submitted confirms (T24).
