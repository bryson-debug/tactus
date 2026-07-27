const {
  logUnsubscribeEvent,
  countUnsubscribeEvents,
  getEarliestTrackedEventTime,
} = require('./flodesk-webhook-store');

const API_BASE = 'https://api.flodesk.com/v1';
const PER_PAGE = 100;
// Flodesk's "List all subscribers" endpoint has no created_at date-range
// filter and no documented sort order, so computing period-scoped growth
// means walking every page and filtering client-side. This caps how many
// pages we'll walk (200 * 100 = 20,000 subscribers) so an unexpectedly
// large list can't run past Vercel's function time limit -- see README for
// what happens if a real list exceeds this.
const MAX_PAGES = 200;

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

// Filters a page of subscriber records down to those whose created_at falls
// within [startBoundary, endBoundary). Exported for unit testing without
// needing to mock fetch.
function filterCreatedInRange(subscribers, startBoundary, endBoundary) {
  return subscribers.filter((subscriber) => {
    const createdAt = new Date(subscriber.created_at).getTime();
    return createdAt >= startBoundary.getTime() && createdAt < endBoundary.getTime();
  });
}

async function getSubscriberGrowth({ startDate, endDate }) {
  const startBoundary = new Date(`${startDate}T00:00:00.000Z`);
  const endBoundary = new Date(`${endDate}T00:00:00.000Z`);

  let newSubscriberCount = 0;
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const resp = await flodeskFetch(`/subscribers?page=${page}&per_page=${PER_PAGE}`);
    newSubscriberCount += filterCreatedInRange(resp.data || [], startBoundary, endBoundary).length;
    totalPages = resp.meta?.total_pages || 1;
    page += 1;
  }

  const truncated = totalPages > MAX_PAGES;

  // Cheap, single-request current snapshot for context alongside the
  // period-scoped growth figure -- meta.total_items on a 1-per-page request
  // gives the account-wide total without paginating through everyone.
  const activeSnapshot = await flodeskFetch(`/subscribers?status=active&page=1&per_page=1`);

  return {
    newSubscriberCount,
    currentActiveSubscribers: activeSnapshot.meta?.total_items ?? null,
    truncated,
  };
}

async function getSubscriberChurn({ startDate, endDate }) {
  const [unsubscribedCount, trackedSince] = await Promise.all([
    countUnsubscribeEvents({ startDate, endDate }),
    getEarliestTrackedEventTime(),
  ]);

  // Only meaningful if we were already logging unsubscribe events before
  // this period started -- otherwise some (or all) of the real churn in
  // this window happened before the webhook was registered and was never
  // captured, so the count would understate reality without saying so.
  const periodFullyTracked = Boolean(trackedSince) && new Date(trackedSince) <= new Date(`${startDate}T00:00:00.000Z`);

  return { unsubscribedCount, trackedSince, periodFullyTracked };
}

async function registerUnsubscribeWebhook({ postUrl }) {
  return flodeskFetch('/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Tactus churn tracking',
      post_url: postUrl,
      events: ['subscriber.unsubscribed'],
    }),
  });
}

async function recordUnsubscribeWebhookEvent(payload) {
  if (payload?.event_name !== 'subscriber.unsubscribed') {
    return;
  }
  await logUnsubscribeEvent({
    subscriberId: payload.subscriber?.id || null,
    email: payload.subscriber?.email || null,
    eventTime: payload.event_time,
  });
}

module.exports = {
  getSubscriberGrowth,
  getSubscriberChurn,
  registerUnsubscribeWebhook,
  recordUnsubscribeWebhookEvent,
  filterCreatedInRange,
};
