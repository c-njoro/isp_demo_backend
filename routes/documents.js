const express = require('express');
const router = express.Router();
const { getReceipt, getStatement, getSubscriptionReceipt } = require('../controllers/documentController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/receipt/:paymentId', getReceipt);
router.get('/statement/:customerId', getStatement);
router.get('/subscription-receipt/:transactionId', getSubscriptionReceipt);

module.exports = router;