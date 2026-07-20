const crypto = require('crypto');
const { getAuthorizeUrl } = require('../../lib/quickbooks-client');
const { isAuthenticated } = require('../../lib/dashboard-auth');

// One-time interactive setup step -- an admin visits this URL once to
// connect the QuickBooks company. Not part of the regular dashboard flow.
// Gated so a stranger can't initiate a connection that would overwrite the
// stored QuickBooks tokens with their own company's.
module.exports = async (req, res) => {
  try {
    if (!isAuthenticated(req)) {
      res.writeHead(302, { Location: '/api/login' });
      res.end();
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    res.writeHead(302, { Location: getAuthorizeUrl(state) });
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'Failed to start QuickBooks OAuth', detail: err.message });
  }
};
