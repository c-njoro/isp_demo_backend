const express = require('express');
const router = express.Router();
const {
  getSystemLogs,
  getSystemLog,
  getSystemLogStats,
  getEntityLogs,
  getAccountLogs,
  cleanupOldLogs,
  exportSystemLogs
} = require('../controllers/systemLogController');
const { protect, authorize } = require('../middleware/auth');

// ============================================
// SYSTEM LOGS ROUTES (Admin Only)
// ============================================

// Statistics (must be before /:id to avoid route conflicts)
router.get('/stats', 
  protect, 
  authorize('admin', 'super_admin'), 
  getSystemLogStats
);

// Export to CSV
router.get('/export', 
  protect, 
  authorize('admin', 'super_admin'), 
  exportSystemLogs
);

// Get logs by entity (customer, payment, etc.)
router.get('/entity/:entityType/:entityId', 
  protect, 
  authorize('admin', 'super_admin'), 
  getEntityLogs
);

// Get logs by account ID
router.get('/account/:accountId', 
  protect, 
  authorize('admin', 'super_admin'), 
  getAccountLogs
);

// Cleanup old logs (super admin only)
router.delete('/cleanup', 
  protect, 
  authorize('super_admin'), 
  cleanupOldLogs
);

// Main routes
router.route('/')
  .get(protect, authorize('admin', 'super_admin'), getSystemLogs);

router.route('/:id')
  .get(protect, authorize('admin', 'super_admin'), getSystemLog);

module.exports = router;