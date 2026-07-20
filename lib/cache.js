// Short-lived in-memory cache for aggregated dashboard data, scoped per
// serverless instance (cleared on cold start). Not persisted or shared
// across instances -- fine for a 60s TTL smoothing repeat dashboard loads.
const store = new Map();

async function withCache(key, ttlMs, compute) {
  const cached = store.get(key);
  const now = Date.now();
  if (cached && now - cached.at < ttlMs) {
    return cached.value;
  }
  const value = await compute();
  store.set(key, { value, at: now });
  return value;
}

module.exports = { withCache };
