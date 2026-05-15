const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Package = require('../models/Package');
const Site = require('../models/Site');
const Customer = require ('../models/Customer')

// @desc    Get all packages
// @route   GET /api/packages
// @access  Private
exports.getPackages = asyncHandler(async (req, res, next) => {
  const { packageType, siteId, isActive = 'true' } = req.query;

  const query = { ...req.regionFilter };

  if (packageType) query.packageType = packageType;
  if (siteId) query.siteId = siteId;
  if (isActive) query.isActive = isActive === 'true';

  const packages = await Package.find(query)
    .populate('siteId', 'siteName regionCode name')
    .sort({ priority: 1, price: 1 });

  res.status(200).json({
    success: true,
    message: 'Packages retrieved successfully',
    data: { packages }
  });
});

// @desc    Get single package
// @route   GET /api/packages/:id
// @access  Private
exports.getPackage = asyncHandler(async (req, res, next) => {
  const packageDoc = await Package.findById(req.params.id).populate('siteId');

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

exports.getPackageCustomers = asyncHandler(async (req, res, next) => {

  const { id } = req.params;

  const package = await Package.findById(id);

  if (!package) {
    return next(new ErrorResponse('Package not found', 404));
  }

  const customers = await Customer.find({ "subscription.packageId": package._id });

  const totalCustomers = customers.length;
  const activeCustomers = customers.filter((c) => c.subscription.status === 'active').length;
  const expiredCustomers = customers.filter((c) => c.subscription.status === 'expired').length;
  const suspendedCustomers = customers.filter((c) => c.subscription.status === 'suspended').length;

  const customerInfo = {
    totalCustomers,
    activeCustomers,
    expiredCustomers,
    suspendedCustomers
  };

  res.status(200).json({
    success: true,
    message: 'Package customers retrieved successfully',
    data: customerInfo
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
    fup
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
    fup
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
