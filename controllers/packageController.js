const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Package = require('../models/Package');
const Site = require('../models/Site');
const Customer = require ('../models/Customer');
const HotspotUser = require ('../models/HotspotUser');
const Router = require('../models/Router');




// Helper: sync router assignments for hotspot packages
async function syncPackageRouters(packageDoc, routerIds, operation = 'create') {
  if (packageDoc.packageType !== 'hotspot') return;
  
  
  const currentRouterIds = packageDoc.applicableToRouters?.map(id => id.toString()) || [];
  const newRouterIds = routerIds?.map(id => id.toString()) || [];
  
  // Routers to add (in new but not in current)
  const toAdd = newRouterIds.filter(id => !currentRouterIds.includes(id));
  // Routers to remove (in current but not in new)
  const toRemove = currentRouterIds.filter(id => !newRouterIds.includes(id));
  
  for (const routerId of toAdd) {
    await Router.findByIdAndUpdate(routerId, {
      $addToSet: { hotspotPackages: packageDoc._id }
    });
  }
  for (const routerId of toRemove) {
    await Router.findByIdAndUpdate(routerId, {
      $pull: { hotspotPackages: packageDoc._id }
    });
  }
  
  // Update package's applicableToRouters array
  packageDoc.applicableToRouters = newRouterIds;
  await packageDoc.save();
}

// @desc    Get all packages
// @route   GET /api/packages
// @access  Private
// @desc    Get all packages (with pagination, search, price filter)
// @route   GET /api/packages
// @access  Private
exports.getPackages = asyncHandler(async (req, res, next) => {
  const {
    packageType,
    siteId,
    isActive = 'true',
    page = 1,
    limit = 13,
    search,
    minPrice,
    maxPrice,
    sortBy = 'name',
    sortOrder = 'asc'
  } = req.query;

  const query = { ...req.regionFilter };

  if (packageType) query.packageType = packageType;
  if (siteId) query.siteId = siteId;
  if (isActive !== undefined) query.isActive = isActive === 'true';

  // Search by package name or description
  if (search) {
    query.$or = [
      { packageName: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  // Price range filter
  if (minPrice !== undefined) {
    query.price = { $gte: parseFloat(minPrice) };
  }
  if (maxPrice !== undefined) {
    if (!query.price) query.price = {};
    query.price.$lte = parseFloat(maxPrice);
  }

  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitNum = parseInt(limit);

  const [packages, total] = await Promise.all([
    Package.find(query)
      .populate('siteId', 'siteName regionCode name')
      .populate('applicableToRouters', 'name ip')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Package.countDocuments(query)
  ]);

  res.status(200).json({
    success: true,
    message: 'Packages retrieved successfully',
    data: {
      packages,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    }
  });
});


// @desc    Get all packages (unpaginated) – for dropdowns and exports
// @route   GET /api/packages/all
// @access  Private
exports.getAllPackages = asyncHandler(async (req, res, next) => {
  const { siteId, packageType } = req.query;
  const query = { ...req.regionFilter };

  if (siteId) query.siteId = siteId;
  if (packageType) query.packageType = packageType;

  // Only active packages by default – you can pass ?isActive=false if needed
  query.isActive = true;

  const packages = await Package.find(query)
    .populate('siteId', 'siteName regionCode name')
    .populate('applicableToRouters', 'name ip')
    .sort({ packageName: 1 })
    .lean();

  res.status(200).json({
    success: true,
    message: 'All packages retrieved successfully',
    data: { packages }
  });
});


// @desc    Get single package
// @route   GET /api/packages/:id
// @access  Private
exports.getPackage = asyncHandler(async (req, res, next) => {
  const packageDoc = await Package.findById(req.params.id).populate('siteId', 'siteName regionCode name').populate('applicableToRouters', 'name ip');

  if (!packageDoc) {
    return next(new ErrorResponse('Package not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && packageDoc.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this package', 403));
  }

  res.status(200).json({
    success: true,
    message: 'Package retrieved successfully',
    data: packageDoc
  });
});

// @desc    Get customer stats for a package (PPPoE or Hotspot)
// @route   GET /api/packages/:id/customers
// @access  Private
exports.getPackageCustomers = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const packageDoc = await Package.findById(id);
  if (!packageDoc) {
    return next(new ErrorResponse('Package not found', 404));
  }

  let totalCustomers = 0;
  let activeCustomers = 0;
  let expiredCustomers = 0;
  let suspendedCustomers = 0;

  if (packageDoc.packageType === 'ppp') {
    // ── PPPoE customers ──
    const customers = await Customer.find({ 'subscription.packageId': id });
    totalCustomers = customers.length;
    activeCustomers = customers.filter(c => c.subscription.status === 'active').length;
    expiredCustomers = customers.filter(c => c.subscription.status === 'expired').length;
    suspendedCustomers = customers.filter(c => c.subscription.status === 'suspended').length;
  } else {
    // ── Hotspot users ──
    const hotspotUsers = await HotspotUser.find({ 'activeSession.packageId': id });
    totalCustomers = hotspotUsers.length;
    const now = new Date();
    activeCustomers = hotspotUsers.filter(h =>
      h.activeSession?.isActive === true &&
      h.activeSession?.expiresAt &&
      new Date(h.activeSession.expiresAt) > now
    ).length;
    expiredCustomers = hotspotUsers.filter(h =>
      h.activeSession?.isActive === true &&
      h.activeSession?.expiresAt &&
      new Date(h.activeSession.expiresAt) <= now
    ).length;
    // Suspended not applicable for hotspot
    suspendedCustomers = 0;
  }

  res.status(200).json({
    success: true,
    message: 'Package customers retrieved successfully',
    data: {
      totalCustomers,
      activeCustomers,
      expiredCustomers,
      suspendedCustomers
    }
  });
});

// @desc    Create package
// @route   POST /api/packages
// @access  Private
exports.createPackage = asyncHandler(async (req, res, next) => {
  const {
    packageName,
    packageType,
    siteId,
    speed,
    price,
    period,
    periodUnit,
    dataLimit,
    description,
    priority,
    fup,
    applicableToRouters 
  } = req.body;

  // Validate required fields
  if (!packageName || !packageType || !siteId || !price || !period) {
    return next(new ErrorResponse('Please provide all required fields', 400));
  }

  // Verify site exists
  const site = await Site.findById(siteId);
  if (!site) {
    return next(new ErrorResponse('Site not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && site.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this site', 403));
  }

  const packageDoc = await Package.create({
    packageName,
    packageType,
    regionCode: site.regionCode,
    siteId,
    speed: speed || { download: 0, upload: 0 },
    price,
    period,
    periodUnit: periodUnit || 'm',
    dataLimit: dataLimit || 0,
    description,
    priority: priority || 1,
    fup: fup || { enabled: false, dataThresholdGB: 0, throttleDownloadMbps: 1, throttleUploadMbps: 1, resetPeriod: 'monthly' }
  });

  if (packageType === 'hotspot' && applicableToRouters?.length) {
    await syncPackageRouters(packageDoc, applicableToRouters, 'create');
  } else {
    await packageDoc.save();
  }


  const radiusService = require('../services/radiusService');
  await radiusService.ensurePackageGroups(packageDoc);

  res.status(201).json({
    success: true,
    message: 'Package created successfully',
    data: packageDoc
  });
});

// @desc    Update package
// @route   PUT /api/packages/:id
// @access  Private
exports.updatePackage = asyncHandler(async (req, res, next) => {
  let packageDoc = await Package.findById(req.params.id);

  if (!packageDoc) {
    return next(new ErrorResponse('Package not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && packageDoc.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this package', 403));
  }

  const {
    packageName,
    speed,
    price,
    period,
    periodUnit,
    dataLimit,
    description,
    priority,
    isActive,
    fup,
    applicableToRouters
  } = req.body;

  // Update fields
  if (packageName) packageDoc.packageName = packageName;
  if (speed) packageDoc.speed = { ...packageDoc.speed, ...speed };
  if (price) packageDoc.price = price;
  if (period) packageDoc.period = period;
  if (periodUnit) packageDoc.periodUnit = periodUnit;
  if (typeof dataLimit !== 'undefined') packageDoc.dataLimit = dataLimit;
  if (description) packageDoc.description = description;
  if (priority) packageDoc.priority = priority;
  if (typeof isActive !== 'undefined') packageDoc.isActive = isActive;
  if (fup) packageDoc.fup = { ...packageDoc.fup, ...fup };

  await packageDoc.save();

   // Handle router sync only if package type is hotspot and routers changed
   if (packageDoc.packageType === 'hotspot' && applicableToRouters !== undefined) {
    await syncPackageRouters(packageDoc, applicableToRouters, 'update');
  } else if (packageDoc.packageType === 'hotspot' && applicableToRouters === undefined) {
    // No change in router assignment – keep existing
    await packageDoc.save();
  } else {
    await packageDoc.save();
  }

  const radiusService = require('../services/radiusService');
  await radiusService.ensurePackageGroups(packageDoc);

  res.status(200).json({
    success: true,
    message: 'Package updated successfully',
    data: packageDoc
  });
});

// @desc    Delete package
// @route   DELETE /api/packages/:id
// @access  Private
exports.deletePackage = asyncHandler(async (req, res, next) => {
  const packageDoc = await Package.findById(req.params.id);

  if (!packageDoc) {
    return next(new ErrorResponse('Package not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && packageDoc.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this package', 403));
  }

  // Soft delete - just deactivate
  packageDoc.isActive = false;
  await packageDoc.save();

  res.status(200).json({
    success: true,
    message: 'Package deactivated successfully',
    data: null
  });
});
