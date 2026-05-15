const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  // Relationship
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },

  // Account identification
  accountId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    // e.g., "SKY0001-1", "SKY0001-2"
  },

  isChild: {
    type: Bool
  },



  siteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    required: true
  },

  // Network configuration (formerly under customer.pppoe)
  pppoe: {
    username: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    siteIp: String,
    staticIp: String,
    macAddress: String,
  },

  // CPE details
  cpe: {
    serialNumber: { type: String, required: true },
    macAddress: { type: String, required: true },
    model: { type: String, required: true },
    wifiName: String,
    wifiPassword: String,
  },

  // Subscription details
  subscription: {
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Package',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'suspended', 'terminated'],
      default: 'active',
    },
    activatedAt: Date,
    expiresAt: { type: Date, required: true },
    autoRenew: { type: Boolean, default: true },
    pausedAt: Date,
    pausedPeriod: { type: Number, default: 0 },
  },

  // Billing
  billing: {
    balance: { type: Number, default: 0 },
    discountEnabled: { type: Boolean, default: false },
    discountAmount: { type: Number, default: 0 },
    lastPaymentDate: Date,
    nextBillingDate: Date,
  },

  // Connection status (live monitoring)
  connectionStatus: {
    status: { type: String, enum: ['online', 'offline', 'unknown'], default: 'unknown' },
    lastOnline: Date,
    lastOffline: Date,
    lastChecked: Date,
    currentIp: String,
    currentMac: String,
  },

  // RADIUS integration
  radiusId: String,

  // Account status
  isActive: { type: Boolean, default: true },

  // Renewal history (optional)
  renewals: [{
    dateRenewed: Date,
    method: { type: String, enum: ['stk', 'wallet', 'manual', 'direct'] },
  }],

  // Auditing
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },

  // Notes for this account (optional)
  notes: [{
    note: String,
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    addedAt: { type: Date, default: Date.now },
  }],

}, {
  timestamps: true,
});

// Indexes
AccountSchema.index({ accountId: 1 });
AccountSchema.index({ customerId: 1, isActive: 1 });
AccountSchema.index({ 'pppoe.username': 1 });
AccountSchema.index({ 'subscription.expiresAt': 1 });

module.exports = mongoose.model('Account', AccountSchema);