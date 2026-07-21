const express = require('express');
const router = express.Router();
const {
  getMyRetentionRecords,
  getMyRetentionAnalytics,
  getAllRetentionRecords,
  getEmployeeRetentionAnalytics,
} = require('../controllers/retentionController');
const { protect, authorize, adminOnly } = require('../middleware/auth');

// User (admin/staff) – own records
router.get('/my-records', protect, getMyRetentionRecords);
router.get('/my-analytics', protect, getMyRetentionAnalytics);

// Admin – view all records & employee analytics
router.get('/all', protect, adminOnly, getAllRetentionRecords);
router.get('/employee-analytics', protect, adminOnly,  getEmployeeRetentionAnalytics);

module.exports = router;