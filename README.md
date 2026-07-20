# Tactus

Internal financial + activity dashboard for Tarbet Education Network. Phase 1
combines **Stripe** and **PayPal** (revenue, plus MRR for the EDGE
subscription) and **QuickBooks Online** (P&L / cash flow) into one view.
Meta Business Suite, Flodesk, and Vimeo are deferred to Phase 2. A Slack
digest is deferred but the data layer (`lib/metrics.js`) is built so adding
it later is additive, not a rewrite.

ThriveCart was evaluated and dropped as a data source: it has no API to
list/query historical orders (only single-customer lookups and a product
catalog), so it would have required accumulating sales via webhook with no
historical backfill. Stripe and PayPal are the actual payment processors
underneath ThriveCart's checkout, so pulling from them directly is more
reliable and gives full historical data for free.

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
      ├─ lib/stripe-client.js   (revenue + exact EDGE MRR)
      ├─ lib/paypal-client.js   (revenue + approximate EDGE MRR)
      └─ lib/quickbooks-client.js (+ lib/quickbooks-token-store.js → Supabase)
```

Each source is fetched independently (`Promise.all` + per-source try/catch in
`lib/metrics.js`) — one source failing (e.g. QuickBooks not yet connected)
never breaks the others.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in credentials (see below).
3. `npm run dev` (runs `vercel dev`).
4. `npm test` runs the pure-logic unit tests (period math, QuickBooks report
   parsing, Stripe multi-account parsing, MRR normalization, PayPal text
   matching) — no network calls, no credentials required.

## Credentials & one-time setup

- [ ] **Stripe** — `STRIPE_ACCOUNTS`, a comma-separated `Label:key` list (one
      restricted, read-only key per Stripe account). Supports 3+ accounts
      under one organization out of the box — each is fetched independently
      and summed, so one bad key doesn't break the others; the dashboard
      shows a per-account breakdown. Add a new account later by appending to
      this one env var, no code change needed. Example:
      `Main Store:rk_live_aaa,Second Store:rk_live_bbb,Third Store:rk_live_ccc`
- [ ] **PayPal** — `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` from a PayPal
      Developer app (Apps & Credentials in the PayPal Developer dashboard —
      no interactive OAuth consent needed, unlike QuickBooks, just a
      client-credentials grant). Set `PAYPAL_ENVIRONMENT` to `sandbox` while
      testing, `live` for real data.
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
- [ ] **Supabase** — used to persist QuickBooks OAuth tokens across
      serverless invocations (Intuit rotates the refresh token on every use,
      so it can't just live in an env var). Create a project, run the SQL
      files in `supabase/migrations/` in order, and set `SUPABASE_URL` /
      `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] **Vercel deployment protection** — enable it on the Vercel project
      (Project Settings → Deployment Protection) so the dashboard isn't
      publicly reachable. This may require a paid Vercel plan tier; confirm
      availability on your account.

## MRR for EDGE

The MRR card combines two very different calculations:

- **Stripe (exact)** — matches Stripe **products by name** (`EDGE_PRODUCT_NAME`
  env var, defaults to `"EDGE"`), looks up every active recurring price under
  those products, lists active subscriptions per price, and sums each item's
  amount normalized to monthly (an annual price is divided by 12, etc.).
  Because matching is by product name rather than a hardcoded price ID, a new
  price added under the same EDGE product later (a price change, a new
  annual option) is picked up automatically on the next dashboard load — no
  code change needed. If the product's actual name in Stripe isn't literally
  "EDGE", set `EDGE_PRODUCT_NAME` to match.
- **PayPal (approximate)** — PayPal's Subscriptions API has no bulk
  "list subscriptions" endpoint (confirmed against PayPal's official OpenAPI
  spec — only get-one-by-ID exists), so there's no way to sum active
  subscribers' plan prices the way Stripe allows. Instead, this sums
  EDGE-matching *successful transactions* from the trailing ~30 days as a
  stand-in for MRR. This is real billing activity, not a subscriber count,
  so it will drift from "true" MRR (won't catch a subscriber who hasn't
  billed yet this cycle, will over/undercount around failed payments). The
  dashboard labels this figure "approx." to keep the distinction visible.
  Matching is fuzzy — it checks PayPal's transaction subject/note/invoice ID
  text for the `EDGE_PRODUCT_NAME` string, since PayPal transactions don't
  carry a first-class product reference the way Stripe's do. Validate this
  against real PayPal data once connected; if EDGE isn't showing up, the
  transaction text may not contain "EDGE" and `EDGE_PRODUCT_NAME` (or the
  matching logic in `lib/paypal-client.js`) will need adjusting.

## Adding the Slack digest later

`lib/metrics.js` exports `getDashboardSummary({ period })` — a pure function
with no HTTP-layer dependencies. To add the digest:

1. Add `api/digest/send.js` that calls `getDashboardSummary(...)`, formats
   the result as a Slack message, and posts it via a Slack bot token /
   webhook.
2. Add a `crons` entry to `vercel.json` pointing at that route.

No changes to the existing data-fetching code should be needed.
