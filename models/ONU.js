const mongoose = require('mongoose');

/**
 * ONU (Optical Network Unit) Model
 * Represents a customer's ONU device connected to an OLT
 * Links customer equipment to the fiber network
 */
const onuSchema = new mongoose.Schema({
  // ============================================
  // RELATIONSHIPS
  // ============================================
  
  oltId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OLT',
    required: [true, 'OLT ID is required'],
    index: true
  },
  
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    index: true
  },
  
  siteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    required: [true, 'Site ID is required'],
    index: true
  },
  
  regionCode: {
    type: String,
    required: [true, 'Region code is required'],
    uppercase: true,
    trim: true,
    index: true
  },
  
  // ============================================
  // ONU IDENTIFICATION
  // ============================================
  
  serialNumber: {
    type: String,
    required: [true, 'ONU serial number is required'],
    unique: true,
    uppercase: true,
    trim: true,
    index: true,
    validate: {
      validator: function(v) {
        // Loosened from the strict Huawei/ZTE "4 letters + 8 hex" format
        // to plain alphanumeric, 8-20 chars. Mixed fleets (Tenda, TP-Link,
        // etc.) don't reliably follow the HWTC-style convention.
        return /^[A-Z0-9]{8,20}$/i.test(v);
      },
      message: 'Serial number must be 8-20 alphanumeric characters'
    }
  },
  
  macAddress: {
    type: String,
    uppercase: true,
    trim: true,
    validate: {
      validator: function(v) {
        if (!v) return true; // Optional field
        return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(v);
      },
      message: 'Invalid MAC address format. Use XX:XX:XX:XX:XX:XX'
    }
  },
  
  equipmentId: {
    type: String,
    trim: true,
    unique: true,
    sparse: true
  },
  
  // ============================================
  // OLT PORT LOCATION
  // ============================================
  
  ponPort: {
    type: String,
    required: [true, 'PON port is required'],
    trim: true,
    index: true
    // Format examples: "1/1/1", "0/1", "gpon-olt_1/1/1"
  },
  
  onuId: {
    type: Number,
    required: [true, 'ONU ID is required'],
    min: [0, 'ONU ID cannot be negative'],
    max: [256, 'ONU ID cannot exceed 256']
  },
  
  // Compound index for unique ONU position on OLT
  // ============================================
  // HARDWARE DETAILS
  // ============================================
  
  brand: {
    type: String,
    enum: ['huawei', 'zte', 'fiberhome', 'vsol', 'other'],
    default: 'other'
  },
  
  model: {
    type: String,
    trim: true
  },
  
  firmwareVersion: {
    type: String,
    trim: true
  },
  
  hardwareVersion: {
    type: String,
    trim: true
  },
  
  // ============================================
  // NETWORK CONFIGURATION
  // ============================================
  
  vlan: {
    type: Number,
    required: [true, 'VLAN is required'],
    min: [1, 'VLAN must be at least 1'],
    max: [4094, 'VLAN cannot exceed 4094']
  },
  
  ipAddress: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        if (!v) return true; // Optional
        return /^(\d{1,3}\.){3}\d{1,3}$/.test(v);
      },
      message: 'Invalid IP address format'
    }
  },
  
  subnetMask: {
    type: String,
    trim: true
  },
  
  gateway: {
    type: String,
    trim: true
  },
  
  // Service profile (bandwidth, QoS, etc.)
  serviceProfile: {
    type: String,
    trim: true
  },
  
  lineProfile: {
    type: String,
    trim: true
  },
  
  // OLT-side service-port index (VLAN mapping/GEM-port allocation) assigned
  // during Skylink authorization — needed for troubleshooting/deprovisioning
  // and to keep the self-healing counter loop in authorizeOnuSkylink honest.
  servicePortIndex: {
    type: Number
  },
  
  // ============================================
  // BANDWIDTH CONFIGURATION
  // ============================================
  
  bandwidth: {
    upload: {
      type: Number,
      min: 0
    },
    download: {
      type: Number,
      min: 0
    },
    unit: {
      type: String,
      enum: ['Mbps', 'Kbps', 'Gbps'],
      default: 'Mbps'
    }
  },
  
  // ============================================
  // SIGNAL QUALITY METRICS
  // ============================================
  
  signal: {
    rxPower: {
      type: String, // e.g., "-18.5 dBm"
      trim: true
    },
    txPower: {
      type: String, // e.g., "2.5 dBm"
      trim: true
    },
    temperature: {
      type: Number // Celsius
    },
    voltage: {
      type: Number // Volts
    },
    biasCurrent: {
      type: Number // mA
    }
  },
  
  distance: {
    type: String, // e.g., "2.4 km"
    trim: true
  },
  
  // ============================================
  // OPERATIONAL STATUS
  // ============================================
  
  status: {
    type: String,
    enum: {
      values: ['online', 'offline', 'los', 'dying-gasp', 'inactive', 'unknown'],
      message: '{VALUE} is not a valid ONU status'
    },
    default: 'unknown',
    index: true
  },
  
  authStatus: {
    type: String,
    enum: ['pending_approval', 'authorized', 'rejected', 'unauthorized'],
    default: 'pending_approval'
    // pending_approval: discovered via autofind, awaiting admin decision (our default flow — no auto-authorize)
    // authorized: admin approved, OLT write succeeded
    // rejected: admin explicitly declined this discovered ONU
    // unauthorized: kept for backward compat / OLT-reported deauthorized state
  },

  discoveredAt: {
    type: Date,
    default: Date.now
    // when this serial first appeared via autofind on the OLT
  },

  rejectedAt: {
    type: Date,
    default: null
  },

  authorizedAt: {
    type: Date,
    default: null
  },
  
  isProvisioned: {
    type: Boolean,
    default: false,
    index: true
  },
  
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  
  // ============================================
  // UPTIME & CONNECTIVITY
  // ============================================
  
  uptime: {
    type: String,
    trim: true
  },
  
  lastSeen: {
    type: Date,
    index: true
  },
  
  lastOnline: {
    type: Date
  },
  
  lastOffline: {
    type: Date
  },
  
  onlineHistory: [{
    timestamp: Date,
    status: String,
    duration: Number // seconds
  }],
  
  // ============================================
  // STATISTICS
  // ============================================
  
  stats: {
    totalUptime: {
      type: Number,
      default: 0 // seconds
    },
    totalDowntime: {
      type: Number,
      default: 0 // seconds
    },
    disconnectCount: {
      type: Number,
      default: 0
    },
    lastDisconnectReason: {
      type: String,
      trim: true
    },
    bytesReceived: {
      type: Number,
      default: 0
    },
    bytesSent: {
      type: Number,
      default: 0
    },
    packetsReceived: {
      type: Number,
      default: 0
    },
    packetsSent: {
      type: Number,
      default: 0
    },
    errors: {
      type: Number,
      default: 0
    }
  },
  
  // ============================================
  // INSTALLATION DETAILS
  // ============================================
  
  installedAt: {
    type: Date,
    index: true
  },
  
  installedBy: {
    type: String,
    trim: true
  },
  
  location: {
    address: {
      type: String,
      trim: true
    },
    area: {
      type: String,
      trim: true
    },
    city: {
      type: String,
      trim: true
    },
    county: {
      type: String,
      trim: true
    },
    landmark: {
      type: String,
      trim: true
    },
    coordinates: {
      latitude: {
        type: Number,
        min: -90,
        max: 90
      },
      longitude: {
        type: Number,
        min: -180,
        max: 180
      }
    }
  },
  
  // Physical installation details
  installation: {
    cableType: {
      type: String,
      enum: ['dropwire', 'underground', 'aerial', 'other']
    },
    cableLength: {
      type: Number // meters
    },
    splitterRatio: {
      type: String // e.g., "1:8", "1:16"
    },
    notes: {
      type: String,
      maxlength: 1000
    }
  },
  
  // ============================================
  // CUSTOMER REFERENCE
  // ============================================
  
  customerName: {
    type: String,
    trim: true
  },
  
  customerPhone: {
    type: String,
    trim: true
  },
  
  accountId: {
    type: String,
    trim: true,
    index: true
  },
  
  // ============================================
  // ALERTS & MONITORING
  // ============================================
  
  alerts: [{
    type: {
      type: String,
      enum: ['offline', 'low-signal', 'high-temperature', 'errors', 'other']
    },
    message: String,
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    resolved: {
      type: Boolean,
      default: false
    },
    resolvedAt: Date
  }],
  
  // ============================================
  // MAINTENANCE & TROUBLESHOOTING
  // ============================================
  
  maintenanceHistory: [{
    date: Date,
    description: String,
    performedBy: String,
    issue: String,
    resolution: String,
    notes: String
  }],
  
  troubleshooting: {
    lastIssue: String,
    lastResolution: String,
    commonIssues: [String]
  },
  
  // ============================================
  // NOTES & COMMENTS
  // ============================================
  
  notes: {
    type: String,
    maxlength: [2000, 'Notes cannot exceed 2000 characters']
  },
  
  // ============================================
  // AUDIT TRAIL
  // ============================================
  
  createdBy: {
    type: String,
    trim: true
  },
  
  updatedBy: {
    type: String,
    trim: true
  },
  
  deactivatedAt: Date,
  deactivatedBy: String,
  deactivationReason: String
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ============================================
// INDEXES
// ============================================

onuSchema.index({ oltId: 1, ponPort: 1, onuId: 1 }, { unique: true });
onuSchema.index({ customerId: 1 });
onuSchema.index({ serialNumber: 1 });
onuSchema.index({ status: 1, isActive: 1 });
onuSchema.index({ siteId: 1, status: 1 });
onuSchema.index({ regionCode: 1, status: 1 });
onuSchema.index({ accountId: 1 });

// ============================================
// VIRTUALS
// ============================================

// Virtual for full location path
onuSchema.virtual('fullLocation').get(function() {
  return `${this.ponPort}/${this.onuId}`;
});

// Virtual for uptime percentage
onuSchema.virtual('uptimePercentage').get(function() {
  if (!this.stats) return 0;
  const total = this.stats.totalUptime + this.stats.totalDowntime;
  if (total === 0) return 0;
  return ((this.stats.totalUptime / total) * 100).toFixed(2);
});

// Virtual populate for customer details
onuSchema.virtual('customer', {
  ref: 'Customer',
  localField: 'customerId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for OLT details
onuSchema.virtual('olt', {
  ref: 'OLT',
  localField: 'oltId',
  foreignField: '_id',
  justOne: true
});

// ============================================
// METHODS
// ============================================

/**
 * Update ONU status
 */
onuSchema.methods.updateStatus = function(status, signal) {
  this.status = status;
  this.lastSeen = new Date();
  
  if (status === 'online') {
    this.lastOnline = new Date();
  } else if (status === 'offline') {
    this.lastOffline = new Date();
    this.stats.disconnectCount += 1;
  }
  
  if (signal) {
    this.signal = { ...this.signal, ...signal };
  }
  
  return this.save();
};

/**
 * Add alert
 */
onuSchema.methods.addAlert = function(type, message, severity = 'warning') {
  this.alerts.push({
    type,
    message,
    severity,
    timestamp: new Date()
  });
  
  // Keep only last 50 alerts
  if (this.alerts.length > 50) {
    this.alerts = this.alerts.slice(-50);
  }
  
  return this.save();
};

/**
 * Resolve latest alert
 */
onuSchema.methods.resolveLatestAlert = function() {
  if (this.alerts.length > 0) {
    const latestAlert = this.alerts[this.alerts.length - 1];
    if (!latestAlert.resolved) {
      latestAlert.resolved = true;
      latestAlert.resolvedAt = new Date();
    }
  }
  return this.save();
};

/**
 * Check if ONU has weak signal
 */
onuSchema.methods.hasWeakSignal = function() {
  if (!this.signal || !this.signal.rxPower) return false;
  const rxValue = parseFloat(this.signal.rxPower);
  return rxValue < -27; // Typical threshold for weak signal
};

/**
 * Get days since installation
 */
onuSchema.methods.getDaysSinceInstallation = function() {
  if (!this.installedAt) return null;
  const diff = Date.now() - this.installedAt.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

// ============================================
// STATICS
// ============================================

/**
 * Find ONUs by OLT
 */
onuSchema.statics.findByOlt = function(oltId, options = {}) {
  const query = { oltId };
  
  if (options.status) query.status = options.status;
  if (options.isActive !== undefined) query.isActive = options.isActive;
  
  return this.find(query).populate('customer', 'firstName lastName accountId phoneNumber');
};

/**
 * Find ONU by serial number
 */
onuSchema.statics.findBySerial = function(serialNumber) {
  return this.findOne({ serialNumber: serialNumber.toUpperCase() });
};

/**
 * Find ONUs by customer
 */
onuSchema.statics.findByCustomer = function(customerId) {
  return this.find({ customerId }).populate('olt', 'name ip');
};

/**
 * Find offline ONUs
 */
onuSchema.statics.findOffline = function(siteId) {
  const query = { status: { $in: ['offline', 'los'] } };
  if (siteId) query.siteId = siteId;
  
  return this.find(query).populate('customer olt');
};

/**
 * Get ONU statistics by site
 */
onuSchema.statics.getStatsBySite = function(siteId) {
  return this.aggregate([
    { $match: { siteId: mongoose.Types.ObjectId(siteId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
};

// ============================================
// MIDDLEWARE
// ============================================

// Before save: Update customer info
onuSchema.pre('save', async function(next) {
  if (this.isModified('customerId') && this.customerId) {
    try {
      const Customer = mongoose.model('Customer');
      const customer = await Customer.findById(this.customerId);
      if (customer) {
        this.customerName = `${customer.firstName} ${customer.lastName}`;
        this.customerPhone = customer.phoneNumber;
        this.accountId = customer.accountId;
      }
    } catch (error) {
      // Continue even if customer fetch fails
    }
  }
  
  next();
});

// After save: Update OLT stats
onuSchema.post('save', async function(doc) {
  try {
    const OLT = mongoose.model('OLT');
    const stats = await mongoose.model('ONU').aggregate([
      { $match: { oltId: doc.oltId } },
      {
        $group: {
          _id: null,
          totalOnus: { $sum: 1 },
          onlineOnus: {
            $sum: { $cond: [{ $eq: ['$status', 'online'] }, 1, 0] }
          },
          offlineOnus: {
            $sum: { $cond: [{ $eq: ['$status', 'offline'] }, 1, 0] }
          },
          authorizedOnus: {
            $sum: { $cond: [{ $eq: ['$authStatus', 'authorized'] }, 1, 0] }
          }
        }
      }
    ]);
    
    if (stats.length > 0) {
      await OLT.findByIdAndUpdate(doc.oltId, {
        'stats.totalOnus': stats[0].totalOnus,
        'stats.onlineOnus': stats[0].onlineOnus,
        'stats.offlineOnus': stats[0].offlineOnus,
        'stats.authorizedOnus': stats[0].authorizedOnus,
        'stats.lastUpdated': new Date()
      });
    }
  } catch (error) {
    // Don't fail save if stats update fails
    console.error('Error updating OLT stats:', error);
  }
});

module.exports = mongoose.model('ONU', onuSchema);