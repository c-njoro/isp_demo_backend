const express = require('express');
const router = express.Router();
const {
  getDashboardOverview,
  getRevenueChart,
  getCustomerGrowth,
  getPackageDistribution,
  getRecentActivities,
  getTopCustomers,
  getSystemHealth,
  getCustomersSubscriptionsByDate,
  getRevenueByPackage,
  getTodayEarnings,
  getOnlineCustomersCount
} = require('../controllers/dashboardController');
const { protect, applyRegionFilter } = require('../middleware/auth');

router.use(protect);
router.use(applyRegionFilter);

router.get('/overview', getDashboardOverview);
router.get('/revenue-chart', getRevenueChart);
router.get('/customer-growth', getCustomerGrowth);
router.get('/package-distribution', getPackageDistribution);
router.get('/recent-activities', getRecentActivities);
router.get('/top-customers', getTopCustomers);
router.get('/system-health', getSystemHealth);
router.post('/subscription-dates', getCustomersSubscriptionsByDate);
router.get('/revenue-by-package', getRevenueByPackage);
router.get('/today-earnings', getTodayEarnings);
router.get('/online-customers', getOnlineCustomersCount);

module.exports = router;