const express = require('express');
const router = express.Router();
const {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  suspendCustomer,
  reactivateCustomer,
  changePackage,
  getCustomerTransactions,
  deleteCustomer,
  changePassword,
  updateCPE,
  getCustomerRouterStatus,
  resetCustomerMac,
  createChildAccount,
  getChildren,
  migrateCustomer,
  clearCustomerMac,
  toggleCustomerFUP,
  getCustomerUsage,
  getCustomerSmsLogs,
  calculateExpiryMove,
  moveExpiry,
  applyBurst,
  removeBurst,
  overrideExpiry,
  extendExpiry,
  getCustomersPositiveBalance,
  getCustomersNegativeBalance,
  addExpense,
  syncCustomersToRadius,
  bulkImportCustomers,
  getTicketsByCustomer,
  syncSingleCustomerToRadius
} = require('../controllers/customerController');
const { protect, applyRegionFilter, adminOnly } = require('../middleware/auth');

// All routes are protected
router.use(protect);
router.use(applyRegionFilter);


router.post('/sync-to-radius', protect, adminOnly, syncCustomersToRadius);
router.post('/bulk-import', protect, adminOnly, bulkImportCustomers);
router.route('/')
  .get(getCustomers)
  .post(createCustomer);

router.route('/:id')
  .get(getCustomer)
  .put(updateCustomer)
  .delete(deleteCustomer);
  router.get('/reports/positive-balance', protect, adminOnly, getCustomersPositiveBalance);
  router.get('/reports/negative-balance', protect, adminOnly,  getCustomersNegativeBalance);
router.put('/:id/suspend', suspendCustomer);
router.put('/:id/reactivate', reactivateCustomer);
router.put('/:id/toggle-fup', toggleCustomerFUP);
router.put('/:id/change-password', changePassword);
router.put('/:id/cpe', updateCPE);
router.put('/:id/change-package', changePackage);
router.get('/:id/transactions', adminOnly,  getCustomerTransactions);
router.post('/:id/migrate', protect, migrateCustomer);
router.get('/:id/router-status', getCustomerRouterStatus);
router.get('/:id/tickets', protect, getTicketsByCustomer);
router.post('/:id/reset-mac', resetCustomerMac);
router.post('/:parentId/children', protect, createChildAccount);
router.get('/:parentId/children', protect, getChildren);
router.post('/:id/clear-mac', clearCustomerMac);
router.get('/:id/usage', getCustomerUsage);
router.get('/:id/sms-logs', getCustomerSmsLogs);
router.post('/:id/calculate-expiry-move', calculateExpiryMove);
router.post('/:id/move-expiry', moveExpiry);
router.post('/:id/burst', protect, adminOnly, applyBurst);
router.delete('/:id/burst', protect, adminOnly, removeBurst);
router.put('/:id/override-expiry', protect, adminOnly, overrideExpiry);
router.post('/:id/extend-expiry', protect, adminOnly, extendExpiry);
router.post('/:id/expense', protect, adminOnly, addExpense);
router.post('/:id/sync-to-radius', protect, syncSingleCustomerToRadius);



module.exports = router;