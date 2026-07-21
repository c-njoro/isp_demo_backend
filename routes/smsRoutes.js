const express = require('express');
const router = express.Router();
const {
  sendSingleSms,
  sendBulkByFilter,
  sendPersonalizedByFilter,
  getSmsBalance,
  getDeliveryStatus,
  getSmsLogs,
  testFilter,
  getBulkSmsJobStatus

} = require('../controllers/smsController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.post('/send', sendSingleSms);
router.post('/bulk', sendBulkByFilter);
router.post('/personalized', sendPersonalizedByFilter);
router.get('/balance', getSmsBalance);
router.get('/status/:messageId', getDeliveryStatus);
router.get('/logs', getSmsLogs);
router.post('/test-filter', testFilter);
router.get('/jobs/:jobId', getBulkSmsJobStatus);

module.exports = router;