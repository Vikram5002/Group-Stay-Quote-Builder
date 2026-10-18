# Group Stay Quote Builder

**Case C32 · Fynd x NMIMS Hyderabad · Team Chakravyuh**

| Link                    | URL                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Live application        | https://d3rs3n5bwfxtd9.cloudfront.net                                                 |
| Live API (health check) | https://q2etqj5j4d.execute-api.ap-south-1.amazonaws.com/health                        |
| Demo video              | https://drive.google.com/file/d/1XUvConBCk3l4juCNCxn6H6LvCmg8e22G/view?usp=drive_link |
| Pitch deck              | [docs/pitch/final-deck.pptx](docs/pitch/final-deck.pptx)                              |
| Tech and flow slides    | [docs/pitch/tech-and-flow.pptx](docs/pitch/tech-and-flow.pptx)                        |
| Final report            | [docs/business/final-report.md](docs/business/final-report.md)                        |
| Evidence (live checks)  | [evidence/02-final](evidence/02-final/README.md)                                      |
| Submission contact      | Vikram, bunny.vikram18@gmail.com                                                      |

> **Honesty note:** all data in this project is synthetic. Nothing here claims live revenue,
> real customers or market demand. Mocks and simulations are labelled where they are used.

## 1. Project and case summary

Small hotels (10 to 30 rooms) quote group stays (weddings, corporate offsites, tours) by hand in
spreadsheets and WhatsApp. That is slow, often over-sells rooms, and quietly sells below cost.

Group Stay Quote Builder lets hotel staff enter a group request (organiser, dates, rooms, room
type, inclusions, discount) and get, in under a second, a priced and dated quote that:

- respects room-night capacity on every night (no over-holds, even under concurrent requests);
- checks the hotel's **contribution floor** and routes anything below it to a manager;
- **holds the rooms** with a countdown and releases them automatically when the quote expires;
- explains every number with reason codes and an arithmetic trail;
- is emailed to the organiser as a PDF, then confirmed, paid and invoiced, with a full audit trail.

### Team

| Member  | Role                                         | Contribution                                                                                                                                                                                                                 |
| ------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vikram  | Track 1 and Track 3 lead, submission contact | Core pricing engine and API contract (`packages/core`), Express API on Lambda with DynamoDB (`apps/api`), AWS infrastructure and deployment with CDK (`infra`), email/PDF service, roles and Owner discount, test suites, CI |
| Lahari  | Track 2 lead                                 | React web application (`apps/web`): quote builder wizard, live price check, dashboard, review queue, availability calendar, imports, policy, landing page, UI design and accessibility, end-to-end tests                     |
| Mounesh | Track 4 (business)                           | Case analysis, customer discovery plan, pricing and unit economics, pitch deck and evidence                                                                                                                                  |
| Sreekar | Track 4 (business)                           | Go-to-market and growth experiment, demo script and demo video, pitch rehearsal and viva preparation                                                                                                                         |

## 2. How it works

### Roles (Cognito groups)

| Role                | Can do                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Reception**       | Build quotes, give a discount up to the limit (default 10%), confirm, extend, cancel, email quote and invoice    |
| **Service Manager** | Everything Reception can do, plus approve or reject reviews, policy, imports, and **Send to Owner for discount** |
| **Owner**           | Set any discount on quotes sent to them, bookings, payments, emails, imports, policy; does not build quotes      |
| **Viewer**          | Read only                                                                                                        |

### User flow

1. **Request:** Reception or the Service Manager enters the group, dates, rooms (several blocks
   allowed), room type, inclusions and a discount. A live price check updates as they type.
2. **Decision:** the engine returns OFFER, PARTIAL_OFFER, REVIEW or DECLINE with reasons.
   Non-declined quotes **hold rooms** until `valid_until`.
3. **Review:** below the floor or over the discount limit, a Service Manager who did not create the
   quote must approve it (four-eyes rule). Or the Service Manager sends it to the Owner with no
   discount, and the Owner sets any discount percent and issues it.
4. **Email quote:** a PDF with the hotel's details goes to the organiser (Amazon SES).
5. **Book and pay:** confirm the booking, record the payment, email the invoice.
6. **Expiry:** unconfirmed holds are released automatically (EventBridge Scheduler plus a sweeper).

### Important business rules

| Rule               | Detail                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Floor rate         | Package floor ÷ total rooms = full price per room-night (fixture: 20,000 ÷ 10 = ₹2,000)            |
| Contribution       | Room revenue + inclusions revenue − variable cost − inclusions cost                                |
| Contribution floor | Room-nights × lowest Reception rate (floor rate less the max discount) − variable cost             |
| Discount limit     | Reception may give up to `max_sales_discount_pct` (Owner setting, default 10%); more needs review  |
| Owner discount     | Any whole percent off the full price on quotes sent to the Owner; the floor is shown, not enforced |
| Holds              | Taken in one DynamoDB transaction with the quote; all or nothing, never over the available rooms   |
| Approvals          | Bound to a SHA-256 hash of the commercial terms; any change to the terms needs a new approval      |
| Unknown values     | A missing cost or rate is `null` (unknown), never treated as 0; such quotes go to review           |
| Audit              | Every change is a version-checked write with an audit event (who, when, why, before and after)     |

Full list with reasons: [decision log](docs/architecture/decisions.md) (D-001 to D-069).

### Architecture

```
Browser (React SPA) ──► CloudFront + S3 ──► Cognito (sign-in, role groups)
        │
        └── JWT ──► API Gateway HTTP API ──► Lambda (Express + core engine) ──► DynamoDB (one table)
                                                    ├── SES (quote and invoice PDFs)
                                                    ├── EventBridge Scheduler (hold expiry)
                                                    ├── S3 (imports, exports, evidence)
                                                    └── CloudWatch (logs, alarms)
```

| Layer    | Stack                                                                               |
| -------- | ----------------------------------------------------------------------------------- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS 4, TanStack Query, MSW (mock API)          |
| Backend  | Node.js 22+, Express 5 on AWS Lambda, Zod contract shared with the web app, pdf-lib |
| Data     | DynamoDB single table with point-in-time recovery                                   |
| Infra    | AWS CDK v2 (TypeScript), region ap-south-1 (Mumbai), GitHub Actions CI              |
| Tests    | Vitest, Testing Library, Playwright with axe accessibility checks, DynamoDB Local   |

Repository layout:

```
apps/api        Express API (local and Lambda)          Track 1
apps/web        React single-page app                   Track 2
packages/core   Pure rules engine and API contract       Track 1
infra           AWS CDK app                              Track 3
evidence        Baseline, negotiated scope, live proof   Track 4
data/fixtures   Case fixture and test scenarios
docs            API, architecture, business, testing, pitch
```

## 3. Run it locally

### Prerequisites

- Node.js 22.12 or later (24 recommended) and npm
- Docker (for DynamoDB Local)
- Git
- For deployment only: an AWS account, AWS CLI v2 configured (`aws configure`), and CDK
  bootstrapped once (`npx cdk bootstrap aws://<account>/ap-south-1`)

### Environment variables

Example files with no real secrets:

- [`apps/api/.env.example`](apps/api/.env.example): local API (`DYNAMODB_ENDPOINT`, `PORT`,
  `CORS_ORIGINS`, `LOCAL_FILES_DIR`); in AWS the CDK stack sets `TABLE_NAME`, `PROPERTY_ID`,
  `DOCS_BUCKET`, `SENDER_EMAIL`, `APP_VERSION`.
- [`apps/web/.env.example`](apps/web/.env.example): `VITE_API_MODE` (`mock` or `api`),
  `VITE_API_BASE_URL`, `VITE_AUTH_MODE` (`dev` or `cognito`), `VITE_COGNITO_DOMAIN`,
  `VITE_COGNITO_CLIENT_ID`.
- [`infra/.env.example`](infra/.env.example): `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`.

AWS credentials come from your AWS CLI profile and are never stored in the repository.

### Install, build and run

```bash
git clone https://github.com/Vikram5002/Group-Stay-Quote-Builder.git
cd Group-Stay-Quote-Builder

# Install (root workspaces: core, api, infra) and the web app (separate install)
npm ci
npm ci --prefix apps/web

# Build
npm run build                     # core, api, infra (TypeScript project references)
npm run build --prefix apps/web   # web production build into apps/web/dist

# Option A: web app alone with the in-browser mock API (no backend, no Docker)
cp apps/web/.env.example apps/web/.env
npm run dev --prefix apps/web     # http://localhost:5173, pick a role on the practice sign-in

# Option B: web app against the real local API
npm run db:up -w @c32/api         # DynamoDB Local in Docker on port 8100
DYNAMODB_ENDPOINT=http://localhost:8100 npm run seed -w @c32/api
DYNAMODB_ENDPOINT=http://localhost:8100 CORS_ORIGINS=http://localhost:5173 npm run dev -w @c32/api
# in a second terminal:
VITE_API_MODE=api VITE_API_BASE_URL=http://localhost:3000 VITE_AUTH_MODE=dev npm run dev --prefix apps/web
```

Locally the API takes the caller from a header instead of Cognito:
`x-dev-user: <user-id>:<Role>`, for example `x-dev-user: reception-1:Reception`. Emails are
written to `.local-files/outbox/` as `.eml` files instead of being sent.

### Test

```bash
DYNAMODB_ENDPOINT=http://localhost:8100 npm run verify   # format, lint, typecheck, core + API tests with coverage
npm run typecheck --prefix apps/web
npm test --prefix apps/web                               # web unit and component tests (MSW mocks)
npm run e2e:install --prefix apps/web && npm run e2e --prefix apps/web   # Playwright end-to-end
DYNAMODB_ENDPOINT=http://localhost:8100 npx tsx apps/api/scripts/perf.ts  # local latency measurement
```

Without `DYNAMODB_ENDPOINT` the database tests are skipped, not failed.

### Deploy (AWS)

```bash
npx tsc -b                                   # build core first; the bundle uses its output
npm run bundle -w @c32/api                   # Lambda bundle + smoke check
cd infra
npx cdk deploy c32-dev-data c32-dev-auth c32-dev-api c32-dev-observability c32-dev-web \
  -c stage=dev --require-approval never

# Build the web app with the stack outputs, then upload it
cd ../apps/web
VITE_API_MODE=api VITE_AUTH_MODE=cognito \
VITE_API_BASE_URL=<ApiUrl output> \
VITE_COGNITO_DOMAIN=<HostedUiDomain output> \
VITE_COGNITO_CLIENT_ID=<UserPoolClientId output> npm run build
cd ../../infra && npx cdk deploy c32-dev-web-content -c stage=dev --require-approval never
```

Then create users in the Cognito pool and add each to one group (`Owner`, `ServiceManager`,
`Reception` or `Viewer`), and verify the SES sender address. Step by step, with checks:
[runbook](docs/architecture/runbook.md). The same steps run in
[`.github/workflows/deploy-dev.yml`](.github/workflows/deploy-dev.yml).

## 4. Sample inputs and expected outputs

From the case fixture ([`data/fixtures/fixture.json`](data/fixtures/fixture.json)): 10 standard
rooms, variable cost ₹800 per room-night, package floor ₹20,000.

| #   | Input                                                    | Expected output                                                                   |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | 10 standard rooms, 2 nights from 2026-11-01, rate ₹2,000 | OFFER, room revenue ₹40,000, contribution ₹24,000, auto-confirm allowed           |
| 2   | Same with 12 rooms (only 10 available)                   | PARTIAL_OFFER for 10 rooms, shortfall 2; never more than 10 held                  |
| 3   | 10 rooms, 2 nights, rate ₹1,500 (below the floor)        | REVIEW with FLOOR_BREACH; confirm refused (409) until a Service Manager approves  |
| 4   | 10 rooms, 2 nights, discount 10%                         | Rate ₹1,800, exactly at the limit: OFFER                                          |
| 5   | Service Manager sends to Owner; Owner gives 30%          | Rate ₹1,400, room revenue ₹28,000, OFFERED with the Owner's approval, confirmable |

Try them on the live site (sign in, **New quote**) or with the API:

```bash
curl -X POST http://localhost:3000/v1/quotes/preview \
  -H 'content-type: application/json' -H 'x-dev-user: reception-1:Reception' \
  -d '{"organiser":{"name":"Fictional Events"},"stay":{"check_in":"2026-11-01","nights":2},"room_type":"standard","rooms":10,"rate_per_room_night_inr":2000}'
```

## 5. Test records

Run on 2026-10-18, Windows 11, Node 24.11, DynamoDB Local 3.3.2. **All test data is synthetic.**

| Suite                         | Setup                                 | Tests | Result                                                                      |
| ----------------------------- | ------------------------------------- | ----- | --------------------------------------------------------------------------- |
| Core engine (`packages/core`) | Pure unit and property tests, no I/O  | 386   | Pass                                                                        |
| API (`apps/api`)              | Real Express app on DynamoDB Local    | 612   | Pass (see note on flaky timing below)                                       |
| Web (`apps/web`)              | Testing Library + MSW mock API        | 404   | Pass                                                                        |
| Infra (`infra`)               | CDK synth assertions                  | incl. | Pass                                                                        |
| Live public checks            | Deployed AWS API, real Cognito tokens | 3     | Pass ([public-checks-live.json](evidence/02-final/public-checks-live.json)) |

Key scenarios (full map of golden tests T01 to T25 and properties P1 to P6:
[traceability](docs/testing/traceability.md)):

| ID    | Scenario                                     | Expected                                  | Actual                   | Status |
| ----- | -------------------------------------------- | ----------------------------------------- | ------------------------ | ------ |
| T01   | Fixture quote, 10 rooms × 2 nights at ₹2,000 | ₹40,000 revenue, ₹24,000 contribution     | As expected              | Pass   |
| T02   | 12 requested, 10 available                   | Partial offer for 10                      | As expected              | Pass   |
| T05   | Rate ₹1,500                                  | REVIEW; confirm returns 409               | As expected              | Pass   |
| T06   | Unknown cost                                 | Contribution null, REVIEW                 | As expected              | Pass   |
| T12   | 20 parallel creates for the last rooms       | Exactly one holds                         | As expected              | Pass   |
| T15   | Confirm after expiry                         | 410, rooms released                       | As expected              | Pass   |
| T16   | Service Manager approves with a reason       | OFFERED, confirm succeeds, audit recorded | As expected              | Pass   |
| T17   | Terms changed after approval; self-approval  | Approval void; 403                        | As expected              | Pass   |
| D-062 | Owner gives 30% on a quote sent to them      | ₹28,000 revenue, OFFERED, confirmable     | As expected              | Pass   |
| Perf  | 200 sequential preview/create/confirm, local | p95 < 500 ms                              | p95 3.8 / 11.1 / 10.2 ms | Pass   |

Labels and gaps, stated plainly:

- **Mocks:** the web unit tests use MSW, an in-browser mock of the API that follows the same
  contract; the API tests use DynamoDB Local, not AWS.
- **Load:** the performance figures are local and sequential ([performance](docs/testing/performance.md)).
  **No load or stress test has been run against AWS**; cold starts are not measured.
- **Flaky under load:** a few DynamoDB Local tests (imports, multi-line, changes) occasionally time
  out when the whole suite runs alongside other heavy work; they pass when re-run. Not a logic
  failure, but recorded here.
- **End-to-end:** the Playwright suite was last run in full before the role rename (D-069); the
  screenshot tour passes on the current build. Re-run `npm run e2e --prefix apps/web` before relying on it.
- **Live checks** in `evidence/02-final` were recorded on 2026-10-17, before the role rename.

## 6. Deployed application: operations

| Item        | Value                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| Environment | AWS `dev` stage, ap-south-1 (Mumbai)                                    |
| Sign-in     | Cognito hosted sign-in; users are created by an admin (no self sign-up) |
| API limits  | API Gateway throttling: 50 requests/s, burst 100                        |
| Data        | DynamoDB on-demand with point-in-time recovery; one property (`p1`)     |
| Email       | SES **sandbox**: mail is delivered only to verified addresses           |
| Monitoring  | CloudWatch alarms on API errors and latency (observability stack)       |

**Recovery steps**

| Problem                                       | Recovery                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Bad deploy                                    | Check out the previous tag or commit and run the deploy commands again (CDK replaces in place)    |
| Data damaged or deleted                       | Restore the table with DynamoDB point-in-time recovery to a new table, then point the stack at it |
| Rooms stuck as held                           | The expiry sweeper releases them; a ledger check is in the evidence export                        |
| User cannot sign in or sees the wrong screens | Check the user's Cognito group (`aws cognito-idp admin-list-groups-for-user`)                     |
| Email not delivered                           | Verify the recipient in SES (sandbox), or request SES production access                           |
| Site shows an unexpected error                | Check `/health`, then the Lambda logs in CloudWatch; the error shows a request id to search for   |

## 7. Known limitations

- All data is synthetic; no real hotel, customer or payment is involved.
- Payments are **recorded manually** after the organiser pays; there is no payment gateway.
- SES is in sandbox mode, so emails only reach verified addresses.
- One property per deployment; no multi-hotel tenancy yet.
- Taxes (GST) are out of scope; amounts exclude tax.
- A multi-block booking cannot be partly cancelled yet (cancel and re-quote instead).
- Only the `dev` stage is deployed; no AWS load test, and cold starts are not measured.
- Customer discovery interviews and the growth experiment are planned, not yet held
  ([evidence](evidence/README.md)).

## 8. AI, third-party use and data sources

- **AI assistance:** Claude Code (Anthropic) was used to help write code, tests, infrastructure and
  documentation. All output was reviewed, tested and committed by the team.
- **Third-party services:** AWS (Lambda, API Gateway, DynamoDB, Cognito, S3, CloudFront, SES,
  EventBridge Scheduler, CloudWatch), GitHub Actions.
- **Main libraries:** React, Vite, Tailwind CSS, TanStack Query, React Router, MSW, Express, Zod,
  pdf-lib, AWS SDK v3, AWS CDK, Vitest, Playwright, axe-core, Inter font (bundled).
- **Mocked or simulated integrations:** the web app's mock API (MSW) for offline development and
  tests; the local email outbox instead of SES; the practice sign-in instead of Cognito locally;
  manual payment recording instead of a payment gateway.
- **Data sources:** the case fixture in [`data/fixtures`](data/fixtures) and generated test
  scenarios. No external or personal data.

## 9. Reproduce the submitted result

1. Clone the repository at the submitted commit on `main`.
2. Follow **Install, build and run** and **Test** above: `npm run verify` with DynamoDB Local and
   the web tests should all pass (see the test records for known timing flakes).
3. Run the sample inputs in section 4 locally or on the live site and compare with the expected
   outputs.
4. Compare with the recorded live evidence in [`evidence/02-final`](evidence/02-final/README.md).
5. To stand up your own copy, follow **Deploy (AWS)** and the [runbook](docs/architecture/runbook.md).

## Supporting documents

- [Master blueprint](docs/blueprint/C32_Master_Blueprint.docx) and [four-track roadmap](docs/blueprint/C32_Roadmap_4_Tracks.docx)
- [Decision log](docs/architecture/decisions.md) · [Runbook](docs/architecture/runbook.md) · [API (OpenAPI)](docs/api/openapi.json)
- [Case analysis](docs/business/case-analysis.md) · [Pricing and unit economics](docs/business/pricing-and-unit-economics.md) · [Cost to serve](docs/business/cost-to-serve.md) · [Growth experiment](docs/business/growth-experiment.md) · [Demo script](docs/business/demo-script.md)
- [Test traceability](docs/testing/traceability.md) · [Performance](docs/testing/performance.md)
- [UI screenshots](docs/ui/screenshots) (taken before the latest UI restyle)
- [Contributing: branches and commits](.github/CONTRIBUTING.md)
