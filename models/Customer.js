const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const crypto = require('crypto');

function normalizePhone(phone) {
  if (!phone) return null;

  phone = phone.replace(/\D/g, '');

  if (phone.startsWith('0')) {
    return '254' + phone.slice(1);
  }

  if (phone.startsWith('254')) {
    return phone;
  }

  return phone;
}

function hashPhone(phone) {
  if (!phone) return null;

  const normalized = normalizePhone(phone);

  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex');
}

const CustomerSchema = new Schema({
  // Account Identification
  accountId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
    // Format: SKY0001, SKN0045, PFT0099
    // This becomes their PPPoE username
  },
  
  regionCode: {
    type: String,
    required: true,
    uppercase: true,
    index: true
  },

  // NEW: Hierarchical location fields (from the site coverage)
  city: {
    type: String,
    required: true
  },
  subLocation: {
    type: String,
    required: true
  },
  localArea: {
    type: String,
    required: true
  },

  // Legacy location object – kept for backward compatibility (optional)
  location: {
    mainCity: { type: String },   // now mapped from city
    subLocation: { type: String }, // mapped from subLocation
    area: { type: String },        // mapped from localArea
    houseNumber: String,
    apartment: String,
    street: String,
    landmark: String
  },
  
  siteId: {
    type: Schema.Types.ObjectId,
    ref: 'Site',
    required: true
  },

  isChild: { type: Boolean, default: false },
  parentAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: function() { return this.isChild === true; }
  },

  renewals: [
    {
      dateRenewed: Date,
      method: {
        type: String,
        enum: ['stk', 'wallet', 'manual', 'direct']
      }
    }
  ],
  
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
    trim: true,
    lowercase: true
  },
  
  phoneNumber: {
    type: String,
    required: true,
  },
  
  alternatePhoneNumber: {
    type: String
  },

  hashedPhone: {
    type: String,
    index: true
  },
  
  hashedAlternatePhone: {
    type: String,
    index: true
  },
  
  // Network Configuration
  pppoe: {
    username: {
      type: String,
      required: true,
      unique: true
    },
    password: {
      type: String,
      required: true
    },
    siteIp: {
      type: String
    },
    staticIp: {
      type: String
    },
    macAddress: {
      type: String,
      uppercase: true
    }, 
    useOldUsername: {
      type: Boolean, 
      required: true,
      default: false,
    },
    oldUsername: {
      type: String,
      required: function () {
        return this.pppoe.useOldUsername;
      }
    },
  },

  nasIp: String,
  
  // CPE (Customer Premise Equipment) Details
  cpe: {
    serialNumber: {
      type: String, 
      required: true
    },
    macAddress: {
      type: String,
      required: true
    },
    model: {
      type: String,
      required: true
    },
    wifiName: {
      type: String,
      required: true
    },
    wifiPassword: {
      type: String,
      required: true
    }
  },
  
  // Subscription Details
  subscription: {
    packageId: {
      type: Schema.Types.ObjectId,
      ref: 'Package',
      required: true
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'suspended', 'terminated'],
      default: 'active'
    },
    activatedAt: Date,
    expiresAt: {
      type: Date,
      required: true
    },
    autoRenew: {
      type: Boolean,
      default: true
    },
    pausedAt: Date,
    pausedPeriod: {
      type: Number,
      default: 0
    }
  },

  suspensionSource: {
    type: {
      reason: { type: String, enum: ['admin', 'site_offline', 'payment'], default: 'admin' },
      siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
      timestamp: Date
    },
    default: null
  },

  fupEnabled: { type: Boolean, default: false },
  billingCycle: {
    startDate: Date
  },

  burst: {
    enabled: { type: Boolean, default: false },
    originalGroup: { type: String },
    burstGroup: { type: String },
    downloadSpeed: { type: Number },
    uploadSpeed: { type: Number },
    expiresAt: { type: Date },
    startedAt: { type: Date }
  },

  freeExtensionDays: {
    type: Number,
    default: 0
  },

  maxFreeExtensionDays: {
    type: Number,
    default: 3
  },
  
  // Billing
  billing: {
    balance: {
      type: Number,
      default: 0
    },
    discountEnabled: {
      type: Boolean,
      default: false
    },
    discountAmount: {
      type: Number,
      default: 0
    },
    lastPaymentDate: Date,
    nextBillingDate: Date
  },

  // Connection Status
  connectionStatus: {
    status: { type: String, enum: ['online', 'offline', 'online-no-internet', 'unknown'], default: 'unknown' },
    lastOnline: Date,
    lastOffline: Date,
    noInternetSince: Date,
    lastChecked: Date,
    currentIp: String,
    currentMac: String
  },

  // OTP for customer portal
  otp: {
    code: { type: String, select: false },
    expiresAt: { type: Date, select: false },
    attempts: { type: Number, default: 0, select: false }
  },
 
  // Last login timestamp for customer portal
  lastLogin: Date,
  
  // RADIUS Integration
  radiusId: String,
  
  // Account Status
  isActive: {
    type: Boolean,
    default: true
  },

  paymentCounter: { type: Number, default: 0 },
  
  notes: [{
    note: String,
    addedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    addedAt: { type: Date, default: Date.now }
  }],

  lastExpiryWarningSent: {
    type: Date,
    default: null,
  },

  lastExpiryWarningExpiry: { type: Date, default: null },
  
  createdBy: { type: Schema.Types.ObjectId, ref: 'Admin' }
}, {
  timestamps: true
});

// Indexes
CustomerSchema.index({ isChild: 1 });
CustomerSchema.index({ parentAccount: 1 });
CustomerSchema.index({ accountId: 1 });
// CustomerSchema.index(
//   { phoneNumber: 1 },
//   {
//     unique: true,
//     partialFilterExpression: { isChild: false }
//   }
// );
CustomerSchema.index({ regionCode: 1, 'subscription.status': 1 });
CustomerSchema.index({ siteId: 1, isActive: 1 });
CustomerSchema.index({ 'pppoe.username': 1 });
CustomerSchema.index({ 'subscription.expiresAt': 1 });
CustomerSchema.index({ city: 1, subLocation: 1, localArea: 1 });



CustomerSchema.pre('save', function (next) {
  // Normalize and hash primary phone
  if (this.phoneNumber) {
    this.phoneNumber = normalizePhone(this.phoneNumber);
    this.hashedPhone = hashPhone(this.phoneNumber);
  }

  // Normalize and hash alternate phone
  if (this.alternatePhoneNumber) {
    this.alternatePhoneNumber = normalizePhone(this.alternatePhoneNumber);
    this.hashedAlternatePhone = hashPhone(this.alternatePhoneNumber);
  }

  next();
});

CustomerSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();

  if (update.phoneNumber) {
    update.phoneNumber = normalizePhone(update.phoneNumber);
    update.hashedPhone = hashPhone(update.phoneNumber);
  }

  if (update.alternatePhoneNumber) {
    update.alternatePhoneNumber = normalizePhone(update.alternatePhoneNumber);
    update.hashedAlternatePhone = hashPhone(update.alternatePhoneNumber);
  }

  next();
});

module.exports = mongoose.model('Customer', CustomerSchema);