const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkPassword, isAuthenticated, COOKIE_NAME } = require('../lib/dashboard-auth');

test('checkPassword: accepts the correct password', () => {
  process.env.DASHBOARD_PASSWORD = 'let-me-in';
  try {
    assert.equal(checkPassword('let-me-in'), true);
  } finally {
    delete process.env.DASHBOARD_PASSWORD;
  }
});

test('checkPassword: rejects a wrong password', () => {
  process.env.DASHBOARD_PASSWORD = 'let-me-in';
  try {
    assert.equal(checkPassword('wrong'), false);
  } finally {
    delete process.env.DASHBOARD_PASSWORD;
  }
});

test('checkPassword: rejects a missing candidate', () => {
  process.env.DASHBOARD_PASSWORD = 'let-me-in';
  try {
    assert.equal(checkPassword(undefined), false);
  } finally {
    delete process.env.DASHBOARD_PASSWORD;
  }
});

test('checkPassword: throws when DASHBOARD_PASSWORD is not configured', () => {
  delete process.env.DASHBOARD_PASSWORD;
  assert.throws(() => checkPassword('anything'), /DASHBOARD_PASSWORD/);
});

test('isAuthenticated: true when the session cookie matches the password', () => {
  process.env.DASHBOARD_PASSWORD = 'let-me-in';
  try {
    const req = { headers: { cookie: `${COOKIE_NAME}=let-me-in; other=1` } };
    assert.equal(isAuthenticated(req), true);
  } finally {
    delete process.env.DASHBOARD_PASSWORD;
  }
});

test('isAuthenticated: false when there is no cookie header', () => {
  process.env.DASHBOARD_PASSWORD = 'let-me-in';
  try {
    assert.equal(isAuthenticated({ headers: {} }), false);
  } finally {
    delete process.env.DASHBOARD_PASSWORD;
  }
});

test('isAuthenticated: false when the cookie value is wrong', () => {
  process.env.DASHBOARD_PASSWORD = 'let-me-in';
  try {
    const req = { headers: { cookie: `${COOKIE_NAME}=nope` } };
    assert.equal(isAuthenticated(req), false);
  } finally {
    delete process.env.DASHBOARD_PASSWORD;
  }
});
