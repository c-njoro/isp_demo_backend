const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  changeRole,
  resetPassword,
  suspendUser,
  activateUser,
  deleteUser,
  getUserMetrics,
  changeMyPassword
} = require('../controllers/userController');
const { protect, adminOnly } = require('../middleware/auth');

router.use(protect);

router.route('/').get(getUsers).post(adminOnly, createUser);
router.put('/change-password', protect, changeMyPassword);

router.route('/:id').get(getUser).put(updateUser).delete(adminOnly, deleteUser);
router.put('/:id/role', adminOnly,  changeRole);
router.put('/:id/reset-password', resetPassword);
router.put('/:id/suspend', adminOnly,  suspendUser);
router.put('/:id/activate', adminOnly, activateUser);
router.get('/:id/metrics', getUserMetrics);
// routes/users.js

module.exports = router;