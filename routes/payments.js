const express = require('express');
const router = express.Router();

const {
  lookupCustomer,
  initiatePayment,
  kopokopoWebhook,
  checkPaymentStatus,
  getPaymentHistory,
  resolvePayment,
  searchUnprocessed,
  getTransactionsHistory,
  getAnUnprocessedPayment,
  movePayment,
  movePaymentToParent,
  depositCash,
  mpesaWebhook
} = require('../controllers/paymentControllerKopoKopo');

const { protect, applyRegionFilter } = require('../middleware/auth');


// =======================
// 📡 PUBLIC ROUTES (Payment Portal)
// =======================

// Lookup customer
router.post('/lookup', lookupCustomer);

// Initiate payment (KopoKopo STK)
router.post('/initiate', initiatePayment);

// KopoKopo webhook (replaces BOTH mpesaCallback + c2bCallback)
router.post('/kopokopo/webhook', express.json(), kopokopoWebhook);
router.post('/mpesa/webhook', express.json(), mpesaWebhook);

// Payment status
router.get('/:paymentId/status', checkPaymentStatus);


// =======================
// 🔐 ACTION ROUTES (Require Auth)
// =======================

// Resolve unprocessed payment
router.post('/resolve', protect, resolvePayment);
router.post('/deposit', protect, depositCash);

// Move payment between customers
router.post('/:paymentId/move', protect, movePayment);

// Move payment to parent account
router.post('/:paymentId/move-to-parent', protect, movePaymentToParent);

// Search unprocessed payments
router.get('/search-unprocessed', protect, searchUnprocessed);

// Get single unprocessed payment
router.get('/unprocessed-payment/:receipt', protect, getAnUnprocessedPayment);


// =======================
// 🔐 ADMIN / REPORTING ROUTES
// =======================

// Payment history
router.get(
  '/history/:customerId',
  protect,
  applyRegionFilter,
  getPaymentHistory
);

// Transactions history
router.get(
  '/transactions-history/:customerId',
  protect,
  applyRegionFilter,
  getTransactionsHistory
);


module.exports = router;