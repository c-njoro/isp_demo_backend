const express = require("express");
const router = express.Router();

const { verifyInterSystemSignature } = require("../middleware/verifyInterSystemSignature");
const {
  getCustomersForOperations,
  getSingleCustomerForOperations,
  getUnprocessedPaymentForOperations,
  resolvePaymentForOperations,
} = require("../controllers/interSystemController");

// All routes here are protected by HMAC signature verification.
// No user session / auth middleware — these are machine-to-machine calls.

// POST /api/v2/inter-system/customers        — paginated list with filters
// POST /api/v2/inter-system/customers/single — single customer lookup

router.post("/customers",        verifyInterSystemSignature, getCustomersForOperations);
router.post("/customers/single", verifyInterSystemSignature, getSingleCustomerForOperations);
router.post("/payments/unprocessed/single", verifyInterSystemSignature, getUnprocessedPaymentForOperations);
router.post("/payments/resolve", verifyInterSystemSignature, resolvePaymentForOperations);




module.exports = router;