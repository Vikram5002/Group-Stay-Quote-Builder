# Track 2 handoff: the web app

What Track 3 deploys, what Track 4 can use as evidence, how to run and test it, and what Track 2 must be ready to explain in the viva. The code is in `apps/web`; its own [README](../../apps/web/README.md) covers each work package.

## What it is

A React 18 single-page app (Vite, TypeScript, Tailwind, React Router, TanStack Query). It has ten screens: sign-in, dashboard, quote builder, quote detail, review queue, availability calendar, policy, imports and exports, evidence, and experiment log, plus a design-system gallery. All nine work packages (T2-01 to T2-09) are built and merged.

## For Track 3: building and deploying

- Build: `npm run build -w @c32/web`. Output is `apps/web/dist` (static files only: `index.html` and `assets/`).
- The app is a single-page app with client-side routes, so the CloudFront distribution must answer `403` and `404` from S3 with `/index.html` and status `200`, or deep links such as `/quotes/<id>` fail on reload.
- Build-time settings (Vite inlines them, so set them in the deploy step, not at runtime):

| Variable            | Value in AWS                                                   | Meaning                                                                                   |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | the API Gateway URL (or empty if the same origin routes `/v1`) | Where the API lives                                                                       |
| `VITE_API_MODE`     | leave unset (or `api`)                                         | Anything but `mock` uses the real API. A default production build has no mock code in it. |
| `VITE_AUTH_MODE`    | leave unset                                                    | Unset sends `Authorization: Bearer <token>`; `dev` is for the local API only              |

- CORS: the API allows the headers `authorization`, `content-type`, `idempotency-key`, `x-request-id` and `x-dev-user`, and methods GET, POST, PUT and OPTIONS, for the origins in its `CORS_ORIGINS`. Add the CloudFront domain there.
- Imports: the browser PUTs the file straight to the presigned S3 URL with `Content-Type` exactly `text/csv` or `application/json`. The documents bucket CORS must allow `PUT` from the web origin with that header.
- A fallback demo build with no backend: `VITE_API_MODE=mock npm run build -w @c32/web` bundles the mock API (a separate chunk). It is the roadmap's "recorded demo as backup" for an unstable dev environment. Do not deploy it as the real site.
- Security headers (CloudFront response headers policy): the app loads no third-party scripts, fonts or styles, so a strict policy such as `default-src 'self'` works. Inline styles come only from React `style` attributes (the contribution meter and the calendar bars), so `style-src` needs `'unsafe-inline'` for those, or the nonce route.

### What is still missing for AWS

- **Cognito sign-in.** The sign-in page is a practice sign-in (name and role). The Cognito hosted UI with PKCE (Amplify Auth, blueprint 10.1) replaces `src/features/auth/` and nothing else: the rest of the app reads only `useAuth()` (session, token, sign-out). It needs the user pool id, app client id and hosted-UI domain from Track 3 (handoff C4).
- **Roles from the token.** The API reads the role from `cognito:groups`. The screens read the role from the session, so the Cognito provider must read the same groups.

## For Track 4: evidence the web app gives you

- **Screenshots.** `docs/ui/screenshots/` holds 17 screenshots taken by `npm run screenshots -w @c32/web` (mock data, one story: the fixture, the shortage, the below-floor quote through approval, then every other screen and a phone view). Retake them after any UI change.
- **Test reports.** `npm run test -w @c32/web` (222 unit and component tests, including axe) and `npm run e2e -w @c32/web` (11 end-to-end tests in real Chromium: the three rubric flows, axe on every screen, keyboard, phone width). The e2e HTML report is written to `apps/web/playwright-report/`.
- **Public checks.** The Evidence page runs the three public checks from `data/fixtures/fixture.json` against whichever API is connected and downloads the result as JSON.
- **Ledger, stages and experiment log.** Today these are data in the app, not in the API:
  - Ledger rows: `apps/web/src/features/evidence/ledger.ts`. Replace the rows with the contents of `evidence/ledger.csv`.
  - Stage files: `stages.ts`. Set `provided: true` for a stage once its files are committed under `evidence/`.
  - Experiment log: kept in the browser. Use **Export CSV** and commit the file under `evidence/02-final/`. Only people who agreed to take part are logged, and only a role is recorded, not a name.

## For everyone: running it

```
npm run dev -w @c32/web          # http://localhost:5173, mock API, no backend
npm run e2e:install -w @c32/web  # once: downloads Chromium
npm run e2e -w @c32/web          # end-to-end tests (starts the dev server itself)
```

To run against the real local API, see "Run against the real API" in the web README. That path is unit tested but has not been run against a live API yet; it needs Docker for DynamoDB Local.

## Guardrails the code enforces

- Unknown is shown as Unknown, never as 0 or blank (a test per component).
- Status is shown with text and an icon, not colour alone; every colour pair is contrast-checked.
- Confirmation and every other action wait for the server; each mutation carries an `Idempotency-Key`.
- The screen hides or disables what a role cannot do, but the API enforces every rule.

## Viva: what Track 2 should be ready to explain

| Question                                                     | Short answer                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How is state managed?                                        | Server state in TanStack Query (cache, invalidation after each mutation); form state in React state; a small context for the session and the API client. No global store.                                                  |
| Why does the contribution meter move without a network call? | The builder calls the shared `price()` from `@c32/core` when only the rate changed, using the server's last cost per room-night. It is labelled an estimate until the server confirms. Anything else waits for the server. |
| How do client and server validation stay the same?           | Both use the Zod schemas in `@c32/core` (`QuoteRequest`, `PolicyUpdateRequest`, the import row schemas). The client maps issue codes to plain language.                                                                    |
| Why is confirm not optimistic?                               | The server owns holds and expiry. A confirm can fail because the hold lapsed or someone else took the rooms, so the screen changes only on the server's answer, with one idempotency key per request.                      |
| How are errors shown?                                        | `problem+json` codes map to a plain-language message and a next step (`QUOTE_EXPIRED` offers a re-quote). Field errors appear on the field. The request id is shown for support.                                           |
| Where are the accessibility choices?                         | Labelled controls, text plus icon for status, contrast-checked tokens, focus moved to the content after navigation, a skip link, a focus-trapping dialog that returns focus, and axe on every screen in a real browser.    |
| How do you handle an unknown value?                          | `null` renders as Unknown. Totals of open quotes count unknown contributions separately, and an empty import cell is stored as unknown, not zero.                                                                          |
| How do you stop two people double-submitting?                | The button is disabled while a request is pending, and the idempotency key is kept per request, so a retry replays the same result.                                                                                        |
| What is not proven?                                          | The app has not been run against a live API or Cognito. The experiment log, ledger and stages are not stored server-side. Everything uses synthetic data, so it shows process, not demand.                                 |
