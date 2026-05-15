const express = require('express');
const router = express.Router();
const {
  sendSingleSms,
  sendBulkByFilter,
  sendPersonalizedByFilter,
  getSmsBalance,
  getDeliveryStatus,
  getSmsLogs,
  testFilter

} = require('../controllers/smsController');
const { protect, adminOnly } = require('../middleware/auth');

router.use(protect);

router.post('/send', sendSingleSms);
router.post('/bulk', adminOnly, sendBulkByFilter);
router.post('/personalized', adminOnly, sendPersonalizedByFilter);
router.get('/balance', getSmsBalance);
router.get('/status/:messageId', getDeliveryStatus);
router.get('/logs', adminOnly, getSmsLogs);
router.post('/test-filter', adminOnly, testFilter);

module.exports = router;