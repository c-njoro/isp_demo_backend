const express = require('express');
const router = express.Router();
const {
  getTransactions,
  getTransaction,
  getTransactionStats,
  getInvoices,
  getInvoice,
  getInvoiceByNumber,
  getUnprocessedPayments,
  getAllPayments,
  generateInvoice
} = require('../controllers/financialController');
const { protect, applyRegionFilter } = require('../middleware/auth');

router.use(protect);
router.use(applyRegionFilter);

// Transaction routes
router.get('/transactions', getTransactions);
router.get('/transactions/stats', getTransactionStats);
router.get('/transactions/:id', getTransaction);

// Invoice routes
router.get('/invoices', getInvoices);
router.get('/invoices/number/:invoiceNumber', getInvoiceByNumber);
router.get('/invoices/:id', getInvoice);
router.post('/invoices/generate', generateInvoice)


router.get('/unprocessed-payments', getUnprocessedPayments)

router.get('/all-payments', getAllPayments)

module.exports = router;