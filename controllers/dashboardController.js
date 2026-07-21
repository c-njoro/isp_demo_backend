const asyncHandler = require('../middleware/asyncHandler');
const Customer = require('../models/Customer');
const HotspotUser = require('../models/HotspotUser');
const Lead = require('../models/Lead');
const Ticket = require('../models/Ticket');
const Transaction = require('../models/Transaction');
const Payment = require('../models/Payment');
const UnprocessedPayment = require('../models/UnprocessedPayment');
const { ErrorResponse } = require('../middleware/errorHandler');



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
  const activeCustomers = await Customer.countDocuments({
    ...regionFilter,
    isActive: true,
    'subscription.status': { $in: ['active', 'suspended'] }
  });
  const expiredCustomers = await Customer.countDocuments({
    ...regionFilter,
    isActive: true,
    'subscription.status': 'expired'
  });
  const disabledCustomers = await Customer.countDocuments({
    ...regionFilter,
    isActive: false
  });

  // Revenue by site (from completed payments)
  const revenueBySite = await Payment.aggregate([
    {
      $match: {
        ...regionFilter,
        status: 'completed',
        ...dateFilter,
        siteId: { $exists: true, $ne: null }
      }
    },
    {
      $group: {
        _id: '$siteId',
        revenue: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    {
      $lookup: {
        from: 'sites',
        localField: '_id',
        foreignField: '_id',
        as: 'site'
      }
    },
    { $unwind: { path: '$site', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        siteId: '$_id',
        siteName: { $ifNull: ['$site.name', 'Unknown'] },
        revenue: 1,
        count: 1
      }
    },
    { $sort: { revenue: -1 } }
  ]);

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
        _id: {
          siteId: '$siteId',
          siteName: { $ifNull: ['$site.name', 'Unknown'] }
        },
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ['$status', ['initiated', 'pending']] }, 1, 0] } }
      }
    },
    { $sort: { total: -1 } }
  ]);

  const overallRevenue = revenueBySite.reduce((sum, item) => sum + item.revenue, 0);
  const totalTransactions = revenueBySite.reduce((sum, item) => sum + item.count, 0);

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

  // Tickets and leads
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
        disabled: disabledCustomers,
        expiringSoon
      },
      revenue: {
        total: overallRevenue,
        transactions: totalTransactions,
        bySite: revenueBySite.map(item => ({
          siteId: item.siteId,
          siteName: item.siteName,
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
      isActive: true,
      'subscription.expiresAt': {
        $gte: now,
        $lte: futureDate,
      },
      'isActive': 'true'
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
      isActive: true,
      'subscription.expiresAt': {
        $gte: pastDate,
        $lte: now,
      },
      'isActive': 'true'
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

/**
 * @desc    Get customers list filtered by subscription timeline (expiring soon or expired recently)
 * @route   POST /api/dashboard/customers-by-timeline
 * @access  Private
 * @body    { days: number, direction: 'future'|'past', page?: number, limit?: number }
 * @returns List of customers with accountId, name, expiryDate, balance, nasIp
 */
// At top of dashboardController.js


// Then the function
exports.getCustomersBySubscriptionTimeline = asyncHandler(async (req, res, next) => {
  let { days, direction, page = 1, limit = 20 } = req.body;
  const regionFilter = req.regionFilter;

  days = Number(days);
  if (!Number.isInteger(days) || days < 0) {
    days = Math.abs(days)
    
  }
  if (!['future', 'past'].includes(direction)) {
    return next(new ErrorResponse('Direction must be "future" or "past"', 400));
  }

  const now = new Date();
  let dateFilter = {};

  if (direction === 'future') {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);
    dateFilter = {
      isActive: true,
      'subscription.status': 'active',
      'subscription.expiresAt': {
        $gte: now,
        $lte: futureDate,
      },
      'isActive': 'true'
    };
  } else { // past
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - days);
    dateFilter = {
      isActive: true,                        // must be active record
      'subscription.status': 'expired',      // must CURRENTLY be expired (not renewed)
      'subscription.expiresAt': {
        $gte: pastDate,
        $lte: now,
      },
      'isActive': 'true'
    };
  }

  const query = { ...regionFilter, ...dateFilter };
  const total = await Customer.countDocuments(query);

  const customers = await Customer.find(query)
    .select('_id accountId firstName lastName subscription.expiresAt billing.balance pppoe.siteIp nasIp phoneNumber')
    .lean()
    .sort({ 'subscription.expiresAt': direction === 'future' ? 1 : -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const customerList = customers.map(c => ({
    _id: c._id,
    accountId: c.accountId,
    name: `${c.firstName} ${c.lastName}`,
    expiryDate: c.subscription.expiresAt,
    balance: c.billing?.balance || 0,
    nasIp: c.pppoe?.siteIp || c.nasIp || null,
    phone: c.phoneNumber || 'N/A',
  }));

  res.status(200).json({
    success: true,
    data: {
      customers: customerList,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit),
      },
      direction,
      days,
    },
  });
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
  const { days = 1 } = req.query;
  const daysNum = parseInt(days, 10);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysNum);

  // 1. Payment success rate
  const totalPayments = await Payment.countDocuments({
    createdAt: { $gte: startDate },
  });
  const successfulPayments = await Payment.countDocuments({
    createdAt: { $gte: startDate },
    status: 'completed'
  });
  const paymentSuccessRate = totalPayments > 0
    ? Math.round((successfulPayments / totalPayments) * 100)
    : 0;

  // 2. Active sessions (all regions)
  const allCustomers = await Customer.find({ isActive: true })
    .select('pppoe.username pppoe.siteIp')
    .lean();

  let activeSessionCount = 0;
  if (allCustomers.length > 0) {
    const usernames = allCustomers.map(c => c.pppoe.username).filter(Boolean);
    const expectedNasIpMap = {};
    for (const c of allCustomers) {
      if (c.pppoe.siteIp) expectedNasIpMap[c.pppoe.username] = c.pppoe.siteIp;
    }
    const radiusService = require('../services/radiusService');
    const statuses = await radiusService.getBulkUserConnectionStatus(usernames, expectedNasIpMap);
    for (const username of usernames) {
      const s = statuses[username];
      if (s && (s.isOnline || s.isOnlineNoInternet)) {
        activeSessionCount++;
      }
    }
  }

  // 3. SLA compliance
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

  // 4. Pending issues
  const pendingPayments = await UnprocessedPayment.countDocuments({
    status: { $in: ['new'] }
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
      activeSessions: activeSessionCount,
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
// In your controller file (e.g., customerController.js or dashboardController.js)



/**
 * Get online counts for PPPoE customers and Hotspot users within the region.
 * Returns:
 *   {
 *     success: true,
 *     data: {
 *       pppoeOnline: number,
 *       hotspotOnline: number,
 *       totalOnline: number
 *     }
 *   }
 */
exports.getOnlineCustomersCount = asyncHandler(async (req, res, next) => {
  const regionFilter = req.regionFilter; // e.g., { regionCode: 'SKY' }

  const radiusService = require("../services/radiusService");

  // ============================================
  // 1. PPPoE online count (existing logic)
  // ============================================
  const allCustomers = await Customer.find(regionFilter)
    .select('pppoe.username')
    .lean();

  let pppoeOnline = 0;
  if (allCustomers.length > 0) {
    const usernames = allCustomers.map(c => c.pppoe.username);
    const statuses = await radiusService.getBulkUserConnectionStatus(usernames);

    for (const username of usernames) {
      const s = statuses[username];
      // count online OR online-no-internet (both indicate an active session)
      if (s && (s.isOnline || s.isOnlineNoInternet)) {
        pppoeOnline++;
      }
    }
  }

  // ============================================
  // 2. Hotspot online count
  // ============================================
  const allHotspotUsers = await HotspotUser.find(regionFilter)
    .select('macAddress')
    .lean();

  let hotspotOnline = 0;
  if (allHotspotUsers.length > 0) {
    const macAddresses = allHotspotUsers
      .map(h => h.macAddress)
      .filter(mac => mac && mac.trim().length > 0); // filter out invalid MACs

    if (macAddresses.length > 0) {
      // getBulkHotspotSessions returns a map: mac -> { isOnline, ... }
      const sessionsMap = await radiusService.getBulkHotspotSessions(macAddresses);
      for (const mac of macAddresses) {
        const session = sessionsMap[mac];
        if (session && session.isOnline) {
          hotspotOnline++;
        }
      }
    }
  }

  // ============================================
  // 3. Response
  // ============================================
  res.status(200).json({
    success: true,
    data: {
      pppoeOnline,
      hotspotOnline,
      totalOnline: pppoeOnline + hotspotOnline
    }
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


// Add these new methods to your dashboardController.js

/**
 * @desc    Get count of customers by subscription date range
 * @route   POST /api/dashboard/subscriptions-by-date-range
 * @access  Private
 * @body    { startDate: string, endDate: string }
 * @returns Count of customers and range type (past/future)
 */
exports.getCustomersSubscriptionsByDateRange = asyncHandler(async (req, res, next) => {
  const { startDate, endDate } = req.body;
  const regionFilter = req.regionFilter;

  // Validate dates
  if (!startDate || !endDate) {
    return next(new ErrorResponse('Both startDate and endDate are required', 400));
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();

  // Reset time to midnight for accurate comparison
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  // Validate date range
  if (start > end) {
    return next(new ErrorResponse('Start date cannot be after end date', 400));
  }

  // Determine if range is in past or future
  let rangeType;
  let count;

  if (end <= now) {
    // Both dates are in the past (or today) - search for expired customers
    rangeType = 'past';
    
    count = await Customer.countDocuments({
      ...regionFilter,
      'subscription.status': 'expired',
      'subscription.expiresAt': {
        $gte: start,
        $lte: end,
      },
      'isActive': 'true'
    });
  } else if (start > now) {
    // Both dates are in the future - search for active customers expiring in this range
    rangeType = 'future';
    
    count = await Customer.countDocuments({
      ...regionFilter,
      'subscription.status': 'active',
      'subscription.expiresAt': {
        $gte: start,
        $lte: end,
      },
      'isActive': 'true'
    });
  } else {
    // Invalid: one date in past, one in future
    return next(new ErrorResponse('Both dates must be either in the past or future. Cannot mix time periods.', 400));
  }

  res.status(200).json({
    success: true,
    data: {
      startDate,
      endDate,
      count,
      type: rangeType,
    },
  });
});

/**
 * @desc    Get customers list filtered by subscription date range
 * @route   POST /api/dashboard/customers-by-date-range
 * @access  Private
 * @body    { startDate: string, endDate: string, page?: number, limit?: number }
 * @returns List of customers with accountId, name, phone, expiryDate, balance, nasIp
 */
exports.getCustomersBySubscriptionDateRange = asyncHandler(async (req, res, next) => {
  const { startDate, endDate, page = 1, limit = 20 } = req.body;
  const regionFilter = req.regionFilter;

  // Validate dates
  if (!startDate || !endDate) {
    return next(new ErrorResponse('Both startDate and endDate are required', 400));
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();

  // Reset time
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  if (start > end) {
    return next(new ErrorResponse('Start date cannot be after end date', 400));
  }

  // Determine search criteria based on date range type
  let searchCriteria;
  let rangeType;

  if (end <= now) {
    // Past: search expired customers
    rangeType = 'past';
    searchCriteria = {
      ...regionFilter,
      'subscription.status': 'expired',
      'subscription.expiresAt': {
        $gte: start,
        $lte: end,
      },
      'isActive': 'true'
    };
  } else if (start > now) {
    // Future: search active customers
    rangeType = 'future';
    searchCriteria = {
      ...regionFilter,
      'subscription.status': 'active',
      'subscription.expiresAt': {
        $gte: start,
        $lte: end,
      },
      'isActive': 'true'
    };
  } else {
    return next(new ErrorResponse('Both dates must be either in the past or future', 400));
  }

  // Pagination
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  // Fetch customers
  const customers = await Customer.find(searchCriteria)
    .select('accountId firstName lastName phoneNumber subscription.expiresAt billing.balance pppoe.siteIp')
    .skip(skip)
    .limit(limitNum)
    .sort({ 'subscription.expiresAt': 1 }) // Sort by expiry date ascending
    .lean();

  // Get total count for pagination
  const total = await Customer.countDocuments(searchCriteria);
  const pages = Math.ceil(total / limitNum);

  // Format response
  const formattedCustomers = customers.map((c) => ({
    _id: c._id.toString(),
    accountId: c.accountId,
    name: `${c.firstName} ${c.lastName}`,
    phone: c.phoneNumber || 'N/A',
    expiryDate: c.subscription.expiresAt,
    balance: c.billing.balance || 0,
    nasIp: c.pppoe?.siteIp || null,
  }));

  res.status(200).json({
    success: true,
    data: {
      customers: formattedCustomers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages,
      },
      dateRange: {
        startDate,
        endDate,
        type: rangeType,
      },
    },
  });
});  

/**
 * @desc    Get network-wide data usage analytics
 * @route   GET /api/dashboard/usage-analytics
 * @access  Private (Admin)
 * @query   dateFrom, dateTo, targetDate, limit
 */
exports.getUsageAnalytics = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo, targetDate, limit = 10 } = req.query;

  const radiusService = require('../services/radiusService');
  const result = await radiusService.getUsageAnalytics({
    dateFrom:   dateFrom   || null,
    dateTo:     dateTo     || null,
    targetDate: targetDate || null,
    limit:      parseInt(limit)
  });

  if (!result.success) return next(new ErrorResponse(result.error, 500));

  // Enrich top users with customer names from MongoDB
  const allUsernames = [
    ...result.topUsersPeriod,
    ...result.topUsersToday,
    ...result.topUsersMonth,
    ...result.peakDays
  ].map(u => u.username);

  const uniqueUsernames = [...new Set(allUsernames)];

  const customers = await Customer.find({
    'pppoe.username': { $in: uniqueUsernames },
    ...req.regionFilter
  })
  .select('firstName lastName accountId pppoe.username')
  .lean();

  const nameMap = {};
  customers.forEach(c => {
    nameMap[c.pppoe.username] = {
      name:      `${c.firstName} ${c.lastName}`,
      accountId: c.accountId
    };
  });

  // Attach customer info to each list
  const enrich = (list) => list.map(u => ({
    ...u,
    customerName: nameMap[u.username]?.name      || u.username,
    accountId:    nameMap[u.username]?.accountId || null
  }));

  res.status(200).json({
    success: true,
    period:          result.period,
    summary:         result.summary,
    topUsersPeriod:  enrich(result.topUsersPeriod),
    topUsersToday:   enrich(result.topUsersToday),
    topUsersMonth:   enrich(result.topUsersMonth),
    peakDays:        enrich(result.peakDays),
    networkDaily:    result.networkDaily
  });
});

/**
 * @desc    Get single customer usage summary for dashboard widget
 * @route   GET /api/dashboard/customer-usage/:username
 * @access  Private (Admin)
 * @query   days
 */
exports.getCustomerUsageSummary = asyncHandler(async (req, res, next) => {
  const { username } = req.params;
  const { days = 30 } = req.query;

  const radiusService = require('../services/radiusService');
  const result = await radiusService.getCustomerDailyUsage(username, {
    days: parseInt(days)
  });

  if (!result.success) return next(new ErrorResponse(result.error, 500));

  res.status(200).json({
    success: true,
    summary: result.summary,
    data:    result.data
  });
});

// Export these functions in your module.exports at the bottom of the file

// module.exports = {
//   getDashboardOverview,
//   getRevenueChart,
//   getCustomerGrowth,
//   getPackageDistribution,
//   getRecentActivities,
//   getTopCustomers,
//   getSystemHealth
// };