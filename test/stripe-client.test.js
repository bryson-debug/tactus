const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAccounts } = require('../lib/stripe-client');

test('parseAccounts: parses a comma-separated Label:key list', () => {
  process.env.STRIPE_ACCOUNTS = 'Main Store:rk_live_aaa, Second Store:rk_live_bbb ,Third Store:rk_live_ccc';
  try {
    assert.deepEqual(parseAccounts(), [
      { label: 'Main Store', key: 'rk_live_aaa' },
      { label: 'Second Store', key: 'rk_live_bbb' },
      { label: 'Third Store', key: 'rk_live_ccc' },
    ]);
  } finally {
    delete process.env.STRIPE_ACCOUNTS;
  }
});

test('parseAccounts: throws when STRIPE_ACCOUNTS is not configured', () => {
  delete process.env.STRIPE_ACCOUNTS;
  assert.throws(() => parseAccounts(), /STRIPE_ACCOUNTS is not configured/);
});

test('parseAccounts: throws on an entry missing the label:key separator', () => {
  process.env.STRIPE_ACCOUNTS = 'rk_live_no_label_here';
  try {
    assert.throws(() => parseAccounts(), /missing a "label:key" separator/);
  } finally {
    delete process.env.STRIPE_ACCOUNTS;
  }
});

test('parseAccounts: throws on an entry with an empty label or key', () => {
  process.env.STRIPE_ACCOUNTS = ':rk_live_aaa';
  try {
    assert.throws(() => parseAccounts(), /empty label or key/);
  } finally {
    delete process.env.STRIPE_ACCOUNTS;
  }
});
