const { test } = require('node:test');
const assert = require('node:assert/strict');

// Swap in a fake webhook store BEFORE requiring flodesk-client, since it
// requires('./flodesk-webhook-store') at load time, which would otherwise
// pull in the real Supabase client. Same approach as test/quickbooks-client.test.js.
const webhookStorePath = require.resolve('../lib/flodesk-webhook-store');
let loggedEvents = [];
const earliestByType = {};
const fakeWebhookStore = {
  logSubscriberEvent: async (event) => {
    loggedEvents.push(event);
  },
  countSubscriberEvents: async ({ eventType, startDate, endDate }) =>
    loggedEvents.filter((e) => e.eventType === eventType && e.eventTime >= startDate && e.eventTime < endDate).length,
  getEarliestTrackedEventTime: async (eventType) => earliestByType[eventType] ?? null,
};
require.cache[webhookStorePath] = {
  id: webhookStorePath,
  filename: webhookStorePath,
  loaded: true,
  exports: fakeWebhookStore,
};

process.env.FLODESK_API_KEY = 'test-api-key';

const {
  getSubscriberGrowth,
  getSubscriberChurn,
  registerWebhooks,
  recordSubscriberWebhookEvent,
} = require('../lib/flodesk-client');

function resetStore() {
  loggedEvents = [];
  delete earliestByType.created;
  delete earliestByType.unsubscribed;
}

function mockActiveSnapshotFetch(activeTotal = 42) {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ meta: { total_items: activeTotal } }) });
  return originalFetch;
}

test('getSubscriberGrowth: counts logged "created" events within the period when fully tracked', async () => {
  resetStore();
  loggedEvents.push(
    { eventType: 'created', eventTime: '2026-07-05T00:00:00.000Z' },
    { eventType: 'created', eventTime: '2026-07-20T00:00:00.000Z' },
    { eventType: 'created', eventTime: '2026-06-01T00:00:00.000Z' }, // outside period
    { eventType: 'unsubscribed', eventTime: '2026-07-10T00:00:00.000Z' } // wrong type
  );
  earliestByType.created = '2026-06-15T00:00:00.000Z';

  const originalFetch = mockActiveSnapshotFetch(99);
  try {
    const result = await getSubscriberGrowth({ startDate: '2026-07-01', endDate: '2026-08-01' });
    assert.equal(result.newSubscriberCount, 2);
    assert.equal(result.periodFullyTracked, true);
    assert.equal(result.currentActiveSubscribers, 99);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getSubscriberGrowth: periodFullyTracked is false when tracking started mid-period', async () => {
  resetStore();
  earliestByType.created = '2026-07-15T00:00:00.000Z';
  const originalFetch = mockActiveSnapshotFetch();
  try {
    const result = await getSubscriberGrowth({ startDate: '2026-07-01', endDate: '2026-08-01' });
    assert.equal(result.periodFullyTracked, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getSubscriberGrowth: periodFullyTracked is false when nothing has been tracked yet', async () => {
  resetStore();
  const originalFetch = mockActiveSnapshotFetch();
  try {
    const result = await getSubscriberGrowth({ startDate: '2026-07-01', endDate: '2026-08-01' });
    assert.equal(result.periodFullyTracked, false);
    assert.equal(result.newSubscriberCount, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getSubscriberChurn: counts logged "unsubscribed" events within the period', async () => {
  resetStore();
  loggedEvents.push(
    { eventType: 'unsubscribed', eventTime: '2026-07-05T00:00:00.000Z' },
    { eventType: 'unsubscribed', eventTime: '2026-06-01T00:00:00.000Z' },
    { eventType: 'created', eventTime: '2026-07-06T00:00:00.000Z' } // wrong type
  );
  earliestByType.unsubscribed = '2026-06-15T00:00:00.000Z';

  const result = await getSubscriberChurn({ startDate: '2026-07-01', endDate: '2026-08-01' });
  assert.equal(result.unsubscribedCount, 1);
  assert.equal(result.periodFullyTracked, true);
});

test('getSubscriberChurn: growth and churn tracking are independent of each other', async () => {
  resetStore();
  earliestByType.created = '2026-06-01T00:00:00.000Z'; // growth tracked well before period
  // churn.trackedSince left unset -- should NOT borrow growth's tracked-since
  const result = await getSubscriberChurn({ startDate: '2026-07-01', endDate: '2026-08-01' });
  assert.equal(result.periodFullyTracked, false);
  assert.equal(result.trackedSince, null);
});

test('recordSubscriberWebhookEvent: logs a "created" event', async () => {
  resetStore();
  await recordSubscriberWebhookEvent({
    event_name: 'subscriber.created',
    event_time: '2026-07-10T00:00:00.000Z',
    subscriber: { id: 'sub_1', email: 'a@example.com' },
  });
  assert.deepEqual(loggedEvents, [
    { eventType: 'created', subscriberId: 'sub_1', email: 'a@example.com', eventTime: '2026-07-10T00:00:00.000Z' },
  ]);
});

test('recordSubscriberWebhookEvent: logs an "unsubscribed" event', async () => {
  resetStore();
  await recordSubscriberWebhookEvent({
    event_name: 'subscriber.unsubscribed',
    event_time: '2026-07-11T00:00:00.000Z',
    subscriber: { id: 'sub_2', email: 'b@example.com' },
  });
  assert.equal(loggedEvents.length, 1);
  assert.equal(loggedEvents[0].eventType, 'unsubscribed');
});

test('recordSubscriberWebhookEvent: ignores event types we do not track', async () => {
  resetStore();
  await recordSubscriberWebhookEvent({ event_name: 'subscriber.added_to_segment' });
  assert.equal(loggedEvents.length, 0);
});

test('registerWebhooks: creates a new webhook when none exists yet', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, method: options?.method || 'GET' });
    if (url.includes('/webhooks?')) return { ok: true, json: async () => ({ data: [] }) };
    return { ok: true, json: async () => ({ id: 'wh_new', post_url: 'https://example.com/hook' }) };
  };
  try {
    const result = await registerWebhooks({ postUrl: 'https://example.com/hook' });
    assert.equal(result.id, 'wh_new');
    const created = calls.find((c) => c.method === 'POST');
    assert.ok(created, 'expected a POST to create the webhook');
  } finally {
    global.fetch = originalFetch;
  }
});

test('registerWebhooks: updates the existing webhook instead of creating a duplicate', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, method: options?.method || 'GET' });
    if (url.includes('/webhooks?')) {
      return { ok: true, json: async () => ({ data: [{ id: 'wh_existing', post_url: 'https://example.com/hook' }] }) };
    }
    return { ok: true, json: async () => ({ id: 'wh_existing', post_url: 'https://example.com/hook' }) };
  };
  try {
    const result = await registerWebhooks({ postUrl: 'https://example.com/hook' });
    assert.equal(result.id, 'wh_existing');
    const updated = calls.find((c) => c.method === 'PUT');
    assert.ok(updated, 'expected a PUT to update the existing webhook');
    const created = calls.find((c) => c.method === 'POST');
    assert.equal(created, undefined, 'should not create a duplicate webhook');
  } finally {
    global.fetch = originalFetch;
  }
});
