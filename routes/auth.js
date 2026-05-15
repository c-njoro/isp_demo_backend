const express = require('express');
const router = express.Router();
const {
  login,
  logout,
  getMe,
  switchRegion,
  changePassword,
  getPermissions,
  getAvailableRegions
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public routes
router.post('/login', login);

// Protected routes
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.post('/switch-region', protect, switchRegion);
router.put('/change-password', protect, changePassword);
router.get('/permissions', protect, getPermissions);
router.get('/available-regions', protect, getAvailableRegions);

module.exports = router;