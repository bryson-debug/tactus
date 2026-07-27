const { registerUnsubscribeWebhook } = require('../../lib/flodesk-client');
const { isAuthenticated } = require('../../lib/dashboard-auth');

// One-time interactive setup step -- an admin visits this URL once to
// register Flodesk's subscriber.unsubscribed webhook against this
// deployment. Not part of the regular dashboard flow.
module.exports = async (req, res) => {
  if (!isAuthenticated(req)) {
    res.writeHead(302, { Location: '/api/login' });
    res.end();
    return;
  }

  try {
    const postUrl = process.env.FLODESK_WEBHOOK_URL;
    if (!postUrl) throw new Error('FLODESK_WEBHOOK_URL is not configured');
    const result = await registerUnsubscribeWebhook({ postUrl });
    res
      .status(200)
      .send(`Flodesk webhook registered successfully (id: ${result.id}). You can close this tab.`);
  } catch (err) {
    res.status(502).send(`Flodesk webhook registration failed: ${err.message}`);
  }
};
