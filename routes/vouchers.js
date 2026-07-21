const express = require('express');
const router = express.Router();
const {
  createVoucher,
  getVouchers,
  getVoucherById,
  deleteVoucher,
  redeemVoucher,
} = require('../controllers/voucherController');
const { protect, adminOnly } = require('../middleware/auth');

// Public redemption endpoint (called from captive portal)
router.post('/redeem', redeemVoucher);

// All other routes require admin authentication
router.use(protect, adminOnly);


router.route('/')
  .get(getVouchers)
  .post(createVoucher);

router.route('/:id')
  .get(getVoucherById)
  .delete(deleteVoucher);

module.exports = router;
