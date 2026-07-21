const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Site = require('../models/Site');
const Router = require('../models/Router'); // for validation later

// @desc    Get all sites
// @route   GET /api/sites
// @access  Private
exports.getSites = asyncHandler(async (req, res, next) => {
  const { isActive = 'true' } = req.query;

  const query = { ...req.regionFilter };
  if (isActive) query.isActive = isActive === 'true';

  const sites = await Site.find(query).sort({ name: 1 });

  res.status(200).json({
    success: true,
    message: 'Sites retrieved successfully',
    data: { sites }
  });
});

// @desc    Get single site
// @route   GET /api/sites/:id
// @access  Private
exports.getSite = asyncHandler(async (req, res, next) => {
  const site = await Site.findById(req.params.id);

  if (!site) {
    return next(new ErrorResponse('Site not found', 404));
  }

  // Check region access (using regionCode)
  if (req.regionFilter.regionCode && site.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this site', 403));
  }

  res.status(200).json({
    success: true,
    message: 'Site retrieved successfully',
    data: site
  });
});

// @desc    Create site (region)
// @route   POST /api/sites
// @access  Private (Admin only)
exports.createSite = asyncHandler(async (req, res, next) => {
  const {
    name,
    regionCode,
    coverage,
    payment,
    location,
    contactPerson,
    isActive, 
    preferredPaymentGateway
  } = req.body;

  // Required fields
  if (!name || !regionCode) {
    return next(new ErrorResponse('name and regionCode are required', 400));
  }

  // Check uniqueness of regionCode
  const existing = await Site.findOne({ regionCode: regionCode.toUpperCase() });
  if (existing) {
    return next(new ErrorResponse('Region code already exists', 400));
  }

  const site = await Site.create({
    name,
    regionCode: regionCode.toUpperCase(),
    coverage: coverage || [],
    payment: payment || {},
    location,
    contactPerson,
    isActive: isActive !== undefined ? isActive : true,
    preferredPaymentGateway: preferredPaymentGateway || 'kopokopo'
  });

  res.status(201).json({
    success: true,
    message: 'Site created successfully',
    data: site
  });
});

// @desc    Update site
// @route   PUT /api/sites/:id
// @access  Private (Admin only)
// @desc    Update site
// @route   PUT /api/sites/:id
// @access  Private (Admin only)
exports.updateSite = asyncHandler(async (req, res, next) => {
  const site = await Site.findById(req.params.id);
  if (!site) {
    return next(new ErrorResponse('Site not found', 404));
  }

  if (req.regionFilter.regionCode && site.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this site', 403));
  }

  const {
    name,
    coverage,
    payment,
    location,
    contactPerson,
    isActive,
    preferredPaymentGateway
  } = req.body;

  // Log incoming data for debugging
  console.log('Updating site with:', { name, coverage, payment, location, contactPerson, isActive });

  // Update scalar fields
  if (name) site.name = name;
  if (location) site.location = location;
  if (contactPerson) site.contactPerson = contactPerson;
  if (preferredPaymentGateway) site.preferredPaymentGateway = preferredPaymentGateway;
  if (typeof isActive !== 'undefined') site.isActive = isActive;

  // Update nested objects – replace entire arrays/objects to ensure Mongoose detects changes
  if (coverage) site.coverage = coverage;
  if (payment) site.payment = payment;

  // Mark modified paths to ensure Mongoose saves nested changes
  if (coverage) site.markModified('coverage');
  if (payment) site.markModified('payment');

  await site.save();

  // Log after save for debugging
  console.log('After save:', site.toObject());

  res.status(200).json({
    success: true,
    message: 'Site updated successfully',
    data: site
  });
});

// @desc    Delete site
// @route   DELETE /api/sites/:id
// @access  Private (Admin only)
exports.deleteSite = asyncHandler(async (req, res, next) => {
  const site = await Site.findById(req.params.id);
  if (!site) {
    return next(new ErrorResponse('Site not found', 404));
  }

  if (req.regionFilter.regionCode && site.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this site', 403));
  }

  // Check if any router is still associated
  const routerCount = await Router.countDocuments({ site: site._id });
  if (routerCount > 0) {
    return next(new ErrorResponse(`Cannot delete site: ${routerCount} router(s) still assigned`, 400));
  }

  // Check if any customer belongs to this site (adjust model if needed)
  const Customer = require('../models/Customer');
  const customerCount = await Customer.countDocuments({ site: site._id });
  if (customerCount > 0) {
    return next(new ErrorResponse(`Cannot delete site with ${customerCount} customers`, 400));
  }

  await site.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Site deleted successfully'
  });
});