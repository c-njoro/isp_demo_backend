const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// NOTE: This Admin model is kept for backwards compatibility and system initialization
// For regular users/staff, use the User model with Role-based permissions
// This Admin model is primarily for:
// 1. Initial system setup (first super admin)
// 2. System-level operations
// 3. Emergency access

const AdminSchema = new Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    select: false
    // Hash with bcrypt before saving
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  
  // Region Access Control
  allowedRegions: [{
    type: String,
    // Array of region codes: ['SKY', 'SKN', 'PFT']
    // Empty array or '*' means super admin (all regions)
  }],
  
  role: {
    type: String,
    enum: ['super_admin', 'system_admin'],
    default: 'system_admin'
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  lastLogin: {
    type: Date
  },
  
  lastLoginIp: {
    type: String
  },
  
  // Two-Factor Authentication
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  
  twoFactorSecret: {
    type: String,
    select: false
  },
  
  // Password Management
  passwordChangedAt: {
    type: Date
  },
  
  mustChangePassword: {
    type: Boolean,
    default: false
  },
  
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Indexes
AdminSchema.index({ username: 1 });
AdminSchema.index({ email: 1 });
AdminSchema.index({ allowedRegions: 1 });
AdminSchema.index({ role: 1, isActive: 1 });

// Virtual for full name
AdminSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

module.exports = mongoose.model('Admin', AdminSchema);