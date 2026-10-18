# @c32/web

React single-page application for the Group Stay Quote Builder (Track 2).

## Run

```
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest, React Testing Library, axe
npm run build      # type-check and production build
```

## Work package T2-01: design system, app shell, routing

- `src/index.css`: design tokens (colour, radius, type) as Tailwind theme variables.
- `src/components/`: accessible building blocks (Button, fields, Badge, Alert, Card, Dialog, DataTable, EmptyState, ContributionMeter, Unknown).
- `src/app/`: router, app shell with skip link and focus management, placeholder screens for every route in the blueprint.
- `src/features/design-system/`: the gallery page at `/design-system`.
- `src/lib/format.ts`: INR and IST formatters. A null value is always shown as `Unknown`, never as 0 or blank.

## Work package T2-02: API client, mocks and sign-in

- `src/lib/api/`: typed client for every route in the contract. Responses are checked against the `@c32/core` schemas, errors become `ApiError` with a stable code, and every mutating call needs an `Idempotency-Key`.
- `src/lib/api/errors.ts`: maps each error code to a plain-language message and next step (for example `QUOTE_EXPIRED` offers a re-quote).
- `src/mocks/`: MSW handlers that follow the contract (paths, roles, status codes, problem+json, idempotency, holds, expiry, four-eyes approval). Seed data follows the case fixture. The evaluator in `evaluate.ts` calls the real rules engine in `@c32/core`.
- `src/features/auth/`: mock sign-in (pick a name and a role), route guard and role-based menu. The shape is kept so the Cognito hosted UI can replace it.
- `@c32/core` is imported from its source through an alias, so no build step is needed first.

Mock mode is the default for `npm run dev`. Set `VITE_API_MODE=api` and `VITE_API_BASE_URL` (see `.env.example`) to use a real API.

## Work package T2-03: Quote Builder wizard

- `/quotes/new` is a four-step wizard: group and dates, rooms and type, pricing and inclusions, review and issue.
- Validation uses the same Zod schema as the server (`QuoteRequest` from `@c32/core`), so the two cannot drift. Messages are plain language.
- A live contribution meter with a labelled floor marker sits beside the form. When only the rate changes it updates at once using the shared `price()` function and the server's last cost per room-night, marked as an estimate until the server confirms. Anything else waits for the server.
- The review step shows the decision, reasons, partial-offer card, floor-safe alternatives (for example "Use rate 1800"), totals, the arithmetic trail and the hold expiry in IST.
- Each step helps as it is filled in: the check-out date under Nights, the rooms free on every night of the stay (and when a request becomes a partial offer), the full price and the Sales limit beside the discount with the price it gives, and one-click common inclusions (breakfast, lunch, dinner, parking).
- Next with problems lists them above the form, focused, each linked to its field. Finished steps can be opened again from the stepper; the last step repeats the details with an Edit link per part, and says why Issue is unavailable when it is. Start over clears the form and the draft after a confirm.
- Issuing is never optimistic and carries one idempotency key per request, so a double click replays the same quote.
- Unknown values show as `Unknown`, never zero.

## Work package T2-04: Quote Detail and Dashboard

- `/quotes/:id` shows the saved result, the arithmetic trail, a hold countdown that turns amber under 6 hours and red under 1 hour (IST with the exact UTC on hover), the request summary with a short copyable reference, any approval, and the audit timeline. The back link returns to the screen the quote was opened from.
- Actions follow role and status: Confirm (after a dialog that repeats the terms and total), Extend validity (quick choices and the new expiry shown before saving), Reduce rooms on a confirmed booking, Cancel, and Re-quote for Sales and Owner; read-only for Viewer; the quotation PDF and a copyable summary for everyone. Each action waits for the server, uses one idempotency key per request, confirms success in a message, and shows a plain-language message with a next step if the server refuses (for example a lapsed hold offers a re-quote).
- Re-quote opens the builder with the quote's details filled in (or at a suggested floor-safe rate). A quote that still holds rooms is cancelled first, after a confirm, so the new quote can hold the same rooms.
- `/` shows the pipeline by status, contribution at risk on open quotes (unknown contributions are counted separately and never added as zero), holds expiring in 24 hours, and recent quotes, with an empty state that guides a new user.
- Approve and reject are part of the review queue (T2-05); a pending-review quote tells Sales that an Owner must approve it, and gives an Owner a link to review it.

## Work package T2-05: Review queue and approval

- `/review` (Owner only) lists quotes in `PENDING_REVIEW` with their reason chips, contribution and hold countdown, most urgent first. Choosing one opens its terms next to each floor-safe alternative, the totals and the arithmetic trail.
- Approve and Reject each open a dialog with a required reason (at least 5 characters, recorded in the audit trail). Approval is tied to the exact terms; its reference is shown.
- Self-approval is blocked in the screen with an explanation (four-eyes rule). Rejecting your own quote is still allowed. The server enforces the same rule.
- An unknown contribution is called out and never treated as zero. A server refusal is explained inside the dialog and what was typed is kept.
- A pending quote shows an Owner a link straight to its place in the queue.

## Work package T2-06: Availability calendar and Policy

- `/availability` shows a night-by-night heatmap for a room type and date range. Each night shows available, held and confirmed rooms as numbers and a segmented bar (colour is never the only signal). A night with unknown availability shows `Unknown`, never zero, and nights without inventory show `Not on sale`. Choosing a night lists the quotes holding it, with links.
- `/policy` (Owner only) edits the floor mode and amounts, validity, stay cutoff, minimum validity, minimum partial rooms, default guests per room and time zone. It uses the same schema as the server, keeps a blank guests value as unknown (never 1), and saves with a version check: if someone else saved first you are told, and can load the latest version.
- The API has no policy history yet, so the screen lists only the changes saved during the current visit and says so.
- The mock API now runs the real rules engine from `@c32/core` (decisions, reasons, counter-offers and the validity window) instead of a stand-in, so screens are tested against real engine output. Only storage, holds and the terms hash are mocked.

## Work package T2-07: Imports and exports

- `/imports` lets an Owner import inventory or rates from a CSV or JSON file: choose a file, see it as it will be read (an empty cell shows as `Unknown`, never zero), run a dry-run check, read the row-by-row problems (errors and warnings with row numbers), then confirm the import. Rows with errors are skipped and listed, and only a file that cannot be read is refused whole (this matches the real API). Importing the same content again reports "Nothing changed".
- A template download shows the expected columns. Sales and Viewers see the export section only.
- Exports: a short-lived download link for quotes (CSV or JSON) and for the evidence bundle. Unknown values are empty cells in the CSV.
- The upload goes straight to the presigned URL the API returns. In mock mode the mock server stands in for that URL, parses the file, applies a commit to its in-memory data, and serves downloads. The evidence download is an empty archive until the real bundle exists.
- `src/lib/csv.ts` is a small CSV reader and writer; `src/lib/imports.ts` holds the column lists and file reading used by both the preview and the mock.

## Work package T2-08: Evidence page and Experiment log

- `/evidence` shows the three saved stages (baseline v0, negotiated scope, final v1) side by side with a table of what each covers, the evidence ledger with every claim tagged by type and source, and a download link for the evidence bundle. A stage stays "Awaiting files from Track 4" until its files exist.
- The ledger rows are the blueprint's starting ledger. Claims tagged Derived (E01 and E02) are recomputed in the browser from the case fixture using the shared pricing function, and shown with whether they match.
- "Run the public checks" previews the three public checks from `data/fixtures/fixture.json` against the connected API (mock or real). They are previews, so nothing is held or saved. The result can be downloaded as JSON.
- `/experiments` is the growth experiment log: role played, channel, send and response times in IST, the quote and version, what was said, and the tier reached. No response is shown as "No response yet", never as zero. Only people who agreed to play a role are logged, and the page says that role-play is process evidence, not market demand.
- The API has no experiment route yet, so the log is kept in this browser only (`src/features/experiments/store.ts`) with a CSV export to commit as evidence. A server-backed store can replace it without changing the screen.

## Work package T2-09: End-to-end tests and accessibility

- `npm run e2e` runs Playwright in a real Chromium against the app and its built-in mock API (the dev server starts by itself). Run `npm run e2e:install` once to download the browser. Set `E2E_BASE_URL` to run the same tests against a deployed environment.
- `e2e/rubric.e2e.ts`: the three rubric flows end to end (fixture offered and confirmed, shortage as a partial offer with no over-hold, below the floor needing review, four-eyes approval, then confirmation by a different person).
- `e2e/access.e2e.ts`: axe (WCAG 2.1 A and AA, real colour contrast) on every screen with real content on it, dialogs included; the skip link, keyboard submit, dialog focus trap and Escape, tab titles, and role limits.
- `e2e/responsive.e2e.ts`: every screen fits a phone-sized viewport without sideways scrolling, and the main controls are easy to touch.
- The mock API keeps its data in memory, so the tests load the app once and move around with the menu. The browser clock is pinned so the November 2026 case dates stay in the future.
- Fixes found by running the app in a browser: sign-out now starts the next person at the dashboard, the dashboard and calendar refresh as soon as a quote is issued or changed, each availability night is named by its visible text, and every screen sets its tab title.

## Run against the real API

Track 1's API runs locally (from the repo root; Docker is needed for DynamoDB Local):

```
npm run db:up -w @c32/api       # DynamoDB Local on port 8100
npm run seed -w @c32/api        # create the table and load the case fixture
npm run dev -w @c32/api         # API on http://localhost:3000
```

Then point the web app at it with a `.env.local` file in `apps/web`:

```
VITE_API_MODE=api
VITE_API_BASE_URL=http://localhost:3000
VITE_AUTH_MODE=dev
```

and run `npm run dev` here. `VITE_AUTH_MODE=dev` sends the `x-dev-user: <name>:<Role>` header the local API accepts, using the name and role chosen on the sign-in page. Without it the app sends a bearer token, which is what the deployed API expects from Cognito.

Differences to expect from the mock: the real API seeds only the two fixture nights (10 standard rooms on 1 and 2 Nov 2026), uses the real clock, and rejects import files over 2 MB (the import screen says so before uploading). The upload link points at the API's local file store, which stands in for S3.

A smoke test for this setup is in `e2e/real-api.e2e.ts`. It is skipped unless you ask for it, and it only uses previews, so it can be repeated without using up rooms:

```
E2E_REAL_API=1 E2E_BASE_URL=http://localhost:5173 npx playwright test e2e/real-api.e2e.ts
```

Status: run live on 17 Oct 2026 against the local API with DynamoDB Local (Docker). The smoke test, the three rubric flows (one at a time, each on a freshly seeded database) and `e2e/real-api-actions.e2e.ts` (policy save, file import through the API's upload link, quote and evidence downloads, extend, cancel) all pass. Cognito is still untested, because it needs Track 3's user pool.

To run the data-changing tests, reset the database first, since they use up rooms:

```
docker rm -f c32-dynamodb; npm run db:up -w @c32/api; npm run seed -w @c32/api
E2E_REAL_API_ACTIONS=1 E2E_BASE_URL=http://localhost:5175 npx playwright test e2e/real-api-actions.e2e.ts
```

Start the API with `CORS_ORIGINS=<the web origin>` if the web app is not on port 5173, and keep `.env.local` out of the picture for unit tests (they ignore it).

## Rules the components enforce

- Status is shown with text and an icon as well as colour.
- Unknown (null) is labelled `Unknown`; it is never rendered as zero.
- Buttons default to `type="button"` and can be put into a busy state, so confirm actions wait for the server.
- Every text and background colour pair is checked against WCAG 2.1 AA in `src/lib/contrast.test.ts`.
- Focus is visible, the first tab stop is a skip link, and focus moves to the main content after navigation.

## Landing page

- A signed-out visitor at `/` sees a landing page that explains what the product is for; every other address, and the return from the Cognito hosted sign-in (`?code=` or `?error=`), goes through the normal sign-in check. Signed-in people go straight to the dashboard.
- It is interactive and uses the project's own engine, so the numbers are true: a hero quote card with counting figures, a four-step tour (pause and step controls), a quote calculator (rooms, nights, rate and an unknown breakfast cost, with presets, the minimum safe rate and the arithmetic trail), a hold clock (issue, fast-forward, confirm or let the rooms be released), a features grid, role tabs and proof figures from the fixture.
- Motion is decoration only: for visitors who asked for less motion nothing animates, the tour does not auto-play and every section is visible at once. It adds no dependency (plain CSS, `IntersectionObserver` and inline icons) and loads nothing from a third party.
- Code is in `src/features/landing/`, and `src/app/RequireAuthOrLanding.tsx` decides who sees it. Tests: `Landing.test.tsx` (including axe) and `e2e/landing.e2e.ts` (axe with real contrast in Chromium, each tour step, reduced motion).

## Evidence, handoff and CI

- `npm run screenshots` takes the 20 UI screenshots Track 4 uses as evidence and saves them to `docs/ui/screenshots/`. Retake them after any UI change.
- `docs/architecture/track2-handoff.md` covers what Track 3 needs to deploy the app, what Track 4 can use as evidence, and the viva questions.
- Track 2's design decisions are D-056 to D-066 in `docs/architecture/decisions.md`.
- `.github/workflows/web.yml` runs the type check, unit tests, build and end-to-end tests on every push that touches `apps/web` or `packages/core`. It is separate from `ci.yml`, so it does not need the DynamoDB container.

## Still open

All Track 2 work packages are built. What is left depends on other tracks: Cognito sign-in once Track 3 provides the user pool, and server storage for the evidence and experiment data if Track 1 adds routes for them.
