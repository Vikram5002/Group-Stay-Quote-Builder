# @c32/api

Express API. The same app runs locally (`app.listen`) and in AWS Lambda through `@codegenie/serverless-express`, so local behaviour equals deployed behaviour.

```
src/
├── app.ts      createApp(): middleware, /health, 404 and error handlers
├── http.ts     request id, problem+json helpers, error handler
├── log.ts      structured JSON logs (no personal data)
├── local.ts    local entry point (PORT, default 3000)
└── lambda.ts   Lambda handler for API Gateway HTTP API
test/           supertest suites
```

```bash
npm run dev -w @c32/api      # watch mode
curl localhost:3000/health
```

Layering arrives with T1.09: `routes -> controllers -> services -> repositories`, with all business rules in `@c32/core`.

**For Track 3:** the Lambda handler is `apps/api/src/lambda.ts`, export `handler`. Bundle it with esbuild (Node.js 24, arm64). `GET /health` needs no JWT.
