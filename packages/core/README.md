# @c32/core

Pure rules engine and API contract. Imported by the API (authoritative) and by the web app (instant previews), so there is one implementation and one test suite (ADR 3).

**Rule:** no I/O, no AWS, no Express, no Node built-ins. ESLint enforces it.

```
src/
├── contract/   Zod schemas, codes, routes, OpenAPI builder (contract v0.1)
├── domain/     Calendar maths; pricing and decision engine arrive in T1.02 to T1.05
├── fixtures/   Tested mapping from data/fixtures/fixture.json into domain inputs
└── index.ts    Public exports
scripts/        generate-openapi.ts (writes docs/api/openapi.json)
test/           Vitest suites
```

See the [API contract](../../docs/api/README.md) for what each schema means.
