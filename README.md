# Tactus

Internal financial + activity dashboard for Tarbet Education Network. Phase 1
combines **Stripe** and **PayPal** (revenue, plus MRR for the EDGE
subscription), **QuickBooks Online** (P&L / cash flow, plus payments
received -- revenue collected outside Stripe/PayPal, e.g. check or bank
transfer) into one view. Meta Business Suite, Flodesk, and Vimeo are
deferred to Phase 2. A Slack digest is deferred but the data layer
(`lib/metrics.js`) is built so adding it later is additive, not a rewrite.

ThriveCart was evaluated and dropped as a data source: it has no API to
list/query historical orders (only single-customer lookups and a product
catalog), so it would have required accumulating sales via webhook with no
historical backfill. Stripe and PayPal are the actual payment processors
underneath ThriveCart's checkout, so pulling from them directly is more
reliable and gives full historical data for free.

## Architecture

```
Browser (behind the app-level password gate -- see "Access control" below)
      │  GET /api/metrics/summary?period=this_month
      ▼
api/metrics/summary.js
      │
      ▼
lib/metrics.js  ← the reusable seam. Pure function, no HTTP concerns.
      │            A future api/digest/send.js calls this same function.
      ├─ lib/stripe-client.js   (revenue + exact EDGE MRR)
      ├─ lib/paypal-client.js   (revenue + approximate EDGE MRR)
      ├─ lib/quickbooks-client.js (+ lib/quickbooks-token-store.js → Supabase)
      └─ lib/cashflow-sheet-client.js (Google Sheets API, service account)
```

Each source is fetched independently (`Promise.all` + per-source try/catch in
`lib/metrics.js`) — one source failing (e.g. QuickBooks not yet connected)
never breaks the others.

## Time periods

`today`, `this_month`, `last_month`, `this_quarter`, `year_to_date`, and
`custom` (explicit `start`/`end` query params, `YYYY-MM-DD`). All non-custom
periods refetch automatically when selected; custom waits for an explicit
**Apply** click once both dates are filled in, so it doesn't fire a request
on every keystroke. The response's `range.endDate` always reflects the
inclusive end date actually covered (for `custom` that's exactly what was
typed in, not the exclusive day-after boundary used internally for the
underlying date-range API calls).

## QuickBooks payments received

Included in combined revenue as money collected outside Stripe/PayPal (e.g.
check, bank transfer) -- confirmed with the team that these don't overlap
with what Stripe/PayPal already report, so summing them in is safe rather
than double-counting.

Queries QuickBooks's `Payment` entity directly (`getPaymentsReceivedSummary`
in `lib/quickbooks-client.js`), filtered by `Payment.TxnDate` -- the actual
date the money was received, confirmed against Intuit's Payment entity
docs. An earlier version of this inferred "paid" from `Invoice.Balance = 0`
filtered by the invoice's *own* date, which meant an invoice dated in one
period but paid in a later one showed up in the wrong period. Querying
`Payment` directly is both more accurate and simpler -- a Payment record
only exists once money has actually come in, so there's no extra "is it
paid" filter to apply the way Invoice needed.

## Cash flow projector

Shows the team's existing "Revenue Projections" Google Sheet (a manually
maintained 14-month pacing model: income line items, expenses, net profit,
and a running cash-on-hand balance) in a table below the main dashboard
cards.

This is deliberately **shown as-is, not blended** with live Stripe/PayPal/
QuickBooks/MRR data — the sheet is the team's own forward-looking model, and
silently overwriting its numbers with live figures would make it stop
reflecting what was actually planned. Instead, a comparison line under the
table shows the live combined revenue and MRR for the dashboard's *currently
selected period* side by side, so you can eyeball actuals vs. the sheet's
projection for the matching month yourself. The sheet section itself isn't
period-scoped — it always shows its own full 14-month range regardless of
the date-range picker above it.

Each month column that the sheet's own "Updated to Actual" row marks `TRUE`
gets an "actual" badge, distinguishing months the team has already
reconciled from ones that are still projected pacing.

**Setup:**
1. Create (or reuse) a Google Cloud service account and download its JSON
   key.
2. Share the "Revenue Projections" sheet with that service account's email
   address (looks like `...@...iam.gserviceaccount.com`) as a **Viewer**.
3. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and
   `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (the key JSON's `private_key` field)
   in the environment. `CASHFLOW_SHEET_ID` is optional — it defaults to the
   sheet already wired in.

**Parsing risk:** `lib/cashflow-sheet-client.js` finds the header row by
scanning for a month name, then finds each data row by matching its label
text exactly (`Total Income`, `Total Expenses`, `Net Profit`,
`Cash On Hand`, `Updated to Actual`) — not fixed row/column positions, the
same defensive approach `lib/quickbooks-client.js` uses for QuickBooks's P&L
report tree, so reordering or inserting rows in the sheet won't break it.
This label matching was validated against a text preview of the real sheet
and against a synthetic test fixture (`test/cashflow-sheet-client.test.js`),
but **not yet against a live call to the real Sheets API** — if the card
shows "Cash flow sheet is missing an expected row," the row labels in the
live sheet don't exactly match the ones above and `lib/cashflow-sheet-client.js`
will need a small adjustment.

## Theming

Light mode (white surfaces, brand teal `#12a99f` as the accent) is the
default. A manual dark mode toggle persists to `localStorage` and overrides
the OS preference once set. Raw brand teal fails WCAG contrast on white
(2.92:1) — `--brand-teal-strong` (`#0c7a73`, a darkened step of the same
hue, 5.19:1) is used anywhere text/button contrast matters in light mode;
in dark mode the raw hue clears contrast directly, so no separate step is
needed there. See the comment at the top of `dashboard-src/src/App.css` for
the full rationale.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in credentials (see below).
3. `npm run dev` (runs `vercel dev`).
4. `npm test` runs the pure-logic unit tests (period math, QuickBooks report
   parsing, Stripe multi-account parsing, MRR normalization, PayPal text
   matching, cash flow sheet parsing) — no network calls, no credentials
   required.

## Credentials & one-time setup

- [ ] **Dashboard password** — `DASHBOARD_PASSWORD`. Required: without it,
      every API route (where the actual financial data lives) 401s. See
      "Access control" below for why this exists instead of relying on
      Vercel's own protection.
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
- [ ] **Google service account** — for the cash flow projector (see "Cash
      flow projector" above). Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` /
      `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, and share the "Revenue
      Projections" sheet with that service account's email as a Viewer.

## Access control

Vercel's own Deployment Protection was the first thing tried here, but on
the **Hobby plan its "Standard Protection" mode explicitly excludes
production custom domains** — it only protects preview/deployment-hash
URLs. Locking down the actual production URL requires "All Deployments"
protection, which needs a paid Pro plan.

Instead, `lib/dashboard-auth.js` implements a simple app-level password gate:
every API route that returns real data (`api/metrics/summary.js`,
`api/quickbooks/oauth-start.js`) checks for a session cookie matching
`DASHBOARD_PASSWORD` and 401s otherwise. `api/login.js` serves a bare
password form and sets that cookie on success. The static frontend shell
itself isn't gated (it has no data embedded in it), so an unauthenticated
visitor sees the page but every card fails to load until they sign in —
the dashboard UI detects a 401 and shows a "Sign in" link instead of raw
errors.

This is a deliberate simplification: the session cookie is just the
password itself (httpOnly + Secure + SameSite=Lax), not a signed/opaque
token. Fine for a 2-person internal tool; if the team grows or the threat
model changes, this is the first thing to harden (or revisit upgrading to
Vercel Pro for "All Deployments" protection instead).

## MRR for EDGE

The MRR card combines two very different calculations:

- **Stripe (exact)** — matches Stripe products either by **exact Product ID**
  (`STRIPE_EDGE_PRODUCT_IDS`, comma-separated `prod_...` IDs — use this when
  the product's name isn't a reliable match, e.g. it doesn't contain "EDGE"
  at all) or by **name** (`EDGE_PRODUCT_NAME`, defaults to `"EDGE"`, checked
  in addition to any pinned IDs). Whichever products match, it looks up
  every active recurring price under them, lists active subscriptions per
  price, and sums each item's amount normalized to monthly (an annual price
  is divided by 12, etc.). Because a *product* is matched rather than a
  fixed price, a new price added under that same product later (a price
  change, a new annual option) is picked up automatically on the next
  dashboard load — no code change needed, even when pinning by ID.
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
