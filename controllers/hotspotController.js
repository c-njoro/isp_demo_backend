// controllers/hotspotController.js
const asyncHandler = require("../middleware/asyncHandler");
const { ErrorResponse } = require("../middleware/errorHandler");
const HotspotUser = require("../models/HotspotUser");
const Package = require("../models/Package");
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
 * @desc    Get all hotspot users (with filters)
 * @route   GET /api/hotspot
 * @access  Private
 */
exports.getHotspotUsers = asyncHandler(async (req, res, next) => {
  const { status, siteId, search } = req.query;
  const filter = {};
  if (siteId) filter.siteId = siteId;
  if (status === 'active') filter['activeSession.isActive'] = true;
  else if (status === 'expired') filter['activeSession.expiresAt'] = { $lt: new Date() };
  if (search) {
    filter.$or = [
      { macAddress: { $regex: search, $options: 'i' } },
      { 'radius.username': { $regex: search, $options: 'i' } }
    ];
  }

  const users = await HotspotUser.find(filter)
    .populate('activeSession.packageId siteId')
    .sort({ createdAt: -1 });

  res.json({ success: true, count: users.length, data: users });
});

/**
 * @desc    Get single hotspot user
 * @route   GET /api/hotspot/:id
 * @access  Private
 */
exports.getHotspotUser = asyncHandler(async (req, res, next) => {
  const user = await HotspotUser.findById(req.params.id)
    .populate('activeSession.packageId siteId');
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));
  res.json({ success: true, data: user });
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
 * @desc    Delete hotspot user
 * @route   DELETE /api/hotspot/:id
 * @access  Private
 */
exports.deleteHotspotUser = asyncHandler(async (req, res, next) => {
  const user = await HotspotUser.findById(req.params.id);
  if (!user) return next(new ErrorResponse("Hotspot user not found", 404));
  await radiusService.deleteHotspotAccount(user.macAddress);
  await user.remove();
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
  const onlineStatus = await radiusService.isHotspotUserOnline(user.macAddress);
  const usageData = await radiusService.getHotspotUsage(user.macAddress);
  res.json({ success: true, data: { onlineStatus, usage: usageData } });
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