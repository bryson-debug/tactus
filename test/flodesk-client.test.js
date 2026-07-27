const { test } = require('node:test');
const assert = require('node:assert/strict');

// Swap in a fake webhook store BEFORE requiring flodesk-client, since it
// requires('./flodesk-webhook-store') at load time, which would otherwise
// pull in the real Supabase client. Same approach as test/quickbooks-client.test.js.
const webhookStorePath = require.resolve('../lib/flodesk-webhook-store');
const loggedEvents = [];
let fakeEarliestTrackedEventTime = null;
const fakeWebhookStore = {
  logUnsubscribeEvent: async (event) => {
    loggedEvents.push(event);
  },
  countUnsubscribeEvents: async ({ startDate, endDate }) =>
    loggedEvents.filter((e) => e.eventTime >= startDate && e.eventTime < endDate).length,
  getEarliestTrackedEventTime: async () => fakeEarliestTrackedEventTime,
};
require.cache[webhookStorePath] = {
  id: webhookStorePath,
  filename: webhookStorePath,
  loaded: true,
  exports: fakeWebhookStore,
};

process.env.FLODESK_API_KEY = 'test-api-key';

const { filterCreatedInRange, getSubscriberGrowth, getSubscriberChurn } = require('../lib/flodesk-client');

test('filterCreatedInRange: keeps subscribers created inside [start, end)', () => {
  const subscribers = [
    { id: '1', created_at: '2026-06-30T23:59:59.000Z' }, // before range
    { id: '2', created_at: '2026-07-01T00:00:00.000Z' }, // at start (inclusive)
    { id: '3', created_at: '2026-07-15T12:00:00.000Z' }, // inside range
    { id: '4', created_at: '2026-08-01T00:00:00.000Z' }, // at end (exclusive)
    { id: '5', created_at: '2026-08-02T00:00:00.000Z' }, // after range
  ];
  const result = filterCreatedInRange(
    subscribers,
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-08-01T00:00:00.000Z')
  );
  assert.deepEqual(
    result.map((s) => s.id),
    ['2', '3']
  );
});

test('filterCreatedInRange: returns empty array when nothing matches', () => {
  const subscribers = [{ id: '1', created_at: '2020-01-01T00:00:00.000Z' }];
  const result = filterCreatedInRange(subscribers, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-02-01T00:00:00.000Z'));
  assert.deepEqual(result, []);
});

// Routes by the page= query param rather than call order, since pages after
// the first are now fetched concurrently in batches (see PAGE_FETCH_CONCURRENCY
// in lib/flodesk-client.js) -- a fix for a real production timeout where
// sequential pagination didn't fit in Vercel's 10-second function limit.
function mockPaginatedSubscribers(pagesByNumber, { totalPages, activeTotal = 42 } = {}) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (url.includes('status=active')) {
      return { ok: true, json: async () => ({ meta: { total_items: activeTotal } }) };
    }
    const pageNum = Number(new URL(url).searchParams.get('page'));
    const data = pagesByNumber[pageNum] || [];
    return { ok: true, json: async () => ({ meta: { total_pages: totalPages }, data }) };
  };
  return { originalFetch, calls };
}

test('getSubscriberGrowth: paginates through every page (fetched concurrently) and counts subscribers created in range', async () => {
  const pagesByNumber = {
    1: [
      { id: '1', created_at: '2026-07-10T00:00:00.000Z' }, // in range
      { id: '2', created_at: '2020-01-01T00:00:00.000Z' }, // not in range
    ],
    2: [{ id: '3', created_at: '2026-07-20T00:00:00.000Z' }], // in range
  };
  const { originalFetch, calls } = mockPaginatedSubscribers(pagesByNumber, { totalPages: 2, activeTotal: 42 });

  try {
    const result = await getSubscriberGrowth({ startDate: '2026-07-01', endDate: '2026-08-01' });
    assert.equal(result.newSubscriberCount, 2);
    assert.equal(result.currentActiveSubscribers, 42);
    assert.equal(result.truncated, false);
    // page 1, page 2, and the active-count snapshot -- three requests total.
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getSubscriberGrowth: batches concurrent requests across more pages than the concurrency limit', async () => {
  // 12 pages total -- more than PAGE_FETCH_CONCURRENCY (10), so this only
  // passes if the batching loop correctly handles a second, smaller batch.
  const pagesByNumber = {};
  for (let page = 1; page <= 12; page += 1) {
    pagesByNumber[page] = [{ id: `p${page}`, created_at: '2026-07-15T00:00:00.000Z' }]; // all in range
  }
  const { originalFetch } = mockPaginatedSubscribers(pagesByNumber, { totalPages: 12 });

  try {
    const result = await getSubscriberGrowth({ startDate: '2026-07-01', endDate: '2026-08-01' });
    assert.equal(result.newSubscriberCount, 12);
    assert.equal(result.truncated, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getSubscriberGrowth: marks truncated and stops at MAX_PAGES when the list is very large', async () => {
  const pagesByNumber = { 1: [{ id: '1', created_at: '2026-07-15T00:00:00.000Z' }] };
  const { originalFetch } = mockPaginatedSubscribers(pagesByNumber, { totalPages: 500 });

  try {
    const result = await getSubscriberGrowth({ startDate: '2026-07-01', endDate: '2026-08-01' });
    assert.equal(result.truncated, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getSubscriberChurn: counts logged unsubscribe events within the period', async () => {
  loggedEvents.length = 0;
  loggedEvents.push({ eventTime: '2026-07-05T00:00:00.000Z' }, { eventTime: '2026-06-01T00:00:00.000Z' });
  fakeEarliestTrackedEventTime = '2026-06-15T00:00:00.000Z';

  const result = await getSubscriberChurn({ startDate: '2026-07-01', endDate: '2026-08-01' });
  assert.equal(result.unsubscribedCount, 1);
  assert.equal(result.periodFullyTracked, true);
});

test('getSubscriberChurn: periodFullyTracked is false when tracking started mid-period', async () => {
  loggedEvents.length = 0;
  fakeEarliestTrackedEventTime = '2026-07-15T00:00:00.000Z';

  const result = await getSubscriberChurn({ startDate: '2026-07-01', endDate: '2026-08-01' });
  assert.equal(result.periodFullyTracked, false);
});

test('getSubscriberChurn: periodFullyTracked is false when nothing has been tracked yet', async () => {
  loggedEvents.length = 0;
  fakeEarliestTrackedEventTime = null;

  const result = await getSubscriberChurn({ startDate: '2026-07-01', endDate: '2026-08-01' });
  assert.equal(result.periodFullyTracked, false);
  assert.equal(result.unsubscribedCount, 0);
});
