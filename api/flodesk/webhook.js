const { recordSubscriberWebhookEvent } = require('../../lib/flodesk-client');

// Called by Flodesk itself (not a browser), so this is NOT gated by
// isAuthenticated -- instead secured by a shared-secret token in the query
// string, since Flodesk's webhook API has no HMAC signing to verify a
// request actually came from them. Set FLODESK_WEBHOOK_TOKEN and register
// the webhook once (via /api/flodesk/setup-webhook) with a post_url that
// includes ?token=<that value>.
module.exports = async (req, res) => {
  const expectedToken = process.env.FLODESK_WEBHOOK_TOKEN;
  if (!expectedToken || req.query.token !== expectedToken) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    await recordSubscriberWebhookEvent(req.body);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record webhook event', detail: err.message });
  }
};
