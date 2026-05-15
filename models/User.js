const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  // Personal Information
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  
  phoneNumber: {
    type: String,
    required: true,
    unique: true
  },
  
  alternatePhoneNumber: {
    type: String
  },
  
  // Authentication
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  
  password: {
    type: String,
    required: true,
    select: false
    // Hash with bcrypt before saving
  },
  
  // Employee Details
  employeeId: {
    type: String,
    unique: true,
    sparse: true
    // Optional employee ID (e.g., EMP001)
  },
  
  department: {
    type: String,
    enum: [
      'sales',
      'support',
      'technical',
      'network',
      'billing',
      'management',
      'marketing',
      'hr',
      'other'
    ]
  },
  
  position: {
    type: String
    // e.g., 'Sales Manager', 'Support Agent', 'Network Engineer'
  },
  
  hireDate: {
    type: Date
  },
  
  // Role & Permissions
  roleId: {
    type: Schema.Types.ObjectId,
    ref: 'Role',
    required: true
  },
  
  // Region Access (can override role's default regions)
  allowedRegions: [{
    type: String,
    uppercase: true
    
  }],
  
  // Custom Permissions (overrides for this specific user)
  customPermissions: {
    // If specified, these override role permissions
    // Same structure as Role permissions
    enabled: {
      type: Boolean,
      default: false
    },
    permissions: {
      type: Schema.Types.Mixed
      // Only store overrides, not full permission set
    }
  },
  
  // Account Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  accountStatus: {
    type: String,
    enum: ['active', 'suspended', 'terminated', 'on_leave'],
    default: 'active'
  },
  
  // Login Information
  lastLogin: {
    type: Date
  },
  
  lastLoginIp: {
    type: String
  },
  
  loginAttempts: {
    type: Number,
    default: 0
  },
  
  lockedUntil: {
    type: Date
  },
  
  // Password Management
  passwordChangedAt: {
    type: Date
  },
  
  passwordResetToken: {
    type: String
  },
  
  passwordResetExpires: {
    type: Date
  },
  
  mustChangePassword: {
    type: Boolean,
    default: false
    // Force password change on next login
  },
  
  // Two-Factor Authentication (optional)
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  
  twoFactorSecret: {
    type: String,
    select: false
  },
  
  // Profile
  avatar: {
    type: String
    // URL to profile picture
  },
  
  bio: {
    type: String,
    maxlength: 500
  },
  
  // Contact Information
  address: {
    street: String,
    city: String,
    county: String,
    postalCode: String
  },
  
  // Emergency Contact
  emergencyContact: {
    name: String,
    relationship: String,
    phoneNumber: String
  },
  
  // Work Schedule
  workSchedule: {
    workDays: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }],
    startTime: String, // e.g., "09:00"
    endTime: String    // e.g., "17:00"
  },
  
  // Performance Metrics (optional)
  metrics: {
    ticketsResolved: {
      type: Number,
      default: 0
    },
    averageResolutionTime: {
      type: Number,
      default: 0
      // In minutes
    },
    customersSigned: {
      type: Number,
      default: 0
    },
    leadsConverted: {
      type: Number,
      default: 0
    },
    customerSatisfactionScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    }
  },
  
  // Notifications Preferences
  notifications: {
    email: {
      ticketAssigned: { type: Boolean, default: true },
      ticketUpdated: { type: Boolean, default: true },
      leadAssigned: { type: Boolean, default: true },
      dailyReport: { type: Boolean, default: false }
    },
    sms: {
      urgentTickets: { type: Boolean, default: false }
    }
  },
  
  // Session Management
  activeSessions: [{
    sessionId: String,
    ipAddress: String,
    userAgent: String,
    loginTime: Date,
    lastActivity: Date
  }],
  
  // Notes (internal)
  internalNotes: [{
    note: String,
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Created By
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  
  lastModifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Termination Details
  terminationDate: {
    type: Date
  },
  
  terminationReason: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes
UserSchema.index({ username: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ phoneNumber: 1 });
UserSchema.index({ employeeId: 1 });
UserSchema.index({ roleId: 1, isActive: 1 });
UserSchema.index({ department: 1, isActive: 1 });
UserSchema.index({ allowedRegions: 1 });
UserSchema.index({ accountStatus: 1 });

// Virtual for full name
UserSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Method to check if account is locked
UserSchema.methods.isLocked = function() {
  return !!(this.lockedUntil && this.lockedUntil > Date.now());
};

// Method to increment login attempts
UserSchema.methods.incLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockedUntil && this.lockedUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockedUntil: 1 }
    });
  }
  
  // Otherwise increment
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock account after 5 failed attempts
  const maxAttempts = 5;
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours
  
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked()) {
    updates.$set = { lockedUntil: Date.now() + lockTime };
  }
  
  return this.updateOne(updates);
};

// Method to check if user has specific permission
UserSchema.methods.hasPermission = async function(module, action) {
  // Get user's role
  await this.populate('roleId');
  
  if (!this.roleId) return false;
  
  // If user has custom permissions enabled, check there first
  if (this.customPermissions.enabled && this.customPermissions.permissions) {
    const customPerm = this.customPermissions.permissions[module]?.[action];
    if (customPerm !== undefined) {
      return customPerm;
    }
  }
  
  // Otherwise check role permissions
  return this.roleId.hasPermission(module, action);
};

// Method to check region access
UserSchema.methods.hasRegionAccess = function(regionCode) {
  // If allowedRegions is empty or contains '*', user has access to all regions
  if (!this.allowedRegions || this.allowedRegions.length === 0 || this.allowedRegions.includes('*')) {
    return true;
  }
  
  // Check if specific region is in allowed list
  return this.allowedRegions.includes(regionCode);
};

module.exports = mongoose.model('User', UserSchema);