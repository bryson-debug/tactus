const stripeClient = require('./stripe-client');
const paypalClient = require('./paypal-client');
const quickbooksClient = require('./quickbooks-client');
const { withCache } = require('./cache');

const CACHE_TTL_MS = 60_000;
const VALID_PERIODS = new Set(['this_month', 'last_30_days']);

// Product/subscription name matched against Stripe products and PayPal
// transaction text for the MRR figures -- see lib/stripe-client.js and
// lib/paypal-client.js. Override if the product's name in either system
// isn't literally "EDGE".
const EDGE_PRODUCT_NAME = process.env.EDGE_PRODUCT_NAME || 'EDGE';

// Exact Stripe Product IDs (prod_...) to treat as EDGE, in addition to name
// matching -- use this when the product's name doesn't reliably contain
// "EDGE", or to pin it precisely once you know the ID. Comma-separated,
// e.g. STRIPE_EDGE_PRODUCT_IDS=prod_ABC123,prod_XYZ789.
const STRIPE_EDGE_PRODUCT_IDS = (process.env.STRIPE_EDGE_PRODUCT_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

function resolvePeriod(period) {
  if (!VALID_PERIODS.has(period)) {
    throw new Error(`Unknown period: ${period}`);
  }
  const now = new Date();
  let start;
  let end;
  if (period === 'this_month') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  } else {
    end = now;
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return {
    sinceUnix: Math.floor(start.getTime() / 1000),
    untilUnix: Math.floor(end.getTime() / 1000),
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

async function settle(promise) {
  try {
    return { ok: true, data: await promise };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Pure aggregation logic, deliberately free of any HTTP request/response
// concerns. api/metrics/summary.js wraps this for the dashboard; a future
// api/digest/send.js will call this exact function to build the Slack
// digest -- that's the whole point of keeping it separate.
async function buildSummary({ period = 'this_month' } = {}) {
  const { sinceUnix, untilUnix, startDate, endDate } = resolvePeriod(period);

  const [stripe, paypal, quickbooks, stripeMrr, paypalMrr] = await Promise.all([
    settle(stripeClient.getRevenueSummary({ sinceUnix, untilUnix })),
    settle(paypalClient.getRevenueSummary({ startDate, endDate })),
    settle(
      quickbooksClient.getProfitAndLoss({ startDate, endDate }).then(quickbooksClient.extractProfitAndLossTotals)
    ),
    settle(stripeClient.getEdgeMrr({ matchName: EDGE_PRODUCT_NAME, productIds: STRIPE_EDGE_PRODUCT_IDS })),
    settle(paypalClient.getEdgeMrrApprox({ matchName: EDGE_PRODUCT_NAME })),
  ]);

  return {
    period,
    range: { startDate, endDate },
    generatedAt: new Date().toISOString(),
    stripe,
    paypal,
    quickbooks,
    mrr: { stripe: stripeMrr, paypal: paypalMrr },
  };
}

function getDashboardSummary(opts = {}) {
  const period = opts.period || 'this_month';
  return withCache(`summary:${period}`, CACHE_TTL_MS, () => buildSummary({ period }));
}

module.exports = { getDashboardSummary, buildSummary, resolvePeriod };
