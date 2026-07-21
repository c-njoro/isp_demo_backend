const express = require("express");
const router = express.Router();
const {  protect } = require("../middleware/auth");

const {  getLeads, getReports, getLeadById, getReportById
    
 } = require("../controllers/interSystemController");

// All routes require authentication and admin role
router.use(protect);

router.get("/leads", getLeads );
router.get("/reports", getReports);
router.get("/leads/:id", getLeadById);
router.get("/reports/:id", getReportById);

module.exports = router;