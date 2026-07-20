const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeToMonthlyCents } = require('../lib/stripe-client');
const { matchesEdge } = require('../lib/paypal-client');

test('normalizeToMonthlyCents: monthly price passes through unchanged', () => {
  const cents = normalizeToMonthlyCents(2000, 1, { interval: 'month', interval_count: 1 });
  assert.equal(cents, 2000);
});

test('normalizeToMonthlyCents: annual price divides by 12', () => {
  const cents = normalizeToMonthlyCents(24000, 1, { interval: 'year', interval_count: 1 });
  assert.equal(cents, 2000);
});

test('normalizeToMonthlyCents: multiplies by quantity', () => {
  const cents = normalizeToMonthlyCents(1000, 3, { interval: 'month', interval_count: 1 });
  assert.equal(cents, 3000);
});

test('normalizeToMonthlyCents: honors interval_count (e.g. every 3 months)', () => {
  const cents = normalizeToMonthlyCents(3000, 1, { interval: 'month', interval_count: 3 });
  assert.equal(cents, 1000);
});

test('matchesEdge: matches on transaction_subject case-insensitively', () => {
  const txn = { transaction_info: { transaction_subject: 'EDGE Membership renewal' } };
  assert.equal(matchesEdge(txn, 'edge'), true);
});

test('matchesEdge: matches on transaction_note when subject is absent', () => {
  const txn = { transaction_info: { transaction_note: 'Payment for Edge Plan' } };
  assert.equal(matchesEdge(txn, 'EDGE'), true);
});

test('matchesEdge: returns false when nothing matches', () => {
  const txn = { transaction_info: { transaction_subject: 'Some other product' } };
  assert.equal(matchesEdge(txn, 'EDGE'), false);
});

test('matchesEdge: returns false when transaction_info fields are absent', () => {
  assert.equal(matchesEdge({ transaction_info: {} }, 'EDGE'), false);
});
