const { createClient } = require('@supabase/supabase-js');

let client;
function getClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are not configured');
    client = createClient(url, key);
  }
  return client;
}

// Single-row table -- there is only ever one QuickBooks company connection
// for this dashboard, so upserts always target this fixed row id.
const ROW_ID = 1;

async function getTokens() {
  const { data, error } = await getClient()
    .from('quickbooks_tokens')
    .select('access_token, refresh_token, realm_id, expires_at')
    .eq('id', ROW_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveTokens({ accessToken, refreshToken, realmId, expiresAt }) {
  const { error } = await getClient()
    .from('quickbooks_tokens')
    .upsert({
      id: ROW_ID,
      access_token: accessToken,
      refresh_token: refreshToken,
      realm_id: realmId,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

module.exports = { getTokens, saveTokens };
