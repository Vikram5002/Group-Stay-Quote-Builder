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

## Rules the components enforce

- Status is shown with text and an icon as well as colour.
- Unknown (null) is labelled `Unknown`; it is never rendered as zero.
- Buttons default to `type="button"` and can be put into a busy state, so confirm actions wait for the server.
- Every text and background colour pair is checked against WCAG 2.1 AA in `src/lib/contrast.test.ts`.
- Focus is visible, the first tab stop is a skip link, and focus moves to the main content after navigation.

## Not in this work package

API client, mocks and sign-in (T2-02), the quote builder (T2-03) and the remaining screens (T2-04 to T2-08).
