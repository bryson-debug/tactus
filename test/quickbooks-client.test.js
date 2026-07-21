const { test } = require('node:test');
const assert = require('node:assert/strict');

// Swap in a fake token store BEFORE requiring quickbooks-client, since it
// requires('./quickbooks-token-store') at load time -- Node's require cache
// is keyed by resolved absolute path, so pre-seeding the cache here makes
// quickbooks-client pick up the fake instead of the real Supabase-backed one.
const tokenStorePath = require.resolve('../lib/quickbooks-token-store');
let savedTokens = null;
const fakeTokenStore = {
  getTokens: async () => ({
    access_token: 'stale-access-token',
    refresh_token: 'refresh-token-1',
    realm_id: 'realm-123',
    // Already expired, so getValidAccessToken() must refresh.
    expires_at: new Date(Date.now() - 1000).toISOString(),
  }),
  saveTokens: async (tokens) => {
    savedTokens = tokens;
  },
};
require.cache[tokenStorePath] = {
  id: tokenStorePath,
  filename: tokenStorePath,
  loaded: true,
  exports: fakeTokenStore,
};

process.env.QBO_CLIENT_ID = 'test-client-id';
process.env.QBO_CLIENT_SECRET = 'test-client-secret';

const { getValidAccessToken } = require('../lib/quickbooks-client');

test('getValidAccessToken: concurrent callers share one in-flight refresh instead of racing', async () => {
  let tokenRequestCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    tokenRequestCount += 1;
    return {
      ok: true,
      json: async () => ({
        access_token: `fresh-access-token-${tokenRequestCount}`,
        refresh_token: `refresh-token-${tokenRequestCount + 1}`,
        expires_in: 3600,
      }),
    };
  };

  try {
    // Simulate lib/metrics.js's Promise.all firing the P&L and
    // payments-received requests at the same time -- both need a token
    // refresh since the fake store's stored token is already expired.
    const [first, second] = await Promise.all([getValidAccessToken(), getValidAccessToken()]);

    assert.equal(tokenRequestCount, 1, 'expected exactly one token refresh request, not one per concurrent caller');
    assert.equal(first.accessToken, second.accessToken);
    assert.equal(first.realmId, 'realm-123');
    assert.equal(savedTokens.refreshToken, 'refresh-token-2');
  } finally {
    global.fetch = originalFetch;
  }
});
