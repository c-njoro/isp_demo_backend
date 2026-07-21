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
  generateInvoice,
  getFinancialOverview,
  getRevenueByRegion,
  getRevenueByRouter,
  getMonthlyTrend,
  getArpu,
  getComparison
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

// Financial Analysis
router.get('/analysis/overview', getFinancialOverview);
router.get('/analysis/by-region', getRevenueByRegion);
router.get('/analysis/by-router', getRevenueByRouter);
router.get('/analysis/monthly-trend', getMonthlyTrend);
router.get('/analysis/arpu', getArpu);
router.get('/analysis/comparison', getComparison);

module.exports = router;