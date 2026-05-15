const User = require('../models/User');
const Admin = require('../models/Admin');

const isDemoMode = true;

// Protect routes - check if user is authenticated
exports.protect = async (req, res, next) => {
  // DEMO MODE: skip all authentication, attach fake admin user
  if (isDemoMode) {
    req.user = {
      _id: 'demo_user_id',
      username: 'demo_admin',
      isAdmin: true,
      role: 'super_admin',
      allowedRegions: [],
      isActive: true
    };
    req.isAdmin = true;
    req.selectedRegion = 'ALL';
    req.allowedRegions = [];
    console.log('Demo mode: authentication bypassed');
    return next();
  }

  // Normal production authentication
  try {
    // Check if session exists and has userId
    if (!req.session || !req.session.userId) {
      console.log('FAILED: No session or no userId');
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route. Please log in.',
        data: null
      });
    }

    console.log('Session userId found:', req.session.userId);
    console.log('Is Admin:', req.session.isAdmin);

    // Get user from database
    let user;
    
    if (req.session.isAdmin) {
      user = await Admin.findById(req.session.userId).select('-password');
      console.log('Loading Admin user');
    } else {
      user = await User.findById(req.session.userId).select('-password').populate('roleId');
      console.log('Loading regular User');
    }

    if (!user) {
      console.log('FAILED: Logged user not found in database');
      return res.status(401).json({
        success: false,
        message: 'User not found',
        data: null
      });
    }

    console.log('User found:', user.username);

    if (!user.isActive) {
      console.log('FAILED: User is not active');
      return res.status(401).json({
        success: false,
        message: 'User account is inactive',
        data: null
      });
    }

    // Attach user to request object
    req.user = user;
    req.selectedRegion = req.session.selectedRegion;
    req.allowedRegions = req.session.allowedRegions || user.allowedRegions;
    req.isAdmin = req.session.isAdmin || false;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
      data: null
    });
  }
};

// Check if user has access to specific region
exports.checkRegionAccess = (req, res, next) => {
  const { regionCode } = req.params;
  const user = req.user;

  // Super admin or system admin has access to all regions
  if (req.isAdmin && (user.role === 'super_admin' || user.role === 'system_admin')) {
    return next();
  }

  // Check if region is in user's allowed regions
  const hasAllRegions = user.allowedRegions && (user.allowedRegions.includes('*') || user.allowedRegions.length === 0);
  
  if (!hasAllRegions && !user.allowedRegions.includes(regionCode)) {
    return res.status(403).json({
      success: false,
      message: 'You do not have access to this region',
      data: null
    });
  }

  next();
};

// Filter data by user's selected region or allowed regions
exports.applyRegionFilter = (req, res, next) => {
  req.regionFilter = {};

  // If admin and 'ALL' is selected, no filter
  if (req.isAdmin && req.selectedRegion === 'ALL') {
    return next();
  }

  // If super admin or system admin, allow all regions view
  if (req.isAdmin && (req.user.role === 'super_admin' || req.user.role === 'system_admin')) {
    if (req.selectedRegion && req.selectedRegion !== 'ALL') {
      req.regionFilter.regionCode = req.selectedRegion;
    }
    return next();
  }

  // If a specific region is selected, filter by that region
  if (req.selectedRegion && req.selectedRegion !== 'ALL') {
    req.regionFilter.regionCode = req.selectedRegion;
  } else if (!req.isAdmin || req.user.role !== 'super_admin') {
    // If no region selected but not super admin, filter by allowed regions
    const allowedRegions = req.allowedRegions || req.user.allowedRegions || [];
    if (allowedRegions.length > 0 && !allowedRegions.includes('*')) {
      req.regionFilter.regionCode = { $in: allowedRegions };
    }
  }

  next();
};

// Admin only - ensure user is an admin (from session)
exports.adminOnly = (req, res, next) => {
  if (!req.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.',
      data: null
    });
  }
  next();
};

// Authorize specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    // Demo mode: skip role check
    if (isDemoMode) return next();

    const userRole = req.isAdmin ? req.user.role : req.user.roleId?.roleCode;
    
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Role '${userRole}' is not authorized to access this route`,
        data: null
      });
    }
    next();
  };
};