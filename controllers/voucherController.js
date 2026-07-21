const crypto = require('crypto');
const Voucher = require('../models/Voucher');
const Package = require('../models/Package');
const { ErrorResponse } = require('../middleware/errorHandler');
const asyncHandler = require('../middleware/asyncHandler');
const radiusService = require('../services/radiusService');
const SystemLog = require('../models/SystemLog');
const HotspotUser = require('../models/HotspotUser');
const Router = require('../models/Router');
const Site = require('../models/Site');

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate N unique codes with a given prefix.
 * Format: PREFIX-XXXXXXXX  (8 random uppercase alphanumeric chars)
 */
function generateCodes(prefix, count) {
  const codes = new Set();
  while (codes.size < count) {
    const random = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
    codes.add(`${prefix}-${random}`);
  }
  return [...codes].map((code) => ({ code, used: false }));
}

/** Get router + site from NAS IP */
async function getRouterAndSiteByNasIp(nasIp) {
  const router = await Router.findOne({ ip: nasIp });
  if (!router) throw new Error('Router not found for this NAS IP');
  const site = await Site.findById(router.site);
  if (!site) throw new Error('Site not found for this router');
  return { router, site };
}


function randomPrefix(length = 4) {
  return Array.from(
    { length },
    () => String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
}


// ─── CREATE VOUCHER BATCH ─────────────────────────────────────────────────────
// POST /api/vouchers
// Body: { prefix, count, packageId, description }
// ------------------------------------------------------------------------------
exports.createVoucher = asyncHandler(async (req, res, next) => {
  const { count, packageId, description } = req.body;

  if ( !count || !packageId) {
    return next(new ErrorResponse('prefix, count and packageId are required', 400));
  }

  const prefix = randomPrefix();
  const normalizedPrefix = prefix.toUpperCase().replace(/\s+/g, '');

  // Validate package
  const pkg = await Package.findById(packageId);
  if (!pkg) {
    return next(new ErrorResponse('Package not found', 404));
  }

  const numCodes = parseInt(count, 10);
  if (isNaN(numCodes) || numCodes < 1 || numCodes > 500) {
    return next(new ErrorResponse('count must be between 1 and 500', 400));
  }

  const codes = generateCodes(normalizedPrefix, numCodes);

  const voucher = await Voucher.create({
    prefix: normalizedPrefix,
    packageId,
    description: description || '',
    codes,
    createdBy: req.user?._id || null,
  });

  await SystemLog.create({
    eventType: 'voucher_created',
    severity: 'info',
    regionCode: req.regionFilter?.regionCode,
    entityType: 'voucher',
    entityId: voucher._id,
    message: `Voucher batch ${normalizedPrefix} created with ${numCodes} codes for package ${pkg.packageName}`,
    success: true,
  });

  res.status(201).json({ success: true, data: voucher });
});

// ─── GET ALL VOUCHER BATCHES ──────────────────────────────────────────────────
// GET /api/vouchers?page=1&limit=20&prefix=...
// ------------------------------------------------------------------------------
exports.getVouchers = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, prefix, packageId, includeBonus = 'false' } = req.query;

  const filter = {};

  // Prefix filter
  if (prefix) {
    filter.prefix = { $regex: prefix, $options: 'i' };
  }

  // Package filter
  if (packageId) {
    filter.packageId = packageId;
  }

  // Bonus filtering: exclude vouchers with hyphen in prefix unless includeBonus is 'true'
  if (includeBonus !== 'true') {
    filter.prefix = { ...filter.prefix, $not: /-/ };
  }

  const total = await Voucher.countDocuments(filter);
  const vouchers = await Voucher.find(filter)
    .populate('packageId', 'packageName price period periodUnit')
    .sort({ createdAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit));

  res.status(200).json({
    success: true,
    data: vouchers,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
  });
});

// ─── GET SINGLE VOUCHER BATCH ─────────────────────────────────────────────────
// GET /api/vouchers/:id
// ------------------------------------------------------------------------------
exports.getVoucherById = asyncHandler(async (req, res, next) => {
  const voucher = await Voucher.findById(req.params.id).populate('packageId');
  if (!voucher) return next(new ErrorResponse('Voucher not found', 404));
  res.status(200).json({ success: true, data: voucher });
});

// ─── DELETE VOUCHER BATCH ─────────────────────────────────────────────────────
// DELETE /api/vouchers/:id  (only if no codes have been used yet)
// ------------------------------------------------------------------------------
exports.deleteVoucher = asyncHandler(async (req, res, next) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) return next(new ErrorResponse('Voucher not found', 404));

  const usedCount = voucher.codes.filter((c) => c.used).length;
  if (usedCount > 0) {
    return next(new ErrorResponse(`Cannot delete — ${usedCount} code(s) have already been used`, 400));
  }

  await voucher.deleteOne();

  await SystemLog.create({
    eventType: 'voucher_deleted',
    severity: 'info',
    entityType: 'voucher',
    entityId: voucher._id,
    message: `Voucher batch ${voucher.prefix} deleted`,
    success: true,
  });

  res.status(200).json({ success: true, message: 'Voucher batch deleted' });
});

// ─── REDEEM VOUCHER ───────────────────────────────────────────────────────────
// POST /api/vouchers/redeem
// Body: { code, macAddress, nasIp }
// Logic: find batch that owns this exact code and it is not used yet, then activate
// ------------------------------------------------------------------------------
exports.redeemVoucher = asyncHandler(async (req, res, next) => {
  const { code, macAddress, nasIp } = req.body;
  if (!code || !macAddress || !nasIp) {
    return next(new ErrorResponse('code, macAddress and nasIp are required', 400));
  }

  const normalizedCode = code.toUpperCase().trim();
  const normalizedMac = macAddress.toUpperCase();
  const now = new Date();

  // 1. Atomically mark the code as used — only if it exists and is not yet used
  const voucher = await Voucher.findOneAndUpdate(
    {
      'codes.code': normalizedCode,
      'codes': { $elemMatch: { code: normalizedCode, used: false } },
    },
    {
      $set: {
        'codes.$[slot].used': true,
        'codes.$[slot].usedAt': now,
        'codes.$[slot].usedByMac': normalizedMac,
      },
    },
    {
      arrayFilters: [{ 'slot.code': normalizedCode, 'slot.used': false }],
      new: true,
    }
  ).populate('packageId');

  if (!voucher) {
    // Distinguish "code not found" from "code already used" for a better UX message
    const exists = await Voucher.findOne({ 'codes.code': normalizedCode });
    if (!exists) {
      return next(new ErrorResponse('Invalid voucher code', 404));
    }
    return next(new ErrorResponse('This voucher code has already been used', 400));
  }

  const packageDoc = voucher.packageId;
  if (!packageDoc) {
    // Roll back — flip used back to false
    await Voucher.findOneAndUpdate(
      { 'codes.code': normalizedCode },
      { $set: { 'codes.$[slot].used': false, 'codes.$[slot].usedAt': null, 'codes.$[slot].usedByMac': null } },
      { arrayFilters: [{ 'slot.code': normalizedCode }] }
    );
    return next(new ErrorResponse('Voucher has no valid package linked', 500));
  }

  // 2. Get router & site from NAS IP
  let site, router;
  try {
    const result = await getRouterAndSiteByNasIp(nasIp);
    router = result.router;
    site = result.site;
  } catch (err) {
    return next(new ErrorResponse(err.message, 400));
  }

  // 3. Build expiry from package period
  const expiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);


  // 4. Find or create HotspotUser
  let hotspotUser = await HotspotUser.findOne({ macAddress: normalizedMac });
  const isNewUser = !hotspotUser;

  if (isNewUser) {
    hotspotUser = await HotspotUser.create({
      macAddress: normalizedMac,
      phoneNumber: null,
      regionCode: site.regionCode,
      siteId: site._id,
      isOnline: false,
      activeSession: { isActive: false },
    });
    console.log(`🆕 New hotspot user created for MAC ${normalizedMac}`);
  }

  // 5. Update HotspotUser session
  hotspotUser.activeSession = {
    packageId: packageDoc._id,
    startedAt: now,
    expiresAt: expiry,
    isActive: true,
    dataLimit: packageDoc.dataLimit || null,
    dataUsed: 0,
  };
  hotspotUser.kickedAt = null;
  if (!hotspotUser.purchaseHistory) hotspotUser.purchaseHistory = [];
  hotspotUser.purchaseHistory.push({
    packageId: packageDoc._id,
    purchasedAt: now,
    amount: 0,
    transactionId: `VOUCHER-${normalizedCode}`,
    voucherCode: normalizedCode,
  });
  if (hotspotUser.purchaseHistory.length > 20) {
    hotspotUser.purchaseHistory = hotspotUser.purchaseHistory.slice(-20);
  }
  hotspotUser.paymentCounter = (hotspotUser.paymentCounter || 0) + 1;
  await hotspotUser.save();

  // 6. RADIUS username and group
  const username = `hs_${normalizedMac.replace(/:/g, '').toUpperCase()}`;
  const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();

  // 7. Clean up old RADIUS records
  try {
    const conn = await radiusService.getConnection();
    await conn.query('DELETE FROM radcheck WHERE username = ?', [username]);
    await conn.query('DELETE FROM radusergroup WHERE username = ?', [username]);
    await conn.query('DELETE FROM radreply WHERE username = ?', [username]);
    await conn.query('DELETE FROM user_billing_cycle WHERE username = ?', [username]);
    await conn.query('DELETE FROM radacct WHERE username = ? AND acctstoptime IS NOT NULL', [username]);
    conn.release();
    console.log(`🧹 Cleaned RADIUS records for ${username}`);
  } catch (err) {
    console.error('⚠️ RADIUS deletion error:', err.message);
  }

  // 8. Create fresh RADIUS hotspot account
  const dataLimitMB =
    packageDoc.dataLimit || (packageDoc.fup?.enabled ? packageDoc.fup.dataThresholdGB * 1024 : null);

  const radiusResult = await radiusService.createHotspotAccount(
    normalizedMac,
    groupName,
    dataLimitMB,
    expiry
  );

  if (!radiusResult.success) {
    // Roll back the code mark
    await Voucher.findOneAndUpdate(
      { 'codes.code': normalizedCode },
      { $set: { 'codes.$[slot].used': false, 'codes.$[slot].usedAt': null, 'codes.$[slot].usedByMac': null } },
      { arrayFilters: [{ 'slot.code': normalizedCode }] }
    );
    return next(new ErrorResponse('Failed to create network session. Please contact support.', 500));
  }

  // 9. Billing cycle + FUP
  await radiusService.setBillingCycleStart(username, new Date());
  if (packageDoc.fup?.enabled) {
    const quotaBytes = packageDoc.fup.dataThresholdGB * 1024 * 1024 * 1024;
    await radiusService.enableFUPForCustomer(username, quotaBytes);
  }

  // 10. Kick hotspot user so they re-auth immediately
  try {
    const mikrotikService = require('../services/mikroticService');
    await mikrotikService.kickHotspotUser({ router }, normalizedMac);
  } catch (coaErr) {
    console.warn(`CoA failed for MAC ${normalizedMac}:`, coaErr.message);
  }

  // 11. System log
  const usedTotal = voucher.codes.filter((c) => c.used).length;
  const remaining = voucher.codes.length - usedTotal;

  await SystemLog.create({
    eventType: 'voucher_redeemed',
    severity: 'info',
    regionCode: site.regionCode,
    entityType: 'hotspot_user',
    entityId: hotspotUser._id,
    accountId: normalizedMac,
    message: `Voucher ${normalizedCode} redeemed for MAC ${normalizedMac} → ${packageDoc.packageName} until ${expiry.toISOString()}`,
    details: {
      voucherCode: normalizedCode,
      voucherPrefix: voucher.prefix,
      codesRemaining: remaining,
      packageName: packageDoc.packageName,
      expiresAt: expiry,
      isNewUser,
    },
    success: true,
  });

  res.status(200).json({
    success: true,
    message: 'Voucher redeemed successfully. You are now connected.',
    data: {
      voucherCode: normalizedCode,
      expiresAt: expiry,
      packageName: packageDoc.packageName,
    },
  });
});