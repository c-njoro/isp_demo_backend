const express = require("express");
const router = express.Router();
const { protectCustomer } = require("../middleware/customerAuthMiddleware");
const {
  // Authentication
  requestOTP,
  verifyOTP,

  // Profile
  getProfile,
  updateProfile,

  // Subscription & Billing
  getSubscription,
  getPayments,
  getTransactions,

  // Payment
  getPaymentAccounts,
  initiatePayment,
  getAvailablePackages,

  // Connection
  getConnectionStatus,

  // ONU Management
  getOnuStatus,
  getOnuDevices,
  updateWiFiCredentials,
  rebootOnu,

  // Support
  getSupportInfo,

  changePackage,

  calculateExpiryMove,
  moveExpiry
} = require("../controllers/customerPortalController");

// ============================================
// PUBLIC ROUTES (No Authentication)
// ============================================

// Authentication
router.post("/auth/request-otp", requestOTP);
router.post("/auth/verify-otp", verifyOTP);

// ============================================
// PROTECTED ROUTES (Customer Authentication Required)
// ============================================

// Profile
router.get("/profile", protectCustomer, getProfile);
router.put("/profile", protectCustomer, updateProfile);

// Subscription & Billing
router.get("/subscription", protectCustomer, getSubscription);
router.get("/payments", protectCustomer, getPayments);
router.get("/transactions", protectCustomer, getTransactions);

// Payment
router.get("/payment/accounts", protectCustomer, getPaymentAccounts);
router.post("/payment/initiate", protectCustomer, initiatePayment);
router.put("/subscription/change-package", protectCustomer, changePackage);
router.get("/packages", protectCustomer, getAvailablePackages);

// Connection Status
router.get("/connection-status", protectCustomer, getConnectionStatus);

// ONU Management
router.get("/onu/status", protectCustomer, getOnuStatus);
router.get("/onu/devices", protectCustomer, getOnuDevices);
router.put("/onu/wifi", protectCustomer, updateWiFiCredentials);
router.post("/onu/reboot", protectCustomer, rebootOnu);

// Support
router.get("/support", protectCustomer, getSupportInfo);


router.post("/calculate-expiry-move", protectCustomer, calculateExpiryMove);
router.post("/move-expiry", protectCustomer, moveExpiry);

module.exports = router;
