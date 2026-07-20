// ThriveCart sales/order client.
//
// OPEN RISK (flagged in the build plan, not yet validated): the sibling
// thrivecart-learn project's client documents that ThriveCart's external API
// (thrivecart.com/api/external/*) is narrow and POST-only, with no confirmed
// listing/reporting endpoint -- only a course-access grant endpoint was ever
// confirmed working there. There is no confirmed "list orders" or "sales
// summary" endpoint in ThriveCart's public docs as of this build.
//
// This client calls the endpoint ThriveCart's docs describe for order
// listing (`/api/external/orders`) as a best-effort implementation. Validate
// this against a live account + real API key before relying on the numbers
// it returns -- if the endpoint doesn't exist or the response shape differs,
// update `request()`'s path and the summarizing loop below. metrics.js
// treats a failure here as a per-source error rather than failing the whole
// dashboard, so the rest of the dashboard keeps working either way.

const BASE_URL = process.env.THRIVECART_API_BASE_URL || 'https://thrivecart.com';

function authHeaders() {
  const apiKey = process.env.THRIVECART_API_KEY;
  if (!apiKey) throw new Error('THRIVECART_API_KEY is not configured');
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

async function request(path, options = {}) {
  const resp = await fetch(`${BASE_URL}${path}`, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const text = await resp.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!resp.ok) {
    const err = new Error(`ThriveCart API ${path} failed: ${resp.status}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function getSalesSummary({ startDate, endDate }) {
  const body = await request('/api/external/orders', {
    method: 'POST',
    body: JSON.stringify({ start_date: startDate, end_date: endDate }),
  });

  const orders = Array.isArray(body?.orders) ? body.orders : [];
  let grossCents = 0;
  let currency = null;
  for (const order of orders) {
    grossCents += Math.round((Number(order.total) || 0) * 100);
    currency = currency || order.currency;
  }

  return {
    source: 'thrivecart',
    currency: currency || 'usd',
    grossCents,
    orderCount: orders.length,
  };
}

module.exports = { getSalesSummary };
