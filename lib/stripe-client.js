// Stripe REST client for revenue totals. Plain fetch, no SDK -- Stripe's API
// is a stable, well-documented REST surface and a bearer key is all auth
// needs, so a dependency isn't worth it.

const BASE_URL = 'https://api.stripe.com/v1';

function authHeaders() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return { Authorization: `Bearer ${key}` };
}

async function request(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url, { headers: authHeaders() });
  const body = await resp.json();
  if (!resp.ok) {
    const err = new Error(`Stripe API ${path} failed: ${resp.status}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Caps pagination so one dashboard load can't run away against a very
// high-volume account -- 20 pages * 100 = 2000 transactions per period.
const MAX_PAGES = 20;

async function getRevenueSummary({ sinceUnix, untilUnix }) {
  let netCents = 0;
  let grossCents = 0;
  let transactionCount = 0;
  let currency = null;
  let startingAfter;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await request('/balance_transactions', {
      'created[gte]': sinceUnix,
      'created[lt]': untilUnix,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const txn of data.data) {
      if (txn.type !== 'charge' && txn.type !== 'payment') continue;
      netCents += txn.net;
      grossCents += txn.amount;
      transactionCount += 1;
      currency = currency || txn.currency;
    }

    if (!data.has_more || data.data.length === 0) break;
    startingAfter = data.data[data.data.length - 1].id;
  }

  return {
    source: 'stripe',
    currency: currency || 'usd',
    grossCents,
    netCents,
    transactionCount,
  };
}

module.exports = { getRevenueSummary };
