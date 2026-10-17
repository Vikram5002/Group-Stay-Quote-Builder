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
- `src/mocks/`: MSW handlers that follow the contract (paths, roles, status codes, problem+json, idempotency, holds, expiry, four-eyes approval). Seed data follows the case fixture. The evaluator in `evaluate.ts` is a stand-in until the real rules engine is in `@c32/core`.
- `src/features/auth/`: mock sign-in (pick a name and a role), route guard and role-based menu. The shape is kept so the Cognito hosted UI can replace it.
- `@c32/core` is imported from its source through an alias, so no build step is needed first.

Mock mode is the default for `npm run dev`. Set `VITE_API_MODE=api` and `VITE_API_BASE_URL` (see `.env.example`) to use a real API.

## Work package T2-03: Quote Builder wizard

- `/quotes/new` is a four-step wizard: group and dates, rooms and type, pricing and inclusions, review and issue.
- Validation uses the same Zod schema as the server (`QuoteRequest` from `@c32/core`), so the two cannot drift. Messages are plain language.
- A live contribution meter with a labelled floor marker sits beside the form. When only the rate changes it updates at once using the shared `price()` function and the server's last cost per room-night, marked as an estimate until the server confirms. Anything else waits for the server.
- The review step shows the decision, reasons, partial-offer card, floor-safe alternatives (for example "Use rate 1800"), totals, the arithmetic trail and the hold expiry in IST.
- Issuing is never optimistic and carries one idempotency key per request, so a double click replays the same quote.
- Unknown values show as `Unknown`, never zero.

## Rules the components enforce

- Status is shown with text and an icon as well as colour.
- Unknown (null) is labelled `Unknown`; it is never rendered as zero.
- Buttons default to `type="button"` and can be put into a busy state, so confirm actions wait for the server.
- Every text and background colour pair is checked against WCAG 2.1 AA in `src/lib/contrast.test.ts`.
- Focus is visible, the first tab stop is a skip link, and focus moves to the main content after navigation.

## Not in this work package

Cognito sign-in (needs the Track 3 user pool), the remaining screens (T2-04 to T2-08).
