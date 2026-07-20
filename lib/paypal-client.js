// PayPal REST API client. Uses the OAuth2 client-credentials grant (no
// interactive consent needed, unlike QuickBooks) -- one call to
// /v1/oauth2/token with Basic auth, then bearer auth on every other call.
//
// Revenue: GET /v1/reporting/transactions (Transaction Search API) -- a
// real, documented, historical-range-capable endpoint, confirmed against
// PayPal's official API reference.
//
// MRR: PayPal's Subscriptions API has no bulk "list subscriptions" endpoint
// -- confirmed against PayPal's official OpenAPI spec, only get-one-by-ID
// exists. There's no way to sum active subscribers' plan prices the way
// Stripe allows. Instead, MRR here is APPROXIMATED as the sum of
// EDGE-matching successful transactions in the trailing ~30 days -- real
// billing activity, not a subscriber count, so it can drift from "true" MRR
// (won't catch a subscriber who hasn't billed yet this cycle, will
// over/undercount around failed payments and refunds).

function apiBaseUrl() {
  return process.env.PAYPAL_ENVIRONMENT === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

let cachedToken; // { accessToken, expiresAt }

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET are not configured');

  const resp = await fetch(`${apiBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await resp.json();
  if (!resp.ok) {
    const err = new Error(`PayPal token request failed: ${resp.status}`);
    err.body = body;
    throw err;
  }

  cachedToken = { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.accessToken;
}

async function request(path, params = {}) {
  const token = await getAccessToken();
  const url = new URL(`${apiBaseUrl()}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const body = await resp.json();
  if (!resp.ok) {
    const err = new Error(`PayPal API ${path} failed: ${resp.status}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Caps pagination so one dashboard load can't run away against a very
// high-volume account.
const MAX_PAGES = 10;

async function listTransactions({ startDate, endDate }) {
  const transactions = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await request('/v1/reporting/transactions', {
      start_date: `${startDate}T00:00:00-0000`,
      end_date: `${endDate}T23:59:59-0000`,
      fields: 'transaction_info',
      page_size: 100,
      page,
    });
    transactions.push(...(data.transaction_details || []));
    if (page >= (data.total_pages || 1)) break;
  }
  return transactions;
}

function isSuccessful(txn) {
  const status = txn.transaction_info?.transaction_status;
  return status === 'S' || status === 'COMPLETED';
}

async function getRevenueSummary({ startDate, endDate }) {
  const transactions = await listTransactions({ startDate, endDate });

  let grossCents = 0;
  let currency = null;
  let transactionCount = 0;
  for (const txn of transactions) {
    if (!isSuccessful(txn)) continue;
    const amount = txn.transaction_info?.transaction_amount;
    if (!amount) continue;
    grossCents += Math.round(parseFloat(amount.value) * 100);
    currency = currency || amount.currency_code;
    transactionCount += 1;
  }

  return { source: 'paypal', currency: (currency || 'usd').toLowerCase(), grossCents, transactionCount };
}

// PayPal has no first-class "product" on a transaction -- match against
// whatever free-text fields are available. This is inherently fuzzy; a
// mismatch here silently undercounts/overcounts rather than erroring, so
// treat PayPal MRR as directional, not exact (see module comment).
function matchesEdge(txn, matchName) {
  const haystack = [
    txn.transaction_info?.transaction_subject,
    txn.transaction_info?.transaction_note,
    txn.transaction_info?.invoice_id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(matchName.toLowerCase());
}

async function getEdgeMrrApprox({ matchName }) {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const transactions = await listTransactions({
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  });

  let mrrCents = 0;
  let currency = null;
  let transactionCount = 0;
  for (const txn of transactions) {
    if (!isSuccessful(txn) || !matchesEdge(txn, matchName)) continue;
    const amount = txn.transaction_info?.transaction_amount;
    if (!amount) continue;
    mrrCents += Math.round(parseFloat(amount.value) * 100);
    currency = currency || amount.currency_code;
    transactionCount += 1;
  }

  return {
    source: 'paypal',
    approximate: true,
    currency: (currency || 'usd').toLowerCase(),
    mrrCents,
    transactionCount,
  };
}

module.exports = { getRevenueSummary, getEdgeMrrApprox, matchesEdge };
