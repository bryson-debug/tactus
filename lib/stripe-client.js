// Stripe REST client for revenue totals. Plain fetch, no SDK -- Stripe's API
// is a stable, well-documented REST surface and a bearer key is all auth
// needs, so a dependency isn't worth it.
//
// Supports multiple Stripe accounts under one organization (each Stripe
// account has its own separate API key -- there's no way to read across
// accounts with a single key). Configure via STRIPE_ACCOUNTS as a
// comma-separated "Label:key" list, e.g.
//   STRIPE_ACCOUNTS=Main Store:rk_live_aaa,Second Store:rk_live_bbb
// Adding a new account later is just appending to this one env var --
// no code change needed.

const BASE_URL = 'https://api.stripe.com/v1';

function parseAccounts() {
  const raw = process.env.STRIPE_ACCOUNTS;
  if (!raw) throw new Error('STRIPE_ACCOUNTS is not configured');
  return raw.split(',').map((entry, i) => {
    const idx = entry.indexOf(':');
    if (idx === -1) {
      throw new Error(`STRIPE_ACCOUNTS entry ${i + 1} is missing a "label:key" separator: "${entry.trim()}"`);
    }
    const label = entry.slice(0, idx).trim();
    const key = entry.slice(idx + 1).trim();
    if (!label || !key) {
      throw new Error(`STRIPE_ACCOUNTS entry ${i + 1} has an empty label or key: "${entry.trim()}"`);
    }
    return { label, key };
  });
}

async function request(key, path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
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

async function getAccountRevenue(key, { sinceUnix, untilUnix }) {
  let netCents = 0;
  let grossCents = 0;
  let transactionCount = 0;
  let currency = null;
  let startingAfter;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await request(key, '/balance_transactions', {
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

  return { currency: currency || 'usd', grossCents, netCents, transactionCount };
}

// Fetches every configured account independently (Promise.allSettled) so one
// revoked/misconfigured key doesn't take down the whole Stripe card -- the
// combined totals are summed from whichever accounts succeeded, and the
// per-account breakdown (including any errors) is returned alongside for the
// UI. Assumes all accounts share a currency; a mixed-currency org would need
// per-currency totals instead of a naive sum.
async function getRevenueSummary({ sinceUnix, untilUnix }) {
  const accounts = parseAccounts();

  const settled = await Promise.allSettled(
    accounts.map((account) => getAccountRevenue(account.key, { sinceUnix, untilUnix }))
  );

  const perAccount = settled.map((result, i) =>
    result.status === 'fulfilled'
      ? { label: accounts[i].label, ok: true, data: result.value }
      : { label: accounts[i].label, ok: false, error: result.reason.message }
  );

  const succeeded = perAccount.filter((a) => a.ok);

  return {
    source: 'stripe',
    currency: succeeded[0]?.data.currency || 'usd',
    grossCents: succeeded.reduce((sum, a) => sum + a.data.grossCents, 0),
    netCents: succeeded.reduce((sum, a) => sum + a.data.netCents, 0),
    transactionCount: succeeded.reduce((sum, a) => sum + a.data.transactionCount, 0),
    accounts: perAccount,
  };
}

// MRR for a product identified by NAME (not a fixed price ID) so a new price
// added under the same product later (e.g. a price change, a new annual
// option) is picked up automatically on the next call -- nothing to update
// when pricing changes, only if the product's name changes.
async function findMatchingProductIds(key, matchName) {
  const needle = matchName.toLowerCase();
  const productIds = [];
  let startingAfter;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await request(key, '/products', {
      active: true,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const product of data.data) {
      if ((product.name || '').toLowerCase().includes(needle)) {
        productIds.push(product.id);
      }
    }
    if (!data.has_more || data.data.length === 0) break;
    startingAfter = data.data[data.data.length - 1].id;
  }

  return productIds;
}

async function listPricesForProducts(key, productIds) {
  const prices = [];
  for (const productId of productIds) {
    let startingAfter;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await request(key, '/prices', {
        product: productId,
        active: true,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      prices.push(...data.data);
      if (!data.has_more || data.data.length === 0) break;
      startingAfter = data.data[data.data.length - 1].id;
    }
  }
  return prices;
}

// Normalizes any billing interval to a monthly amount so annual/weekly/daily
// prices can be summed alongside monthly ones into a single MRR figure.
const MONTHLY_FACTOR = { day: 30.437, week: 52 / 12, month: 1, year: 1 / 12 };

function normalizeToMonthlyCents(unitAmountCents, quantity, recurring) {
  const factor = MONTHLY_FACTOR[recurring.interval] ?? 1;
  return (unitAmountCents * quantity * factor) / (recurring.interval_count || 1);
}

async function getAccountEdgeMrr(key, matchName) {
  const productIds = await findMatchingProductIds(key, matchName);
  if (productIds.length === 0) {
    return { mrrCents: 0, currency: null, activeSubscriptionCount: 0, matchedProducts: 0 };
  }

  const recurringPrices = (await listPricesForProducts(key, productIds)).filter((p) => p.recurring);

  let mrrCents = 0;
  let currency = null;
  let activeSubscriptionCount = 0;

  for (const price of recurringPrices) {
    let startingAfter;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await request(key, '/subscriptions', {
        price: price.id,
        status: 'active',
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const sub of data.data) {
        for (const item of sub.items.data) {
          if (item.price.id !== price.id) continue;
          mrrCents += normalizeToMonthlyCents(item.price.unit_amount, item.quantity, item.price.recurring);
          currency = currency || item.price.currency;
          activeSubscriptionCount += 1;
        }
      }
      if (!data.has_more || data.data.length === 0) break;
      startingAfter = data.data[data.data.length - 1].id;
    }
  }

  return { mrrCents: Math.round(mrrCents), currency: currency || 'usd', activeSubscriptionCount, matchedProducts: productIds.length };
}

// Same multi-account fan-out pattern as getRevenueSummary -- one account's
// MRR lookup failing doesn't block the others.
async function getEdgeMrr({ matchName }) {
  const accounts = parseAccounts();
  const settled = await Promise.allSettled(accounts.map((account) => getAccountEdgeMrr(account.key, matchName)));

  const perAccount = settled.map((result, i) =>
    result.status === 'fulfilled'
      ? { label: accounts[i].label, ok: true, data: result.value }
      : { label: accounts[i].label, ok: false, error: result.reason.message }
  );

  const succeeded = perAccount.filter((a) => a.ok);

  return {
    source: 'stripe',
    currency: succeeded.find((a) => a.data.currency)?.data.currency || 'usd',
    mrrCents: succeeded.reduce((sum, a) => sum + a.data.mrrCents, 0),
    activeSubscriptionCount: succeeded.reduce((sum, a) => sum + a.data.activeSubscriptionCount, 0),
    accounts: perAccount,
  };
}

module.exports = { getRevenueSummary, getEdgeMrr, parseAccounts, normalizeToMonthlyCents };
