const express = require('express');
const router = express.Router();
const { suspendCustomersForRouter, reactivateCustomersForRouter } = require('../services/siteAutomation');
const Router = require('../models/Router');
const { protect, adminOnly } = require('../middleware/auth');

// POST /api/admin/site-automations/suspend-customers
// Body: { routerIds: string[], hoursOffline: number } (hoursOffline optional, defaults to 5)
router.post('/suspend-customers', protect, adminOnly, async (req, res) => {
  const { routerIds, hoursOffline = 5 } = req.body;
  if (!routerIds || !Array.isArray(routerIds)) {
    return res.status(400).json({ success: false, error: 'routerIds array required' });
  }
  const results = [];
  for (const id of routerIds) {
    const router = await Router.findById(id);
    if (!router) {
      results.push({ routerId: id, error: 'Router not found' });
      continue;
    }
    const suspended = await suspendCustomersForRouter(router, hoursOffline);
    results.push({ routerId: id, routerName: router.name, suspended });
  }
  res.json({ success: true, results });
});

// POST /api/admin/site-automations/reactivate-customers
// Body: { routerIds: string[] }
router.post('/reactivate-customers', protect, adminOnly, async (req, res) => {
  const { routerIds } = req.body;
  if (!routerIds || !Array.isArray(routerIds)) {
    return res.status(400).json({ success: false, error: 'routerIds array required' });
  }
  const results = [];
  for (const id of routerIds) {
    const router = await Router.findById(id);
    if (!router) {
      results.push({ routerId: id, error: 'Router not found' });
      continue;
    }
    const reactivated = await reactivateCustomersForRouter(router);
    results.push({ routerId: id, routerName: router.name, reactivated });
  }
  res.json({ success: true, results });
});

module.exports = router;