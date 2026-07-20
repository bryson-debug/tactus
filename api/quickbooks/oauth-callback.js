const { exchangeCodeForTokens } = require('../../lib/quickbooks-client');

// One-time setup endpoint -- Intuit redirects here after the admin approves
// the consent screen from oauth-start. Not part of the regular dashboard flow.
module.exports = async (req, res) => {
  const { code, realmId, error } = req.query;
  if (error) {
    res.status(400).send(`QuickBooks authorization was denied: ${error}`);
    return;
  }
  if (!code || !realmId) {
    res.status(400).send('Missing code or realmId in QuickBooks callback');
    return;
  }
  try {
    await exchangeCodeForTokens({ code: code.toString(), realmId: realmId.toString() });
    res.status(200).send('QuickBooks connected successfully. You can close this tab.');
  } catch (err) {
    res.status(502).send(`QuickBooks token exchange failed: ${err.message}`);
  }
};
