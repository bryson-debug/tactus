const { logSubscriberEvent, countSubscriberEvents, getEarliestTrackedEventTime } = require('./flodesk-webhook-store');

const API_BASE = 'https://api.flodesk.com/v1';
const WEBHOOK_NAME = 'Tactus subscriber tracking';
const WEBHOOK_EVENTS = ['subscriber.created', 'subscriber.unsubscribed'];

function basicAuthHeader() {
  const apiKey = process.env.FLODESK_API_KEY;
  if (!apiKey) throw new Error('FLODESK_API_KEY is not configured');
  // Flodesk's api_key auth: the key as the Basic auth username, empty password.
  return 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
}

async function flodeskFetch(path, options = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: basicAuthHeader(),
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await resp.json();
  if (!resp.ok) {
    const err = new Error(`Flodesk API request failed: ${resp.status}`);
    err.body = body;
    throw err;
  }
  return body;
}

// Both growth and churn are computed the same way, from our own webhook
// event log -- Flodesk's REST API has no created_at/date-range filter on
// its subscribers list (so growth can't be queried directly for an
// arbitrary period) and no unsubscribed_at field or historical event log
// at all. An earlier version computed growth by live-paginating the whole
// subscriber list, but that doesn't fit Vercel's 10-second function limit
// once an account has more than a few thousand subscribers -- confirmed in
// production against a real ~24k-subscriber account, not theoretical.
async function getTrackedEventStats(eventType, { startDate, endDate }) {
  const [count, trackedSince] = await Promise.all([
    countSubscriberEvents({ eventType, startDate, endDate }),
    getEarliestTrackedEventTime(eventType),
  ]);

  // Only meaningful if we were already logging this event type before the
  // period started -- otherwise some (or all) of what really happened in
  // this window predates the webhook being registered and was never
  // captured, so the count would understate reality without saying so.
  const periodFullyTracked = Boolean(trackedSince) && new Date(trackedSince) <= new Date(`${startDate}T00:00:00.000Z`);

  return { count, trackedSince, periodFullyTracked };
}

async function getSubscriberGrowth({ startDate, endDate }) {
  const [{ count, trackedSince, periodFullyTracked }, activeSnapshot] = await Promise.all([
    getTrackedEventStats('created', { startDate, endDate }),
    // Cheap, single-request current snapshot for context alongside the
    // period-scoped growth figure -- meta.total_items on a 1-per-page
    // request gives the account-wide total without paginating everyone.
    flodeskFetch(`/subscribers?status=active&page=1&per_page=1`),
  ]);

  return {
    newSubscriberCount: count,
    trackedSince,
    periodFullyTracked,
    currentActiveSubscribers: activeSnapshot.meta?.total_items ?? null,
  };
}

async function getSubscriberChurn({ startDate, endDate }) {
  const { count, trackedSince, periodFullyTracked } = await getTrackedEventStats('unsubscribed', {
    startDate,
    endDate,
  });
  return { unsubscribedCount: count, trackedSince, periodFullyTracked };
}

async function findExistingWebhook(postUrl) {
  const resp = await flodeskFetch('/webhooks?page=1&per_page=100');
  return (resp.data || []).find((webhook) => webhook.post_url === postUrl || webhook.name === WEBHOOK_NAME);
}

// Idempotent: updates the existing webhook (by post_url or name match) if
// one's already registered, rather than creating a duplicate every time
// this setup step gets re-run.
async function registerWebhooks({ postUrl }) {
  const existing = await findExistingWebhook(postUrl);
  if (existing) {
    return flodeskFetch(`/webhooks/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: WEBHOOK_NAME, post_url: postUrl, events: WEBHOOK_EVENTS }),
    });
  }
  return flodeskFetch('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ name: WEBHOOK_NAME, post_url: postUrl, events: WEBHOOK_EVENTS }),
  });
}

const EVENT_TYPE_BY_NAME = {
  'subscriber.created': 'created',
  'subscriber.unsubscribed': 'unsubscribed',
};

async function recordSubscriberWebhookEvent(payload) {
  const eventType = EVENT_TYPE_BY_NAME[payload?.event_name];
  if (!eventType) {
    return; // e.g. subscriber.added_to_segment -- not something we track
  }
  await logSubscriberEvent({
    eventType,
    subscriberId: payload.subscriber?.id || null,
    email: payload.subscriber?.email || null,
    eventTime: payload.event_time,
  });
}

module.exports = {
  getSubscriberGrowth,
  getSubscriberChurn,
  registerWebhooks,
  recordSubscriberWebhookEvent,
};
