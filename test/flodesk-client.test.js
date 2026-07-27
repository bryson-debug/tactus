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

test('getSubscriberGrowth: paginates through every page and counts subscribers created in range', async () => {
  const pages = [
    {
      meta: { total_pages: 2 },
      data: [
        { id: '1', created_at: '2026-07-10T00:00:00.000Z' }, // in range
        { id: '2', created_at: '2020-01-01T00:00:00.000Z' }, // not in range
      ],
    },
    {
      meta: { total_pages: 2 },
      data: [{ id: '3', created_at: '2026-07-20T00:00:00.000Z' }], // in range
    },
  ];
  const activeSnapshot = { meta: { total_items: 42 } };

  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async (url) => {
    call += 1;
    const body = url.includes('status=active') ? activeSnapshot : pages[call - 1] || pages[pages.length - 1];
    return { ok: true, json: async () => body };
  };

  try {
    const result = await getSubscriberGrowth({ startDate: '2026-07-01', endDate: '2026-08-01' });
    assert.equal(result.newSubscriberCount, 2);
    assert.equal(result.currentActiveSubscribers, 42);
    assert.equal(result.truncated, false);
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
