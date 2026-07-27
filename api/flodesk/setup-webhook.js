const { registerWebhooks } = require('../../lib/flodesk-client');
const { isAuthenticated } = require('../../lib/dashboard-auth');

// One-time interactive setup step -- an admin visits this URL once to
// register Flodesk's subscriber.created + subscriber.unsubscribed webhooks
// against this deployment (both growth and churn are tracked this way, see
// lib/flodesk-client.js for why). Safe to re-run -- it updates the existing
// webhook instead of creating a duplicate. Not part of the regular
// dashboard flow.
module.exports = async (req, res) => {
  if (!isAuthenticated(req)) {
    res.writeHead(302, { Location: '/api/login' });
    res.end();
    return;
  }

  try {
    const postUrl = process.env.FLODESK_WEBHOOK_URL;
    if (!postUrl) throw new Error('FLODESK_WEBHOOK_URL is not configured');
    const result = await registerWebhooks({ postUrl });
    res
      .status(200)
      .send(`Flodesk webhook registered successfully (id: ${result.id}). You can close this tab.`);
  } catch (err) {
    res.status(502).send(`Flodesk webhook registration failed: ${err.message}`);
  }
};
