const express = require('express');
const router = express.Router();
const {
  getOnus,
  getOnu,
  createOnu,
  updateOnu,
  deleteOnu,
  rebootOnu,
  getOnuStatus,
  syncOnuStatus,
  bulkSyncOnus,          // new
  getOnuStatsBySite      // new
} = require('../controllers/onuController');
const { protect, applyRegionFilter, adminOnly } = require('../middleware/auth');

// All ONU routes require authentication and region filtering
router.use(protect);
router.use(applyRegionFilter);

// CRUD operations
router.route('/')
  .get(getOnus)
  .post(adminOnly, createOnu);

router.route('/:id')
  .get(getOnu)
  .put(adminOnly, updateOnu)
  .delete(adminOnly, deleteOnu);

// ONU actions
router.post('/:id/reboot', rebootOnu);

// Monitoring
router.get('/:id/status', getOnuStatus);
router.post('/:id/sync', syncOnuStatus);

// Bulk operations
router.post('/bulk-sync/:oltId', adminOnly, bulkSyncOnus);

// Statistics
router.get('/stats/site/:siteId', getOnuStatsBySite);


module.exports = router; 

// Notes:
// - Authorize, unauthorize, enable, disable, bandwidth update are now handled via the updateOnu endpoint.
// - Separate endpoints for those actions have been removed to keep the API consistent.
// - Alerts and maintenance endpoints are not implemented in the new controller yet – they can be added later if needed.