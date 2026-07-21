// controllers/hotspotController.js
const asyncHandler = require("../middleware/asyncHandler");
const { ErrorResponse } = require("../middleware/errorHandler");
const HotspotUser = require("../models/HotspotUser");
const Package = require("../models/Package");
const Payment = require("../models/Package");
const Site = require("../models/Site");
const radiusService = require("../services/radiusService");
const { calculatePeriodEnd } = require("../utils/invoiceHelpers");

/**
 * @desc    Create hotspot user
 * @route   POST /api/hotspot
 * @access  Private (Admin)
 */
exports.createHotspotUser = asyncHandler(async (req, res, next) => {
  const { macAddress, packageId, siteId } = req.body;
  if (!macAddress || !packageId) {
    return next(new ErrorResponse("MAC address and package ID are required", 400));
  }

  // Normalize MAC
  const normalizedMac = macAddress.toUpperCase().replace(/[:-]/g, '').replace(/(..)/g, '$1:').slice(0, 17);
  
  // Check if already exists
  const existing = await HotspotUser.findOne({ macAddress: normalizedMac });
  if (existing) {
    return next(new ErrorResponse("Hotspot user already exists for this MAC", 400));
  }

  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) return next(new ErrorResponse("Package not found", 404));
  const site = await Site.findById(siteId);
  if (!site) return next(new ErrorResponse("Site not found", 404));

  // Create in RADIUS
  const dataLimitMB = packageDoc.fup?.dataLimitGB ? packageDoc.fup.dataLimitGB * 1024 : null;
  const now = new Date();
  const expiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);
  const radResult = await radiusService.createHotspotAccount(
    normalizedMac,
    packageDoc.packageName.replace(/\s+/g, '_').toUpperCase(),
    dataLimitMB,
    expiry
  );
  if (!radResult.success) {
    return next(new ErrorResponse("RADIUS account creation failed: " + radResult.error, 500));
  }

  const user = await HotspotUser.create({
    macAddress: normalizedMac,
    siteId: site._id,
    regionCode: site.regionCode,
    activeSession: {
      packageId: packageDoc._id,
      startedAt: now,
      expiresAt: expiry,
      isActive: true
    },
    // store radius username inside a nested object, optional
    radius: {
      username: radResult.username,
      password: radResult.password
    }
  });

  res.status(201).json({ success: true, data: user });
});

/**
 * @desc    Get all hotspot users (with filters & pagination)
 * @route   GET /api/hotspot
 * @access  Private
 */
// controllers/hotspotController.js – optimized version with correct response format

exports.getHotspotUsers = asyncHandler(async (req, res, next) => {
  const {
    status,
    siteId,
    search,
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  // Build filter
  const filter = {};
  if (siteId) filter.siteId = siteId;
  if (status === 'active') filter['activeSession.isActive'] = true;
  else if (status === 'expired') filter['activeSession.expiresAt'] = { $lt: new Date() };
  if (search) {
    filter.$or = [
      { macAddress: { $regex: search, $options: 'i' } },
      { 'radius.username': { $regex: search, $options: 'i' } },
      { phoneNumber: { $regex: search, $options: 'i' } },
    ];
  }

  // Pagination & sorting
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const total = await HotspotUser.countDocuments(filter);

  const users = await HotspotUser.find(filter)
    .populate('activeSession.packageId', 'packageName price period periodUnit speed')
    .populate('siteId', 'siteName regionCode')
    .select('-cpe.wifiPassword -cpe.serialNumber')
    .sort(sort)
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  if (users.length === 0) {
    return res.json({
      success: true,
      count: 0,
      data: { data: [] },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  }

  // Bulk RADIUS session lookup
  const macAddresses = users.map(u => u.macAddress);
  const sessionStatuses = await radiusService.getBulkHotspotSessions(macAddresses);

  const enriched = users.map(user => {
    const session = sessionStatuses[user.macAddress] || { isOnline: false };
    return {
      ...user,
      isOnline: session.isOnline,
      sessionInfo: session.isOnline ? {
        ipAddress: session.ipAddress,
        sessionTime: session.sessionTime,
        nasIpAddress: session.nasIpAddress,
      } : null,
    };
  });

  res.json({
    success: true,
    count: enriched.length,
    data: { data: enriched },
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
  });
});

/**
 * @desc    Get single hotspot user
 * @route   GET /api/hotspot/:id
 * @access  Private
 */
exports.getHotspotUser = asyncHandler(async (req, res, next) => {
  const user = await HotspotUser.findById(req.params.id)
    .populate('activeSession.packageId')
    .populate('siteId')
    .populate('purchaseHistory.packageId');   // <-- ADD THIS LINE
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));

  const obj = user.toObject();
  
  // Get live session status
  const session = await radiusService.getHotspotSession(user.macAddress);
  obj.isOnline = session.isOnline;
  obj.sessionInfo = session.isOnline ? {
    ipAddress: session.ipAddress,
    nasIpAddress: session.nasIpAddress,
    sessionTime: session.sessionTime,
    startTime: session.startTime,
  } : null;
  
  // Get usage summary (current billing cycle)
  const username = `hs_${user.macAddress.replace(/:/g, '').toUpperCase()}`;
  const usage = await radiusService.getCustomerDailyUsage(username, { days: 30 });
  obj.usage = usage.success ? usage.summary : null;
  obj.usageData = usage.success ? usage.data : [];

  res.json({ success: true, data: obj });
});


/**
 * @desc    Update hotspot user (e.g., change package)
 * @route   PUT /api/hotspot/:id
 * @access  Private
 */
exports.updateHotspotUser = asyncHandler(async (req, res, next) => {
  const user = await HotspotUser.findById(req.params.id);
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));
  
  const { packageId, siteId, status } = req.body;
  if (packageId) {
    const packageDoc = await Package.findById(packageId);
    if (!packageDoc) return next(new ErrorResponse("Package not found", 404));
    user.activeSession.packageId = packageDoc._id;
    // Update RADIUS group
    await radiusService.updateHotspotPackage(user.macAddress, packageDoc.packageName.replace(/\s+/g, '_').toUpperCase());
  }
  if (siteId) user.siteId = siteId;
  if (status) {
    if (status === 'active') {
      user.activeSession.isActive = true;
      user.activeSession.expiresAt = calculatePeriodEnd(new Date(), user.activeSession.packageId?.period || 30, 'd');
    } else if (status === 'expired') {
      user.activeSession.isActive = false;
      user.activeSession.expiresAt = new Date(); // force expire now
      await radiusService.disableAccount(user.radius?.username || `hs_${user.macAddress}`);
    }
  }
  await user.save();
  res.json({ success: true, data: user });
});


/**
 * @desc    Get single hotspot user with full details and live status
 * @route   GET /api/hotspot/:id/detail
 * @access  Private (Admin)
 */
exports.getHotspotUserDetail = asyncHandler(async (req, res, next) => {
  const user = await HotspotUser.findById(req.params.id)
    .populate('activeSession.packageId')
    .populate('siteId');
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));

  const obj = user.toObject();
  
  // Get live session status
  const session = await radiusService.getHotspotSession(user.macAddress);
  obj.isOnline = session.isOnline;
  obj.sessionInfo = session.isOnline ? {
    ipAddress: session.ipAddress,
    nasIpAddress: session.nasIpAddress,
    sessionTime: session.sessionTime,
    startTime: session.startTime,
  } : null;
  
  // Get usage summary (current billing cycle)
  const username = `hs_${user.macAddress.replace(/:/g, '').toUpperCase()}`;
  const usage = await radiusService.getCustomerDailyUsage(username, { days: 30 });
  obj.usage = usage.success ? usage.summary : null;
  obj.usageData = usage.success ? usage.data : [];

  res.json({ success: true, data: obj });
});

/**
 * @desc    Get daily usage chart data for a hotspot user
 * @route   GET /api/hotspot/:id/usage
 * @query   days, dateFrom, dateTo
 * @access  Private (Admin)
 */
exports.getHotspotUserUsage = asyncHandler(async (req, res, next) => {
  const user = await HotspotUser.findById(req.params.id);
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));

  const { days, dateFrom, dateTo } = req.query;
  const username = `hs_${user.macAddress.replace(/:/g, '').toUpperCase()}`;
  const result = await radiusService.getCustomerDailyUsage(username, {
    days: days ? parseInt(days) : 30,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
  });
  if (!result.success) return next(new ErrorResponse(result.error, 500));
  res.json({ success: true, data: result });
});

/**
 * @desc    Delete hotspot user
 * @route   DELETE /api/hotspot/:id
 * @access  Private
 */
exports.deleteHotspotUser = asyncHandler(async (req, res, next) => {
  const user = await HotspotUser.findById(req.params.id);
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));
  await radiusService.deleteHotspotAccount(user.macAddress);
  await user.deleteOne();
  res.json({ success: true, message: "Hotspot user deleted" });
});

/**
 * @desc    Check hotspot user online status & usage
 * @route   GET /api/hotspot/:id/status
 * @access  Private
 */
exports.getHotspotStatus = asyncHandler(async (req, res, next) => {
  const user = await HotspotUser.findById(req.params.id);
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));

  // Single RADIUS query — checks radacct for an open session (acctstoptime IS NULL)
  const session = await radiusService.getHotspotSession(user.macAddress);

  res.json({
    success: true,
    data: {
      onlineStatus: session.isOnline,
      sessionInfo:  session.isOnline ? {
        ipAddress:    session.ipAddress,
        nasIpAddress: session.nasIpAddress,
        sessionTime:  session.sessionTime,
      } : null,
      usage: {
        downloadMB:  session.downloadMB  || 0,
        uploadMB:    session.uploadMB    || 0,
        totalMB:     session.totalMB     || 0,
        sessionTime: session.sessionTime || 'N/A',
      },
    },
  });
});



/**
 * @desc    Get payment history for a hotspot user
 * @route   GET /api/hotspot/:id/payments
 * @access  Private
 */
/**
 * @desc    Get payment history for a hotspot user
 * @route   GET /api/hotspot/:id/payments
 * @access  Private
 */
exports.getHotspotUserPayments = asyncHandler(async (req, res, next) => {

  
  const user = await HotspotUser.findById(req.params.id);
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));

  // Generate the expected accountId format: HOTSPOT-<MAC without colons>
  const normalizedMac = user.macAddress.replace(/:/g, '').toUpperCase();
  const accountId = `HOTSPOT-${normalizedMac}`;

  console.log("ACCOUNT ID: ", accountId)

  const payments = await Payment.find({
    accountId: accountId,
  })
  .populate('packageId', 'packageName price')
  .sort({ createdAt: -1 });

  res.json({ success: true, data: payments });
});


/**
 * @desc    Disconnect hotspot user (force logout)
 * @route   POST /api/hotspot/:id/disconnect
 * @access  Private
 */
exports.disconnectHotspotUser = asyncHandler(async (req, res, next) => {
  const user = await HotspotUser.findById(req.params.id);
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));
  const result = await radiusService.disconnectHotspotUser(user.macAddress);
  res.json({ success: true, data: result });
});


/**
 * @desc    Get hotspot user usage since activation (current session)
 * @route   GET /api/hotspot/:id/usage-since-activation
 * @access  Private
 */
exports.getHotspotUsageSinceActivation = asyncHandler(async (req, res, next) => {
  const user = await HotspotUser.findById(req.params.id);
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));

  // Check if user has an active session
  if (!user.activeSession?.isActive) {
    return next(new ErrorResponse("User does not have an active session", 400));
  }

  const startedAt = user.activeSession.startedAt;
  if (!startedAt) {
    return next(new ErrorResponse("Active session has no start date", 400));
  }

  const username = `hs_${user.macAddress.replace(/:/g, '').toUpperCase()}`;
  const now = new Date();

  // Fetch usage from startedAt to now
  const usageResult = await radiusService.getUserUsageStats(username, startedAt, now);

  if (!usageResult.success) {
    return next(new ErrorResponse("Failed to fetch usage: " + usageResult.error, 500));
  }

  res.json({
    success: true,
    data: {
      from: startedAt,
      to: now,
      ...usageResult,
    },
  });
});