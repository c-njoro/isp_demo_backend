// routes/hotspot.js
const express = require('express');
const router = express.Router();
const {
  createHotspotUser,
  getHotspotUsers,
  getHotspotUser,
  updateHotspotUser,
  deleteHotspotUser,
  getHotspotStatus,
  disconnectHotspotUser,
  getHotspotUserDetail,
  getHotspotUserUsage,
  getHotspotUserPayments,
  getHotspotUsageSinceActivation
} = require('../controllers/hotspotController');

const { protect} = require('../middleware/auth');

// All routes require admin authentication
router.use(protect);

router.route('/')
  .get(getHotspotUsers)
  .post(createHotspotUser);

router.route('/:id')
  .get(getHotspotUser)
  .put(updateHotspotUser)
  .delete(deleteHotspotUser);

router.get('/:id/status', getHotspotStatus);
router.post('/:id/disconnect', disconnectHotspotUser);
router.get('/:id/detail', getHotspotUser);
router.get('/:id/usage', getHotspotUserUsage);
router.get('/:id/payments', getHotspotUserPayments);
router.get('/:id/usage-since-activation', getHotspotUsageSinceActivation);

module.exports = router;