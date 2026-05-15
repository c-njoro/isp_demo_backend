const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUser,
  disableUser,
  enableUser,
  deleteUser,
  getGroups,
  updateGroup,
  deleteGroup,
  getNasDevices,
  upsertNas,
  deleteNas,
  updateUserPassword
} = require('../controllers/radiusManagementController');
const { protect, adminOnly } = require('../middleware/auth');

router.use(protect);
router.use(adminOnly); // all RADIUS management endpoints require admin

// Users
router.get('/users', getUsers);
router.get('/users/:username', getUser);
router.post('/users/:username/disable', disableUser);
router.post('/users/:username/enable', enableUser);
router.delete('/users/:username', deleteUser);

// Groups (plans)
router.get('/groups', getGroups);
router.put('/groups/:groupName', updateGroup);
router.delete('/groups/:groupName', deleteGroup);

// NAS devices
router.get('/nas', getNasDevices);
router.post('/nas', upsertNas);
router.delete('/nas/:id', deleteNas);

router.put('/users/:username/password', updateUserPassword);

module.exports = router;