const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Role = require('../models/Role');

// @desc    Get all roles
// @route   GET /api/roles
// @access  Private
exports.getRoles = asyncHandler(async (req, res, next) => {
  const { isActive = 'true', includeSystem } = req.query;

  const query = {};

  if (isActive) {
    query.isActive = isActive === 'true';
  }

  if (includeSystem !== 'true') {
    query.isSystem = false;
  }

  const roles = await Role.find(query).sort({ roleName: 1 });

  res.status(200).json({
    success: true,
    message: 'Roles retrieved successfully',
    data: {
      roles
    }
  });
});

// @desc    Get single role
// @route   GET /api/roles/:id
// @access  Private
exports.getRole = asyncHandler(async (req, res, next) => {
  const role = await Role.findById(req.params.id)
    .populate('createdBy', 'firstName lastName')
    .populate('lastModifiedBy', 'firstName lastName');

  if (!role) {
    return next(new ErrorResponse('Role not found', 404));
  }

  res.status(200).json({
    success: true,
    message: 'Role retrieved successfully',
    data: role
  });
});

// @desc    Create role
// @route   POST /api/roles
// @access  Private
exports.createRole = asyncHandler(async (req, res, next) => {
  const {
    roleName,
    roleCode,
    description,
    permissions,
    allowedRegions
  } = req.body;

  // Validate required fields
  if (!roleName || !roleCode || !description) {
    return next(new ErrorResponse('Please provide all required fields', 400));
  }

  // Check if role code exists
  const existingRole = await Role.findOne({ roleCode: roleCode.toUpperCase() });
  if (existingRole) {
    return next(new ErrorResponse('Role code already exists', 400));
  }

  // Create role
  const role = await Role.create({
    roleName,
    roleCode: roleCode.toUpperCase(),
    description,
    permissions: permissions || {},
    allowedRegions: allowedRegions || [],
    isSystem: false,
    createdBy: req.session.userId
  });

  res.status(201).json({
    success: true,
    message: 'Role created successfully',
    data: role
  });
});

// @desc    Update role
// @route   PUT /api/roles/:id
// @access  Private
exports.updateRole = asyncHandler(async (req, res, next) => {
  let role = await Role.findById(req.params.id);

  if (!role) {
    return next(new ErrorResponse('Role not found', 404));
  }

  // Cannot edit system roles
  if (role.isSystem) {
    return next(new ErrorResponse('Cannot edit system roles', 400));
  }

  const {
    roleName,
    description,
    permissions,
    allowedRegions,
    isActive
  } = req.body;

  // Update allowed fields
  if (roleName) role.roleName = roleName;
  if (description) role.description = description;
  if (permissions) role.permissions = permissions;
  if (allowedRegions) role.allowedRegions = allowedRegions;
  if (typeof isActive !== 'undefined') role.isActive = isActive;

  role.lastModifiedBy = req.session.userId;

  await role.save();

  res.status(200).json({
    success: true,
    message: 'Role updated successfully',
    data: role
  });
});

// @desc    Delete role
// @route   DELETE /api/roles/:id
// @access  Private
exports.deleteRole = asyncHandler(async (req, res, next) => {
  const role = await Role.findById(req.params.id);

  if (!role) {
    return next(new ErrorResponse('Role not found', 404));
  }

  // Cannot delete system roles
  if (role.isSystem) {
    return next(new ErrorResponse('Cannot delete system roles', 400));
  }

  // Check if role has users
  if (role.userCount > 0) {
    return next(new ErrorResponse('Cannot delete role with assigned users', 400));
  }

  await role.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Role deleted successfully',
    data: null
  });
});

// @desc    Get role permissions
// @route   GET /api/roles/:id/permissions
// @access  Private
exports.getRolePermissions = asyncHandler(async (req, res, next) => {
  const role = await Role.findById(req.params.id);

  if (!role) {
    return next(new ErrorResponse('Role not found', 404));
  }

  const grantedPermissions = role.getGrantedPermissions();

  res.status(200).json({
    success: true,
    message: 'Role permissions retrieved successfully',
    data: {
      permissions: grantedPermissions,
      fullStructure: role.permissions
    }
  });
});