const { getDashboardSummary } = require('../../lib/metrics');
const { isAuthenticated } = require('../../lib/dashboard-auth');

module.exports = async (req, res) => {
  try {
    if (!isAuthenticated(req)) {
      res.status(401).json({ error: 'unauthorized', signInUrl: '/api/login' });
      return;
    }
  } catch (err) {
    res.status(500).json({ error: 'Dashboard misconfigured', detail: err.message });
    return;
  }

  const period = (req.query.period || 'this_month').toString();
  try {
    const summary = await getDashboardSummary({ period });
    res.status(200).json(summary);
  } catch (err) {
    res.status(400).json({ error: 'Failed to build dashboard summary', detail: err.message });
  }
};
