# Tarbet Dashboard

Internal financial + activity dashboard for Tarbet Education Network. Phase 1
combines **Stripe** (revenue), **QuickBooks Online** (P&L / cash flow), and
**ThriveCart** (sales) into one view. Meta Business Suite, Flodesk, and Vimeo
are deferred to Phase 2. A Slack digest is deferred but the data layer
(`lib/metrics.js`) is built so adding it later is additive, not a rewrite.

## Architecture

```
Browser (behind Vercel deployment protection)
      │  GET /api/metrics/summary?period=this_month
      ▼
api/metrics/summary.js
      │
      ▼
lib/metrics.js  ← the reusable seam. Pure function, no HTTP concerns.
      │            A future api/digest/send.js calls this same function.
      ├─ lib/stripe-client.js
      ├─ lib/quickbooks-client.js (+ lib/quickbooks-token-store.js → Supabase)
      └─ lib/thrivecart-sales-client.js
```

Each source is fetched independently (`Promise.all` + per-source try/catch in
`lib/metrics.js`) — one source failing (e.g. QuickBooks not yet connected)
never breaks the other two.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in credentials (see below).
3. `npm run dev` (runs `vercel dev`).
4. `npm test` runs the pure-logic unit tests (period math, QuickBooks report
   parsing) — no network calls, no credentials required.

## Credentials & one-time setup

- [ ] **Stripe** — `STRIPE_SECRET_KEY`. Use a restricted, read-only key.
- [ ] **ThriveCart** — `THRIVECART_API_KEY`. **Validate before relying on
      numbers**: see the comment block at the top of
      `lib/thrivecart-sales-client.js` — ThriveCart's public API has no
      confirmed sales/order listing endpoint as of this build. The client
      calls `/api/external/orders` as a best guess; adjust it against the
      current ThriveCart API docs and a real account.
- [ ] **QuickBooks Online** — register an app at
      [Intuit Developer](https://developer.intuit.com/), set
      `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET`, set the app's redirect URI to
      `https://<your-vercel-domain>/api/quickbooks/oauth-callback` and put
      the same value in `QBO_REDIRECT_URI`. Set `QBO_ENVIRONMENT` to
      `sandbox` while testing, `production` when ready for the real company
      file. Then, once deployed, visit `/api/quickbooks/oauth-start` once as
      an admin to complete the OAuth consent flow — this stores the first
      access/refresh token pair in Supabase. Tokens auto-refresh after that;
      no further manual steps.
- [ ] **Supabase** — used only to persist QuickBooks OAuth tokens across
      serverless invocations (Intuit rotates the refresh token on every use,
      so it can't just live in an env var). Create a project, run
      `supabase/migration.sql` against it, and set `SUPABASE_URL` /
      `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] **Vercel deployment protection** — enable it on the Vercel project
      (Project Settings → Deployment Protection) so the dashboard isn't
      publicly reachable. This may require a paid Vercel plan tier; confirm
      availability on your account.

## Adding the Slack digest later

`lib/metrics.js` exports `getDashboardSummary({ period })` — a pure function
with no HTTP-layer dependencies. To add the digest:

1. Add `api/digest/send.js` that calls `getDashboardSummary(...)`, formats
   the result as a Slack message, and posts it via a Slack bot token /
   webhook.
2. Add a `crons` entry to `vercel.json` pointing at that route.

No changes to the existing data-fetching code should be needed.

## Known open item

ThriveCart sales reporting (see above) is unvalidated against ThriveCart's
current live API. Confirm the correct endpoint/response shape during setup;
until then, the ThriveCart card on the dashboard will show an error state
rather than wrong numbers if the endpoint doesn't match.
