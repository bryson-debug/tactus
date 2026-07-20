const { getTokens, saveTokens } = require('./quickbooks-token-store');

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const SCOPE = 'com.intuit.quickbooks.accounting';

function apiBaseUrl() {
  return process.env.QBO_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function basicAuthHeader() {
  const id = process.env.QBO_CLIENT_ID;
  const secret = process.env.QBO_CLIENT_SECRET;
  if (!id || !secret) throw new Error('QBO_CLIENT_ID/QBO_CLIENT_SECRET are not configured');
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

function requireRedirectUri() {
  const redirectUri = process.env.QBO_REDIRECT_URI;
  if (!redirectUri) throw new Error('QBO_REDIRECT_URI is not configured');
  return redirectUri;
}

// One-time interactive setup: visit this URL, approve the Intuit consent
// screen, and oauth-callback exchanges the resulting code for tokens.
function getAuthorizeUrl(state) {
  const clientId = process.env.QBO_CLIENT_ID;
  if (!clientId) throw new Error('QBO_CLIENT_ID is not configured');
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', requireRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  return url.toString();
}

async function requestTokens(body) {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const parsed = await resp.json();
  if (!resp.ok) {
    const err = new Error(`QuickBooks token request failed: ${resp.status}`);
    err.body = parsed;
    throw err;
  }
  return parsed;
}

async function exchangeCodeForTokens({ code, realmId }) {
  const tokens = await requestTokens(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: requireRedirectUri(),
  }));
  await saveTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    realmId,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  });
}

async function refreshAccessToken(refreshToken, realmId) {
  const tokens = await requestTokens(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }));
  // Intuit rotates the refresh token on every use -- always persist the new one,
  // or the next refresh will fail with an already-consumed token.
  await saveTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    realmId,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  });
  return tokens.access_token;
}

async function getValidAccessToken() {
  const stored = await getTokens();
  if (!stored) {
    throw new Error('QuickBooks is not connected yet -- visit /api/quickbooks/oauth-start to complete setup');
  }
  const expiresAt = new Date(stored.expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) {
    return { accessToken: stored.access_token, realmId: stored.realm_id };
  }
  const accessToken = await refreshAccessToken(stored.refresh_token, stored.realm_id);
  return { accessToken, realmId: stored.realm_id };
}

async function getProfitAndLoss({ startDate, endDate }) {
  const { accessToken, realmId } = await getValidAccessToken();
  const url = new URL(`${apiBaseUrl()}/v3/company/${realmId}/reports/ProfitAndLoss`);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const body = await resp.json();
  if (!resp.ok) {
    const err = new Error(`QuickBooks ProfitAndLoss report failed: ${resp.status}`);
    err.body = body;
    throw err;
  }
  return body;
}

// QBO's report JSON is a nested Rows.Row tree; summary rows carry a `group`
// (e.g. "Income", "Expenses", "NetIncome") and their total in the last
// ColData cell. Recurses because sections can nest sub-sections.
function findGroupTotal(node, groupName) {
  const rows = node?.Rows?.Row || [];
  for (const row of rows) {
    if (row.group === groupName && row.Summary?.ColData) {
      const cols = row.Summary.ColData;
      const last = cols[cols.length - 1];
      return last ? parseFloat(last.value) || 0 : 0;
    }
    if (row.Rows) {
      const nested = findGroupTotal(row, groupName);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function extractProfitAndLossTotals(report) {
  return {
    totalIncome: findGroupTotal(report, 'Income') ?? 0,
    totalExpenses: findGroupTotal(report, 'Expenses') ?? 0,
    netIncome: findGroupTotal(report, 'NetIncome') ?? 0,
    currency: report?.Header?.Currency || 'USD',
  };
}

module.exports = {
  getAuthorizeUrl,
  exchangeCodeForTokens,
  getProfitAndLoss,
  extractProfitAndLossTotals,
};
