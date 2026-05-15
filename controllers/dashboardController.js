const asyncHandler = require('../middleware/asyncHandler');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const Ticket = require('../models/Ticket');
const Transaction = require('../models/Transaction');
const Payment = require('../models/Payment');
const UnprocessedPayment = require('../models/UnprocessedPayment');



const { getLeadStats } = require('../utils/leadHelpers');
const { getTicketStats } = require('../utils/ticketHelpers');

// @desc    Get dashboard overview
// @route   GET /api/dashboard/overview
// @access  Private
exports.getDashboardOverview = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo } = req.query;
  const regionFilter = req.regionFilter;

  const dateFilter = {};
  if (dateFrom || dateTo) {
    dateFilter.createdAt = {};
    if (dateFrom) dateFilter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) dateFilter.createdAt.$lte = new Date(dateTo);
  }

  // Customer stats
  const totalCustomers = await Customer.countDocuments(regionFilter);
  const activeCustomers = await Customer.countDocuments({ ...regionFilter, 'subscription.status': 'active' });
  const expiredCustomers = await Customer.countDocuments({ ...regionFilter, 'subscription.status': 'expired' });
  const suspendedCustomers = await Customer.countDocuments({ ...regionFilter, 'subscription.status': 'suspended' });

  // Revenue by site (transactions)
  const revenueBySite = await Transaction.aggregate([
    {
      $match: {
        ...regionFilter,
        type: 'MPESA',
        status: 'completed',
        ...dateFilter
      }
    },
    {
      $lookup: {
        from: 'sites',
        localField: 'siteId',
        foreignField: '_id',
        as: 'site'
      }
    },
    { $unwind: { path: '$site', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { siteId: '$siteId', siteName: '$site.siteName' },
        revenue: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    { $sort: { revenue: -1 } }
  ]);

  const overallRevenue = revenueBySite.reduce((sum, item) => sum + item.revenue, 0);
  const totalTransactions = revenueBySite.reduce((sum, item) => sum + item.count, 0);

  // Payment stats by site
  const paymentStatsBySite = await Payment.aggregate([
    {
      $match: {
        ...regionFilter,
        ...dateFilter
      }
    },
    {
      $lookup: {
        from: 'sites',
        localField: 'siteId',
        foreignField: '_id',
        as: 'site'
      }
    },
    { $unwind: { path: '$site', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { siteId: '$siteId', siteName: '$site.siteName' },
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ['$status', ['initiated', 'pending']] }, 1, 0] } }
      }
    },
    { $sort: { total: -1 } }
  ]);

  const overallPaymentStats = paymentStatsBySite.reduce(
    (acc, site) => {
      acc.total += site.total;
      acc.completed += site.completed;
      acc.failed += site.failed;
      acc.pending += site.pending;
      return acc;
    },
    { total: 0, completed: 0, failed: 0, pending: 0 }
  );

  // Tickets and leads (existing)
  const leadStats = await getLeadStats(regionFilter.regionCode, dateFrom, dateTo);
  const ticketStats = await getTicketStats(regionFilter.regionCode, dateFrom, dateTo);

  // Customers expiring soon
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  const expiringSoon = await Customer.countDocuments({
    ...regionFilter,
    'subscription.status': 'active',
    'subscription.expiresAt': { $gte: new Date(), $lte: sevenDaysFromNow }
  });

  res.status(200).json({
    success: true,
    data: {
      customers: {
        total: totalCustomers,
        active: activeCustomers,
        expired: expiredCustomers,
        suspended: suspendedCustomers,
        expiringSoon
      },
      revenue: {
        total: overallRevenue,
        transactions: totalTransactions,
        bySite: revenueBySite.map(item => ({
          siteId: item._id.siteId,
          siteName: item._id.siteName || 'Unknown',
          amount: item.revenue,
          count: item.count
        }))
      },
      payments: {
        total: overallPaymentStats.total,
        successful: overallPaymentStats.completed,
        failed: overallPaymentStats.failed,
        pending: overallPaymentStats.pending,
        bySite: paymentStatsBySite.map(item => ({
          siteId: item._id.siteId,
          siteName: item._id.siteName || 'Unknown',
          total: item.total,
          successful: item.completed,
          failed: item.failed,
          pending: item.pending
        }))
      },
      leads: leadStats,
      tickets: ticketStats
    }
  });
});


exports.getCustomersSubscriptionsByDate = asyncHandler(async (req, res, next) => {
  let { days } = req.body;
  const regionFilter = req.regionFilter;

  // Validate days (must be integer)
  days = Number(days);
  if (!Number.isInteger(days)) {
    return next(new ErrorResponse('Days must be an integer', 400));
  }

  const now = new Date();

  if (days >= 0) {
    // Future: active customers expiring in the next `days` days (including today)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);
    const expiringSoon = await Customer.countDocuments({
      ...regionFilter,
      'subscription.status': 'active',
      'subscription.expiresAt': {
        $gte: now,
        $lte: futureDate,
      },
    });
    return res.status(200).json({
      success: true,
      data: {
        days,
        count: expiringSoon,
        direction: 'future',
      },
    });
  } else {
    // Past: expired customers whose expiry date is within the last `-days` days
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() + days); // days is negative
    const expiredRecently = await Customer.countDocuments({
      ...regionFilter,
      'subscription.status': 'expired',
      'subscription.expiresAt': {
        $gte: pastDate,
        $lte: now,
      },
    });
    return res.status(200).json({
      success: true,
      data: {
        days: Math.abs(days),
        count: expiredRecently,
        direction: 'past',
      },
    });
  }
});

// @desc    Get revenue chart data
// @route   GET /api/dashboard/revenue-chart
// @access  Private
exports.getRevenueChart = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo, interval = 'day' } = req.query;

  const match = {
    ...req.regionFilter,
    type: 'MPESA',
    status: 'completed'
  };

  if (dateFrom || dateTo) {
    match.createdAt = {};
    if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
    if (dateTo) match.createdAt.$lte = new Date(dateTo);
  }

  // Group by interval
  let groupFormat;
  if (interval === 'month') {
    groupFormat = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
  } else if (interval === 'week') {
    groupFormat = { $dateToString: { format: '%Y-W%V', date: '$createdAt' } };
  } else {
    groupFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
  }

  const revenueData = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: groupFormat,
        revenue: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  res.status(200).json({
    success: true,
    message: 'Revenue chart data retrieved successfully',
    data: revenueData
  });
});

// @desc    Get customer growth chart data
// @route   GET /api/dashboard/customer-growth
// @access  Private
exports.getCustomerGrowth = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo, interval = 'month' } = req.query;

  // Build region filter
  const match = { ...req.regionFilter };

  // Prepare date filters as Date objects (for later use in the pipeline)
  const gteDate = dateFrom ? new Date(dateFrom) : null;
  const lteDate = dateTo ? new Date(dateTo) : null;

  // Aggregation pipeline
  const pipeline = [];

  // Step 1: Ensure createdAt is a proper Date
  pipeline.push({
    $addFields: {
      createdAtDate: {
        $cond: {
          if: { $eq: [{ $type: "$createdAt" }, "string"] },
          then: { $toDate: "$createdAt" },
          else: "$createdAt"
        }
      }
    }
  });

  // Step 2: Match by region and date range (using the new createdAtDate)
  const matchStage = { ...match };
  if (gteDate || lteDate) {
    matchStage.createdAtDate = {};
    if (gteDate) matchStage.createdAtDate.$gte = gteDate;
    if (lteDate) matchStage.createdAtDate.$lte = lteDate;
  }
  pipeline.push({ $match: matchStage });

  // Step 3: Group by interval based on createdAtDate
  let groupFormat;
  if (interval === 'month') {
    groupFormat = { $dateToString: { format: '%Y-%m', date: '$createdAtDate' } };
  } else if (interval === 'week') {
    groupFormat = { $dateToString: { format: '%Y-W%V', date: '$createdAtDate' } };
  } else { // day
    groupFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAtDate' } };
  }

  pipeline.push({
    $group: {
      _id: groupFormat,
      newCustomers: { $sum: 1 }
    }
  });

  pipeline.push({ $sort: { _id: 1 } });

  const growthData = await Customer.aggregate(pipeline);

  res.status(200).json({
    success: true,
    message: 'Customer growth data retrieved successfully',
    data: growthData
  });
});

// @desc    Get package distribution
// @route   GET /api/dashboard/package-distribution
// @access  Private
exports.getPackageDistribution = asyncHandler(async (req, res, next) => {
  const distribution = await Customer.aggregate([
    { $match: { ...req.regionFilter, isActive: true } },
    {
      $lookup: {
        from: 'packages',
        localField: 'subscription.packageId',
        foreignField: '_id',
        as: 'package'
      }
    },
    { $unwind: '$package' },
    {
      $group: {
        _id: '$package.packageName',
        count: { $sum: 1 },
        revenue: { $sum: '$package.price' }
      }
    },
    { $sort: { count: -1 } }
  ]);

  res.status(200).json({
    success: true,
    message: 'Package distribution retrieved successfully',
    data: distribution
  });
});

// dashboardController.js (or reportsController.js)

// @desc    Get revenue by package from completed payments, filtered by month
// @route   GET /api/dashboard/revenue-by-package
// @access  Private
exports.getRevenueByPackage = asyncHandler(async (req, res, next) => {
  const { monthsBack = 0 } = req.query;
  let startDate, endDate;
  if (monthsBack && monthsBack !== '0') {
    const now = new Date();
    let targetMonth = now.getMonth() - parseInt(monthsBack);
    let targetYear = now.getFullYear();
    if (targetMonth < 0) {
      targetMonth += 12;
      targetYear -= 1;
    }
    startDate = new Date(targetYear, targetMonth, 1);
    endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);
  }

  const matchStage = {
    status: 'completed',
    ...req.regionFilter,
  };
  if (startDate && endDate) {
    // Use createdAt if completedAt is missing (older payments)
    matchStage.$or = [
      { completedAt: { $gte: startDate, $lte: endDate } },
      { completedAt: { $exists: false }, createdAt: { $gte: startDate, $lte: endDate } },
    ];
  }

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: '$packageId',
        revenue: { $sum: '$amount' },
        paymentCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'packages',
        localField: '_id',
        foreignField: '_id',
        as: 'package',
      },
    },
    { $unwind: { path: '$package', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        packageName: { $ifNull: ['$package.packageName', 'Unknown'] },
        revenue: 1,
        paymentCount: 1,
      },
    },
    { $sort: { revenue: -1 } },
  ];

  const revenueData = await Payment.aggregate(pipeline);
  res.status(200).json({ success: true, data: revenueData });
});

// @desc    Get recent activities
// @route   GET /api/dashboard/recent-activities
// @access  Private
exports.getRecentActivities = asyncHandler(async (req, res, next) => {
  const { limit = 10 } = req.query;

  // Get recent payments
  const recentPayments = await Payment.find({
    ...req.regionFilter,
    status: 'completed'
  })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .select('accountId amount createdAt mpesaReceiptNumber');

  // Get recent customers
  const recentCustomers = await Customer.find(req.regionFilter)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .select('accountId firstName lastName createdAt');

  // Get recent tickets
  const recentTickets = await Ticket.find(req.regionFilter)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .select('ticketNumber subject status priority createdAt');

  res.status(200).json({
    success: true,
    message: 'Recent activities retrieved successfully',
    data: {
      recentPayments,
      recentCustomers,
      recentTickets
    }
  });
});

// @desc    Get top customers by revenue
// @route   GET /api/dashboard/top-customers
// @access  Private
exports.getTopCustomers = asyncHandler(async (req, res, next) => {
  const { limit = 10, dateFrom, dateTo } = req.query;

  const match = {
    ...req.regionFilter,
    type: 'MPESA',
    status: 'completed'
  };

  if (dateFrom || dateTo) {
    match.createdAt = {};
    if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
    if (dateTo) match.createdAt.$lte = new Date(dateTo);
  }

  const topCustomers = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$customerId',
        totalRevenue: { $sum: '$amount' },
        transactionCount: { $sum: 1 },
        accountId: { $first: '$accountId' },
        firstName: { $first: '$firstName' },
        lastName: { $first: '$lastName' }
      }
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: parseInt(limit) }
  ]);

  res.status(200).json({
    success: true,
    message: 'Top customers retrieved successfully',
    data: topCustomers
  });
});

// @desc    Get system health metrics
// @route   GET /api/dashboard/system-health
// @access  Private
exports.getSystemHealth = asyncHandler(async (req, res, next) => {
  const { days = 1 } = req.query; // days as query param, default 1
  const daysNum = parseInt(days, 10);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysNum);

  // 1. Payment success rate (last `days` days)
  const totalPayments = await Payment.countDocuments({
    createdAt: { $gte: startDate }
  });
  const successfulPayments = await Payment.countDocuments({
    createdAt: { $gte: startDate },
    status: 'completed'
  });
  const paymentSuccessRate = totalPayments > 0
    ? Math.round((successfulPayments / totalPayments) * 100)
    : 0;

  // 2. Active sessions (from RADIUS radacct)
  const radiusService = require('../services/radiusService');
  const activeSessionsResult = await radiusService.getActiveSessions();
  const activeSessions = activeSessionsResult.success ? activeSessionsResult.count : 0;

  // 3. SLA compliance (tickets resolved within deadline, last `days` days)
  const totalResolvedTickets = await Ticket.countDocuments({
    status: 'resolved',
    resolvedAt: { $gte: startDate }
  });
  const slaCompliantTickets = await Ticket.countDocuments({
    status: 'resolved',
    resolvedAt: { $gte: startDate },
    'sla.isBreached': false
  });
  const slaComplianceRate = totalResolvedTickets > 0
    ? Math.round((slaCompliantTickets / totalResolvedTickets) * 100)
    : 0;

  // 4. Pending issues (all-time, not time‑bound)
  const pendingPayments = await Payment.countDocuments({
    status: { $in: ['initiated', 'pending'] }
  });
  const openTickets = await Ticket.countDocuments({
    status: { $in: ['open', 'in_progress'] }
  });
  const breachedTickets = await Ticket.countDocuments({
    'sla.isBreached': true,
    status: { $nin: ['resolved', 'closed'] }
  });

  res.status(200).json({
    success: true,
    data: {
      days: daysNum,
      paymentSuccessRate,
      activeSessions,
      slaComplianceRate,
      pendingIssues: {
        pendingPayments,
        openTickets,
        breachedTickets
      }
    }
  });
});

// @desc    Get today's earnings from completed transactions
// @route   GET /api/dashboard/today-earnings
// @access  Private


exports.getTodayEarnings = asyncHandler(async (req, res, next) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  // 1. Aggregate completed payments
  const paymentMatch = {
    ...req.regionFilter,        // e.g., { regionCode: 'XYZ' }
    status: 'completed',
    createdAt: { $gte: todayStart, $lte: todayEnd }
  };

  const paymentResult = await Payment.aggregate([
    { $match: paymentMatch },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);

  // 2. Aggregate new unprocessed payments
  const unprocessedMatch = {
    ...req.regionFilter,
    status: 'new',
    createdAt: { $gte: todayStart, $lte: todayEnd }
  };

  const unprocessedResult = await UnprocessedPayment.aggregate([
    { $match: unprocessedMatch },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);

  const completedTotal = paymentResult.length ? paymentResult[0].total : 0;
  const completedCount = paymentResult.length ? paymentResult[0].count : 0;

  const unprocessedTotal = unprocessedResult.length ? unprocessedResult[0].total : 0;
  const unprocessedCount = unprocessedResult.length ? unprocessedResult[0].count : 0;

  const grandTotal = completedTotal + unprocessedTotal;
  const grandCount = completedCount + unprocessedCount;

  res.status(200).json({
    success: true,
    data: {
      total: grandTotal,
      count: grandCount,
      breakdown: {
        completed: { total: completedTotal, count: completedCount },
        unprocessed: { total: unprocessedTotal, count: unprocessedCount }
      },
      date: todayStart.toISOString().split('T')[0]
    }
  });
});

// @desc    Get online customers count (from RADIUS active sessions, region‑aware)
// @route   GET /api/dashboard/online-customers
// @access  Private

// controllers/dashboardController.js - FIXED getOnlineCustomersCount

// @desc    Get online customers count (TRUE online with internet, not just RADIUS sessions)
// @route   GET /api/dashboard/online-customers
// @access  Private
exports.getOnlineCustomersCount = asyncHandler(async (req, res, next) => {
  const regionFilter = req.regionFilter;
  
  // OPTION 1: Fast but potentially inaccurate - uses cached connectionStatus
  // This reads from the database cache that gets updated when customers are viewed
  const onlineFromCache = await Customer.countDocuments({
    ...regionFilter,
    'connectionStatus.status': 'online' // Only truly online customers
  });

  // OPTION 2: Accurate but slower - checks RADIUS in real-time
  // Use this for accurate count by checking all customers against RADIUS
  
  // Fetch ALL customers in the region
  const allCustomers = await Customer.find(regionFilter)
    .select('pppoe.username pppoe.siteIp')
    .lean();

  if (allCustomers.length === 0) {
    return res.status(200).json({
      success: true,
      data: 0
    });
  }

  // Prepare for bulk RADIUS check
  const usernames = allCustomers.map(c => c.pppoe.username);
  const expectedNasIpMap = {};
  for (const c of allCustomers) {
    if (c.pppoe.siteIp) {
      expectedNasIpMap[c.pppoe.username] = c.pppoe.siteIp;
    }
  }

  console.log(`[ONLINE COUNT] Checking ${usernames.length} customers against RADIUS...`);

  // Check real-time connectivity for all customers
  const radiusService = require('../services/radiusService');
  const statuses = await radiusService.getBulkUserConnectionStatus(usernames, expectedNasIpMap);

  // Count only customers who are TRULY online (not online-no-internet)
  let trueOnlineCount = 0;
  for (const username of usernames) {
    const s = statuses[username];
    if (s && s.isOnline) {
      trueOnlineCount++;
    }
  }

  console.log(`[ONLINE COUNT] Result: ${trueOnlineCount} customers truly online (with internet)`);

  res.status(200).json({
    success: true,
    data: trueOnlineCount
  });
});


// ALTERNATIVE OPTION 3: Fast and reasonably accurate - sample-based estimation
// Use this if you have too many customers and Option 2 is too slow
exports.getOnlineCustomersCountFast = asyncHandler(async (req, res, next) => {
  const regionFilter = req.regionFilter;
  const radiusService = require('../services/radiusService');

  // Get total customers count
  const totalCustomers = await Customer.countDocuments(regionFilter);

  if (totalCustomers === 0) {
    return res.status(200).json({ success: true, data: 0 });
  }

  // If less than 500 customers, check all of them (fast enough)
  if (totalCustomers <= 500) {
    const allCustomers = await Customer.find(regionFilter)
      .select('pppoe.username pppoe.siteIp')
      .lean();

    const usernames = allCustomers.map(c => c.pppoe.username);
    const expectedNasIpMap = {};
    for (const c of allCustomers) {
      if (c.pppoe.siteIp) expectedNasIpMap[c.pppoe.username] = c.pppoe.siteIp;
    }

    const statuses = await radiusService.getBulkUserConnectionStatus(usernames, expectedNasIpMap);

    let onlineCount = 0;
    for (const username of usernames) {
      if (statuses[username]?.isOnline) onlineCount++;
    }

    return res.status(200).json({ success: true, data: onlineCount });
  }

  // If more than 500 customers, use sampling + RADIUS session count
  // Get RADIUS active sessions count filtered by region
  const activeResult = await radiusService.getActiveSessions();
  
  if (!activeResult.success) {
    return res.status(200).json({ success: true, data: 0 });
  }

  let sessionCount = activeResult.count;
  const regionCode = regionFilter?.regionCode;

  if (regionCode && regionCode !== 'ALL' && activeResult.sessions) {
    sessionCount = activeResult.sessions.filter(s =>
      s.username && s.username.startsWith(regionCode)
    ).length;
  }

  // Sample 100 random customers to determine what % have internet vs just connection
  const sampleSize = Math.min(100, totalCustomers);
  const randomSample = await Customer.aggregate([
    { $match: regionFilter },
    { $sample: { size: sampleSize } },
    { $project: { 'pppoe.username': 1, 'pppoe.siteIp': 1 } }
  ]);

  const sampleUsernames = randomSample.map(c => c.pppoe.username);
  const sampleNasMap = {};
  for (const c of randomSample) {
    if (c.pppoe.siteIp) sampleNasMap[c.pppoe.username] = c.pppoe.siteIp;
  }

  const sampleStatuses = await radiusService.getBulkUserConnectionStatus(sampleUsernames, sampleNasMap);

  let sampleOnline = 0;
  let sampleOnlineNoInternet = 0;
  for (const username of sampleUsernames) {
    const s = sampleStatuses[username];
    if (s?.isOnline) sampleOnline++;
    else if (s?.isOnlineNoInternet) sampleOnlineNoInternet++;
  }

  // Calculate ratio of truly online vs just connected
  const totalConnected = sampleOnline + sampleOnlineNoInternet;
  const internetRatio = totalConnected > 0 ? sampleOnline / totalConnected : 1;

  // Apply ratio to session count
  const estimatedOnline = Math.round(sessionCount * internetRatio);

  console.log(`[ONLINE COUNT FAST] Sessions: ${sessionCount}, Sample: ${sampleOnline}/${totalConnected}, Estimated: ${estimatedOnline}`);

  res.status(200).json({
    success: true,
    data: estimatedOnline
  });
});

// module.exports = {
//   getDashboardOverview,
//   getRevenueChart,
//   getCustomerGrowth,
//   getPackageDistribution,
//   getRecentActivities,
//   getTopCustomers,
//   getSystemHealth
// };