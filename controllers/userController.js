const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const User = require('../models/User');
const Admin = require('../models/Admin');
const Role = require('../models/Role');
const bcrypt = require('bcryptjs');
const { formatPhoneNumber } = require('../utils/phoneHelpers');

// @desc    Get all users
// @route   GET /api/users
// @access  Private
exports.getUsers = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, search, department, roleId, isActive = 'true' } = req.query;

  const query = {};

  if (search) {
    query.$or = [
      { username: { $regex: search, $options: 'i' } },
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  if (department) query.department = department;
  if (roleId) query.roleId = roleId;
  if (isActive) query.isActive = isActive === 'true';

  const users = await User.find(query)
    .populate('roleId', 'roleName roleCode')
    .select('-password')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await User.countDocuments(query);

  res.status(200).json({
    success: true,
    message: 'Users retrieved successfully',
    data: {
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private
exports.getUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id)
    .populate('roleId')
    .populate('createdBy', 'firstName lastName')
    .select('-password');

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  console.log("The user we will return to frontend: ", user)

  res.status(200).json({
    success: true,
    message: 'User retrieved successfully',
    data: user
  });
});

// @desc    Create user
// @route   POST /api/users
// @access  Private
exports.createUser = asyncHandler(async (req, res, next) => {
  const {
    username,
    email,
    password,
    firstName,
    lastName,
    phoneNumber,
    employeeId,
    department,
    position,
    roleId,
    allowedRegions,
    hireDate
  } = req.body;

  // Validate required fields
  if (!username || !email || !password || !firstName || !lastName || !phoneNumber || !roleId) {
    return next(new ErrorResponse('Please provide all required fields', 400));
  }

  // Check if username or email exists
  const existingUser = await User.findOne({ $or: [{ username }, { email }] });
  if (existingUser) {
    return next(new ErrorResponse('Username or email already exists', 400));
  }

  // Verify role exists
  const role = await Role.findById(roleId);
  if (!role) {
    return next(new ErrorResponse('Role not found', 404));
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create user
  const user = await User.create({
    username,
    email,
    password: hashedPassword,
    firstName,
    lastName,
    phoneNumber: formatPhoneNumber(phoneNumber),
    employeeId,
    department,
    position,
    roleId,
    allowedRegions: allowedRegions || role.allowedRegions,
    hireDate: hireDate || Date.now(),
    createdBy: req.session.userId,
    mustChangePassword: true
  });

  // Update role user count
  await Role.findByIdAndUpdate(roleId, { $inc: { userCount: 1 } });

  await user.populate('roleId');

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: user
  });
});

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private
exports.updateUser = asyncHandler(async (req, res, next) => {
  let user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  const {
    firstName,
    lastName,
    email,
    phoneNumber,
    department,
    position,
    allowedRegions,
    avatar,
    bio,
    address,
    emergencyContact,
    workSchedule
  } = req.body;

  // Update allowed fields
  if (firstName) user.firstName = firstName;
  if (lastName) user.lastName = lastName;
  if (email) user.email = email;
  if (phoneNumber) user.phoneNumber = formatPhoneNumber(phoneNumber);
  if (department) user.department = department;
  if (position) user.position = position;
  if (allowedRegions) user.allowedRegions = allowedRegions;
  if (avatar) user.avatar = avatar;
  if (bio) user.bio = bio;
  if (address) user.address = { ...user.address, ...address };
  if (emergencyContact) user.emergencyContact = { ...user.emergencyContact, ...emergencyContact };
  if (workSchedule) user.workSchedule = { ...user.workSchedule, ...workSchedule };

  user.lastModifiedBy = req.session.userId;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'User updated successfully',
    data: user
  });
});

// @desc    Change user role
// @route   PUT /api/users/:id/role
// @access  Private
exports.changeRole = asyncHandler(async (req, res, next) => {
  const { roleId } = req.body;

  if (!roleId) {
    return next(new ErrorResponse('Role ID is required', 400));
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  // Verify new role exists
  const newRole = await Role.findById(roleId);
  if (!newRole) {
    return next(new ErrorResponse('Role not found', 404));
  }

  const oldRoleId = user.roleId;

  // Update user role
  user.roleId = roleId;
  user.lastModifiedBy = req.session.userId;
  await user.save();

  // Update role user counts
  await Role.findByIdAndUpdate(oldRoleId, { $inc: { userCount: -1 } });
  await Role.findByIdAndUpdate(roleId, { $inc: { userCount: 1 } });

  await user.populate('roleId');

  res.status(200).json({
    success: true,
    message: 'User role changed successfully',
    data: user
  });
});

// @desc    Reset user password
// @route   PUT /api/users/:id/reset-password
// @access  Private
exports.resetPassword = asyncHandler(async (req, res, next) => {
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return next(new ErrorResponse('Password must be at least 8 characters', 400));
  }

  const user = await User.findById(req.params.id).select('+password');

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(newPassword, salt);
  user.passwordChangedAt = Date.now();
  user.mustChangePassword = true;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Password reset successfully',
    data: null
  });
});


// @desc    Change logged-in user's password
// @route   PUT /api/users/change-password
// @access  Private (any authenticated user)
// Make sure bcrypt is required at the top of your controller file
// or 'bcrypt'

// @desc    Change logged-in user's password
// @route   PUT /api/users/change-password
// @access  Private
exports.changeMyPassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return next(new ErrorResponse('New password must be at least 8 characters', 400));
  }

  // Get user with password field (normally excluded)
  const user = await User.findById(req.user.id).select('+password');

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  // Compare current password using bcrypt directly
  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    return next(new ErrorResponse('Current password is incorrect', 401));
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(newPassword, salt);
  user.passwordChangedAt = Date.now();
  user.mustChangePassword = false; // optional

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Password changed successfully',
  });
});

// @desc    Suspend user
// @route   PUT /api/users/:id/suspend
// @access  Private
exports.suspendUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  if (user.accountStatus === 'suspended') {
    return next(new ErrorResponse('User is already suspended', 400));
  }

  user.accountStatus = 'suspended';
  user.isActive = false;
  user.lastModifiedBy = req.session.userId;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'User suspended successfully',
    data: user
  });
});

// @desc    Activate user
// @route   PUT /api/users/:id/activate
// @access  Private
exports.activateUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  user.accountStatus = 'active';
  user.isActive = true;
  user.lastModifiedBy = req.session.userId;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'User activated successfully',
    data: user
  });
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private
exports.deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  // Update role user count
  await Role.findByIdAndUpdate(user.roleId, { $inc: { userCount: -1 } });

  await user.deleteOne();

  res.status(200).json({
    success: true,
    message: 'User deleted successfully',
    data: null
  });
});

// @desc    Get user performance metrics
// @route   GET /api/users/:id/metrics
// @access  Private
exports.getUserMetrics = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id).select('metrics');

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  res.status(200).json({
    success: true,
    message: 'User metrics retrieved successfully',
    data: user.metrics
  });
});



// @desc    Change Admin's own password
// @route   PUT /api/admins/change-password
// @access  Private (Admin only)
exports.changeAdminPassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword, id } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return next(new ErrorResponse('New password must be at least 8 characters', 400));
  }

  console.log("ID: ", id)
  // Get admin with password field (normally excluded)
  const admin = await Admin.findById(req.user.id).select('+password');

  if (!admin) {
    return next(new ErrorResponse('Admin not found', 404));
  }

  // Compare current password
  const isMatch = await bcrypt.compare(currentPassword, admin.password);
  if (!isMatch) {
    return next(new ErrorResponse('Current password is incorrect', 401));
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  admin.password = await bcrypt.hash(newPassword, salt);
  admin.passwordChangedAt = Date.now();
  admin.mustChangePassword = false;

  await admin.save();

  res.status(200).json({
    success: true,
    message: 'Admin password changed successfully',
  });
});