const crypto = require('crypto');
const { getAuthorizeUrl } = require('../../lib/quickbooks-client');

// One-time interactive setup step -- an admin visits this URL once to
// connect the QuickBooks company. Not part of the regular dashboard flow.
module.exports = async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    res.writeHead(302, { Location: getAuthorizeUrl(state) });
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'Failed to start QuickBooks OAuth', detail: err.message });
  }
};
