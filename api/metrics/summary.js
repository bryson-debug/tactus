const { getDashboardSummary } = require('../../lib/metrics');

module.exports = async (req, res) => {
  const period = (req.query.period || 'this_month').toString();
  try {
    const summary = await getDashboardSummary({ period });
    res.status(200).json(summary);
  } catch (err) {
    res.status(400).json({ error: 'Failed to build dashboard summary', detail: err.message });
  }
};
