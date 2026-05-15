const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const User = require('../models/User');
const Admin = require('../models/Admin');
const bcrypt = require('bcryptjs');
// In authController.js
const Site = require('../models/Site');

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res, next) => {
  const { username, password, regionCode } = req.body;

  // Validate input
  if (!username || !password) {
    return next(new ErrorResponse('Please provide username and password', 400));
  }

  // Find user (try User model first, then Admin)
  let user = await User.findOne({ username }).select('+password').populate('roleId');
  let isAdmin = false;

  if (!user) {
    user = await Admin.findOne({ username }).select('+password');
    isAdmin = true;
  }

  if (!user) {
    return next(new ErrorResponse('Invalid credentials. No user', 401));
  }

  console.log("User found")

  // Check if account is active
  if (!user.isActive) {
    return next(new ErrorResponse('This account is suspended. Please contact support', 401));
  }

  // Check if account is locked (User model only)
  if (!isAdmin && user.isLocked && user.isLocked()) {
      return next(new ErrorResponse('This account is locked. Please contact support', 423));
  }

  // Check password
  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    // Increment login attempts (User model only)
    if (!isAdmin && user.incLoginAttempts) {
      await user.incLoginAttempts();
    }
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  // Check region access for non-Admin users
  if (!isAdmin) {
    // For regular users, check if they need to specify region
    if (user.allowedRegions && user.allowedRegions.length > 0 && !user.allowedRegions.includes('*')) {
      if (!regionCode) {
        return res.status(200).json({
          success: true,
          message: 'Region selection required',
          data: {
            requiresRegion: true,
            allowedRegions: user.allowedRegions
          }
        });
      }

      if (!user.allowedRegions.includes(regionCode)) {
        return next(new ErrorResponse('No access to this region', 403));
      }
    }
  } else {
    // For Admin users
    if (user.role !== 'super_admin' && regionCode) {
      if (!user.allowedRegions.includes(regionCode) && !user.allowedRegions.includes('*')) {
        return next(new ErrorResponse('No access to this region', 403));
      }
    }
  }

  // Create session
  req.session.userId = user._id;
  req.session.isAdmin = isAdmin;
  req.session.selectedRegion = regionCode || (user.allowedRegions && user.allowedRegions.includes('*') ? 'ALL' : user.allowedRegions?.[0] || 'ALL');
  req.session.allowedRegions = user.allowedRegions || [];
  req.session.role = isAdmin ? user.role : user.roleId?.roleCode;
  req.session.name = `${user.firstName} ${user.lastName}`

  // Explicitly save session to ensure it's persisted before responding
  try {
    await new Promise((resolve, reject) => {
      req.session.save(err => {
        if (err) {
          console.error('Session save error during login:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    return next(new ErrorResponse('Failed to create session', 500));
  }

  // Update last login
  user.lastLogin = Date.now();
  user.lastLoginIp = req.ip;
  
  // Reset login attempts (User model only)
  if (!isAdmin) {
    user.loginAttempts = 0;
    user.lockedUntil = undefined;
  }
  
  await user.save();
  let permissions;

  if(user.roleId){
    permissions = user.roleId.permissions;
  }

  // Build response
  const responseData = {
    id: user._id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phoneNumber: user.phoneNumber,
    role: isAdmin ? user.role : user.roleId?.roleName,
    roleCode: isAdmin ? user.role : user.roleId?.roleCode,
    allowedRegions: user.allowedRegions || [],
    selectedRegion: req.session.selectedRegion,
    isAdmin,
    permissions
    
  };

  // Add department for User model
  if (!isAdmin) {
    responseData.department = user.department;
    responseData.position = user.position;
  }

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: responseData
  });
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = asyncHandler(async (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout session destroy error:', err);
      return next(new ErrorResponse('Error logging out', 500));
    }
    
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
      data: null
    });
  });
});

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = asyncHandler(async (req, res, next) => {
  let user;
  
  if (req.session.isAdmin) {
    user = await Admin.findById(req.session.userId);
  } else {
    user = await User.findById(req.session.userId).populate('roleId');
  }

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  let permissions;

  if(user.roleId){
    permissions = user.roleId.permissions;
  }

  const responseData = {
    id: user._id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phoneNumber: user.phoneNumber,
    role: req.session.isAdmin ? user.role : user.roleId?.roleName,
    roleCode: req.session.isAdmin ? user.role : user.roleId?.roleCode,
    allowedRegions: user.allowedRegions || [],
    selectedRegion: req.session.selectedRegion,
    isAdmin: req.session.isAdmin,
    permissions
  };

  if (!req.session.isAdmin) {
    responseData.department = user.department;
    responseData.position = user.position;
    responseData.avatar = user.avatar;
  }

  res.status(200).json({
    success: true,
    message: 'User retrieved successfully',
    data: responseData
  });
});

// @desc    Switch region
// @route   POST /api/auth/switch-region
// @access  Private
exports.switchRegion = asyncHandler(async (req, res, next) => {
  const { regionCode } = req.body;

  if (!regionCode) {
    return next(new ErrorResponse('Region code is required', 400));
  }

  let user;
  
  if (req.session.isAdmin) {
    user = await Admin.findById(req.session.userId);
  } else {
    user = await User.findById(req.session.userId);
  }

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  // Check if user has access to this region
  const isSuperAdmin = req.session.isAdmin && user.role === 'super_admin';
  const hasAllRegions = user.allowedRegions && (user.allowedRegions.includes('*') || user.allowedRegions.length === 0);

  if (!isSuperAdmin && !hasAllRegions) {
    if (regionCode !== 'ALL' && !user.allowedRegions.includes(regionCode)) {
      return next(new ErrorResponse('You do not have access to this region', 403));
    }
  }

  req.session.selectedRegion = regionCode;

  // Explicitly save session to ensure the change is persisted
  try {
    await new Promise((resolve, reject) => {
      req.session.save(err => {
        if (err) {
          console.error('Session save error during region switch:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    return next(new ErrorResponse('Failed to update session', 500));
  }

  res.status(200).json({
    success: true,
    message: 'Region switched successfully',
    data: {
      selectedRegion: regionCode
    }
  });
});

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  // Validate input
  if (!currentPassword || !newPassword || !confirmPassword) {
    return next(new ErrorResponse('Please provide all required fields', 400));
  }

  if (newPassword !== confirmPassword) {
    return next(new ErrorResponse('New passwords do not match', 400));
  }

  if (newPassword.length < 8) {
    return next(new ErrorResponse('Password must be at least 8 characters', 400));
  }

  // Get user with password
  let user;
  
  if (req.session.isAdmin) {
    user = await Admin.findById(req.session.userId).select('+password');
  } else {
    user = await User.findById(req.session.userId).select('+password');
  }

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  // Check current password
  const isMatch = await bcrypt.compare(currentPassword, user.password);

  if (!isMatch) {
    return next(new ErrorResponse('Current password is incorrect', 401));
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(newPassword, salt);
  user.passwordChangedAt = Date.now();
  user.mustChangePassword = false;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Password changed successfully',
    data: null
  });
});

// @desc    Get user permissions
// @route   GET /api/auth/permissions
// @access  Private
exports.getPermissions = asyncHandler(async (req, res, next) => {
  if (req.session.isAdmin) {
    // Admin has all permissions
    return res.status(200).json({
      success: true,
      message: 'Permissions retrieved successfully',
      data: {
        isAdmin: true,
        permissions: 'all'
      }
    });
  }

  const user = await User.findById(req.session.userId).populate('roleId');

  if (!user || !user.roleId) {
    return next(new ErrorResponse('User or role not found', 404));
  }

  // Get granted permissions from role
  const grantedPermissions = user.roleId.getGrantedPermissions();

  // If user has custom permissions, merge them
  let finalPermissions = grantedPermissions;

  if (user.customPermissions && user.customPermissions.enabled) {
    // Apply custom overrides
    const customPerms = [];
    for (const [module, actions] of Object.entries(user.customPermissions.permissions || {})) {
      for (const [action, value] of Object.entries(actions)) {
        const permString = `${module}.${action}`;
        if (value === true && !finalPermissions.includes(permString)) {
          customPerms.push(permString);
        } else if (value === false && finalPermissions.includes(permString)) {
          finalPermissions = finalPermissions.filter(p => p !== permString);
        }
      }
    }
    finalPermissions = [...finalPermissions, ...customPerms];
  }

  res.status(200).json({
    success: true,
    message: 'Permissions retrieved successfully',
    data: {
      isAdmin: false,
      role: user.roleId.roleName,
      roleCode: user.roleId.roleCode,
      permissions: finalPermissions,
      allowedRegions: user.allowedRegions
    }
  });
});



// @desc    Get all available region codes (for global admins)
// @route   GET /api/auth/available-regions
// @access  Private
exports.getAvailableRegions = asyncHandler(async (req, res, next) => {
  // Only return if user has global access
  const user = req.session.isAdmin 
    ? await Admin.findById(req.session.userId)
    : await User.findById(req.session.userId);

  const hasGlobalAccess = user.allowedRegions.includes('*') || user.allowedRegions.length === 0;

  if (!hasGlobalAccess) {
    return next(new ErrorResponse('Not authorized to view all regions', 403));
  }

  const sites = await Site.find({ isActive: true }).distinct('regionCode');
  const regionCodes = sites.filter(code => code).sort();
  // Add "ALL" as an option
  res.status(200).json({
    success: true,
    data: ['ALL', ...regionCodes]
  });
});