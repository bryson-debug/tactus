const crypto = require('crypto');

// App-level password gate, built because Vercel's own Deployment Protection
// on the Hobby plan explicitly excludes production custom domains --
// "Standard Protection" only covers preview/deployment-hash URLs, and
// locking down production requires a paid Pro plan ("All Deployments"
// protection). This is the free alternative: a shared password, checked on
// every API request that returns real financial data. The static frontend
// shell itself isn't gated (it has no data embedded in it -- everything
// comes from these API calls), so an unauthenticated visitor sees the page
// but every card 401s until they sign in via /api/login.
//
// Session cookie value is simply the password itself (httpOnly + Secure +
// SameSite=Lax, so it's not readable by page JS and only sent over HTTPS).
// That's a deliberate simplification over a signed/opaque session token --
// fine for a 2-person internal tool, not meant to withstand a serious
// attacker with cookie access.

const COOKIE_NAME = 'tactus_session';

function checkPassword(candidate) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) throw new Error('DASHBOARD_PASSWORD is not configured');
  if (typeof candidate !== 'string' || candidate.length !== password.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(password));
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return checkPassword(cookies[COOKIE_NAME]);
}

module.exports = { COOKIE_NAME, checkPassword, isAuthenticated };
