const stripeClient = require('./stripe-client');
const paypalClient = require('./paypal-client');
const quickbooksClient = require('./quickbooks-client');
const { withCache } = require('./cache');

const CACHE_TTL_MS = 60_000;
const VALID_PERIODS = new Set(['today', 'this_month', 'last_month', 'this_quarter', 'year_to_date', 'custom']);

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

function parseDateOnly(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw new Error(`${label} must be a YYYY-MM-DD date`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date`);
  }
  return date;
}

function resolvePeriod(period, customRange) {
  if (!VALID_PERIODS.has(period)) {
    throw new Error(`Unknown period: ${period}`);
  }
  const now = new Date();
  let start;
  let end;

  switch (period) {
    case 'today':
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      end = now;
      break;
    case 'this_month':
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      break;
    case 'last_month':
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    case 'this_quarter': {
      const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      start = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
      end = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth + 3, 1));
      break;
    }
    case 'year_to_date':
      start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      end = now;
      break;
    case 'custom': {
      if (!customRange || !customRange.start || !customRange.end) {
        throw new Error('custom period requires start and end dates');
      }
      start = parseDateOnly(customRange.start, 'start');
      // End is inclusive of the whole day the user picked.
      end = new Date(parseDateOnly(customRange.end, 'end').getTime() + 24 * 60 * 60 * 1000);
      if (start >= end) {
        throw new Error('custom period start must be before end');
      }
      break;
    }
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
async function buildSummary({ period = 'this_month', customRange } = {}) {
  const { sinceUnix, untilUnix, startDate, endDate } = resolvePeriod(period, customRange);

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
    // Display the exact inclusive end date the user picked for a custom
    // range, not the exclusive day-after boundary resolvePeriod computed
    // internally for the actual API date-range queries above.
    range: { startDate, endDate: period === 'custom' ? customRange.end : endDate },
    generatedAt: new Date().toISOString(),
    stripe,
    paypal,
    quickbooks,
    mrr: { stripe: stripeMrr, paypal: paypalMrr },
  };
}

function getDashboardSummary(opts = {}) {
  const period = opts.period || 'this_month';
  const cacheKey =
    period === 'custom'
      ? `summary:custom:${opts.customRange?.start}:${opts.customRange?.end}`
      : `summary:${period}`;
  return withCache(cacheKey, CACHE_TTL_MS, () => buildSummary({ period, customRange: opts.customRange }));
}

module.exports = { getDashboardSummary, buildSummary, resolvePeriod };
