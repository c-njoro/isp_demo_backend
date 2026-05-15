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
  disconnectHotspotUser
} = require('../controllers/hotspotController');

const { protect, authorize } = require('../middleware/auth');

// All routes require admin authentication
router.use(protect);
router.use(authorize('admin', 'super_admin'));

router.route('/')
  .get(getHotspotUsers)
  .post(createHotspotUser);

router.route('/:id')
  .get(getHotspotUser)
  .put(updateHotspotUser)
  .delete(deleteHotspotUser);

router.get('/:id/status', getHotspotStatus);
router.post('/:id/disconnect', disconnectHotspotUser);

module.exports = router;