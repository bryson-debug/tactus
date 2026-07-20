const { createClient } = require('@supabase/supabase-js');

let client;
function getSupabaseClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are not configured');
    client = createClient(url, key);
  }
  return client;
}

module.exports = { getSupabaseClient };
