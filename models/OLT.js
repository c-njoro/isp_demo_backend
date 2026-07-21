const mongoose = require('mongoose');

/**
 * OLT (Optical Line Terminal) Model
 * Represents a physical OLT device at a site
 * Each OLT can have multiple PON ports and serve multiple ONUs
 */
const oltSchema = new mongoose.Schema({
  // ============================================
  // BASIC INFORMATION
  // ============================================
  
  name: {
    type: String,
    required: [true, 'OLT name is required'],
    trim: true,
    maxlength: [100, 'OLT name cannot exceed 100 characters']
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  
  // ============================================
  // SITE & REGION ASSOCIATION
  // ============================================
  
  siteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    required: [true, 'Site ID is required'],
    index: true
  },

  // The specific MikroTik this OLT's management port physically connects
  // through (directly via LAN cable, or via a switch on the same segment).
  // This OLT's `ip` is only reachable through this router's OpenVPN tunnel,
  // so this field is required for routing/reachability, not just inventory.
  routerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Router',
    required: [true, 'Router ID is required — the OLT must be reachable through a known MikroTik tunnel'],
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
  // CONNECTION DETAILS
  // ============================================
  
  ip: {
    type: String,
    required: [true, 'OLT IP address is required'],
    trim: true,
    validate: {
      validator: function(v) {
        // Basic IP validation (supports both IPv4 and hostnames)
        return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || /^[a-zA-Z0-9.-]+$/.test(v);
      },
      message: 'Please provide a valid IP address or hostname'
    }
  },
  
  port: {
    type: Number,
    default: 80,
    min: [1, 'Port must be at least 1'],
    max: [65535, 'Port cannot exceed 65535']
  },
  
  username: {
    type: String,
    required: [true, 'OLT username is required'],
    trim: true
  },
  
  password: {
    type: String,
    required: [true, 'OLT password is required'],
    select: false // Don't return password by default
  },
  
  apiType: {
    type: String,
    enum: {
      values: ['ssh', 'telnet', 'snmp', 'cli', 'rest', 'smartolt'],
      message: '{VALUE} is not a supported API type'
    },
    default: 'ssh'
  },
  
  // SSL/TLS configuration
  useSSL: {
    type: Boolean,
    default: false
  },

  // ============================================
  // SSH CONNECTION DETAIL
  // ============================================
  // Tuning knobs for the SSH/MML session itself. Defaults match what
  // huawei.js / zte.js already use for connectionTimeout — exposing them
  // here means per-OLT overrides are possible without touching code
  // (useful for a slow/flaky tunnel link to a specific site).

  ssh: {
    connectTimeoutMs: {
      type: Number,
      default: 15000,
      min: 1000
    },
    commandTimeoutMs: {
      type: Number,
      default: 15000,
      min: 1000
    },
    retryAttempts: {
      type: Number,
      default: 2,
      min: 0,
      max: 5
    },
    retryDelayMs: {
      type: Number,
      default: 2000,
      min: 0
    },
    hostKeyFingerprint: {
      type: String,
      trim: true
      // Optional: pin the expected host key fingerprint to detect
      // MITM/device-swap on this management IP. Left blank = not enforced.
    }
  },

  // ============================================
  // SNMP CONFIGURATION (secondary channel — optical/health polling)
  // ============================================
  // SSH/MML remains the channel for authorization and provisioning writes.
  // SNMP is read-only here, used for periodic optical power and chassis
  // health polling without opening a full SSH session every cycle.

  snmp: {
    enabled: {
      type: Boolean,
      default: false
    },
    version: {
      type: String,
      enum: ['1', '2c', '3'],
      default: '2c'
    },
    community: {
      type: String,
      trim: true,
      select: false // sensitive, same treatment as password
    },
    port: {
      type: Number,
      default: 161
    },
    // SNMPv3 fields, only relevant if version === '3'
    v3: {
      username: { type: String, trim: true },
      authProtocol: { type: String, enum: ['MD5', 'SHA', null], default: null },
      authKey: { type: String, trim: true, select: false },
      privProtocol: { type: String, enum: ['DES', 'AES', null], default: null },
      privKey: { type: String, trim: true, select: false }
    }
  },
  
  // ============================================
  // HARDWARE SPECIFICATIONS
  // ============================================
  
  brand: {
    type: String,
    enum: {
      values: ['huawei', 'zte', 'fiberhome', 'smartolt', 'other'],
      message: '{VALUE} is not a supported brand'
    },
    default: 'huawei',
    required: [true, 'OLT brand is required'],
  },
  
  model: {
    type: String,
    trim: true
  },
  
  serialNumber: {
    type: String,
    trim: true,
    unique: true,
    sparse: true // Allow null values but enforce uniqueness when present
  },
  
  firmwareVersion: {
    type: String,
    trim: true
  },
  
  ponPorts: {
    type: Number,
    default: 16,
    min: [1, 'Must have at least 1 PON port'],
    max: [64, 'Cannot exceed 64 PON ports']
  },

  // Which physical slots actually host GPON boards on this chassis —
  // confirmed by running `display board 0` once, by hand, after the OLT
  // is reachable. NOT a guess: looping every slot from 0 to ponPorts
  // against a real chassis means hitting slots with no board at all
  // (control boards, uplink boards, empty slots), which is slow or hangs
  // per slot and is exactly what caused the ONU-listing endpoint to time
  // out against a real device. Leave empty until confirmed — discovery/
  // listing functions should refuse to run a blind sweep rather than
  // guess this wrong again.
  gponSlots: {
    type: [Number],
    default: []
  },

  // Full chassis board table as discovered by testConnection — every
  // slot, not just GPON ones. Lets the frontend show real chassis info
  // (control board, uplink board, etc.) without a separate API call.
  // Overwritten wholesale on each successful test, not diffed field by
  // field, since it's a snapshot of "what's in the chassis right now."
  discoveredBoards: {
    type: [{
      slot: Number,
      boardName: String,
      status: String,
      isGponBoard: Boolean
    }],
    default: []
  },
  
  maxOnusPerPort: {
    type: Number,
    default: 128,
    min: [1, 'Must support at least 1 ONU per port'],
    max: [256, 'Cannot exceed 256 ONUs per port']
  },
  
  // ============================================
  // OPERATIONAL STATUS
  // ============================================
  
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  
  status: {
    type: String,
    enum: {
      values: ['online', 'offline', 'unreachable', 'maintenance', 'unknown'],
      message: '{VALUE} is not a valid status'
    },
    default: 'unknown',
    index: true
  },
  
  lastChecked: {
    type: Date,
    index: true
  },
  
  lastOnline: {
    type: Date
  },
  
  // ============================================
  // STATISTICS (Updated Periodically)
  // ============================================
  
  stats: {
    totalOnus: {
      type: Number,
      default: 0
    },
    onlineOnus: {
      type: Number,
      default: 0
    },
    offlineOnus: {
      type: Number,
      default: 0
    },
    authorizedOnus: {
      type: Number,
      default: 0
    },
    unauthorizedOnus: {
      type: Number,
      default: 0
    },
    temperature: {
      type: Number // in Celsius
    },
    uptime: {
      type: String
    },
    cpuUsage: {
      type: Number // percentage
    },
    memoryUsage: {
      type: Number // percentage
    },
    // Chassis hardware health — populated by getSystemInfo()/board polling.
    // Mirrors what `display board 0` / `show card` already return on
    // Huawei/ZTE; parsing these out gives a real health dashboard instead
    // of just raw text dumps.
    powerSupplies: [{
      slot: String,
      status: { type: String, enum: ['normal', 'fault', 'absent', 'unknown'], default: 'unknown' }
    }],
    fans: [{
      slot: String,
      status: { type: String, enum: ['normal', 'fault', 'absent', 'unknown'], default: 'unknown' },
      speedPercent: Number
    }],
    slotsTotal: { type: Number },
    slotsOccupied: { type: Number },
    lastUpdated: {
      type: Date
    }
  },
  
  // ============================================
  // NETWORK CONFIGURATION
  // ============================================
  
  vlanRange: {
    start: {
      type: Number,
      min: 1,
      max: 4094
    },
    end: {
      type: Number,
      min: 1,
      max: 4094
    }
  },
  
  managementVlan: {
    type: Number,
    min: 1,
    max: 4094
  },
  
  // ============================================
  // LOCATION & INSTALLATION
  // ============================================
  
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
  
  installedAt: {
    type: Date
  },
  
  installedBy: {
    type: String,
    trim: true
  },
  
  // ============================================
  // CONTACT & SUPPORT
  // ============================================
  
  contactPerson: {
    name: {
      type: String,
      trim: true
    },
    phone: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    }
  },
  
  // ============================================
  // MONITORING & ALERTS
  // ============================================
  
  monitoring: {
    enabled: {
      type: Boolean,
      default: true
    },
    interval: {
      type: Number,
      default: 300, // seconds (5 minutes)
      min: 60,
      max: 3600
    },
    alertOnOffline: {
      type: Boolean,
      default: true
    },
    alertEmail: {
      type: String,
      trim: true,
      lowercase: true
    },
    alertPhone: {
      type: String,
      trim: true
    }
  },
  
  // ============================================
  // MAINTENANCE & NOTES
  // ============================================
  
  maintenanceSchedule: [{
    date: Date,
    description: String,
    performedBy: String,
    notes: String
  }],
  
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
  }
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ============================================
// INDEXES
// ============================================

oltSchema.index({ siteId: 1, isActive: 1 });
oltSchema.index({ routerId: 1, isActive: 1 });
oltSchema.index({ regionCode: 1, isActive: 1 });
oltSchema.index({ status: 1 });
oltSchema.index({ ip: 1 });

// ============================================
// VIRTUALS
// ============================================

// Virtual for total capacity
oltSchema.virtual('totalCapacity').get(function() {
  return this.ponPorts * this.maxOnusPerPort;
});

// Virtual for utilization percentage
oltSchema.virtual('utilization').get(function() {
  if (!this.stats || !this.stats.totalOnus) return 0;
  return ((this.stats.totalOnus / this.totalCapacity) * 100).toFixed(2);
});

// Virtual populate for ONUs
oltSchema.virtual('onus', {
  ref: 'ONU',
  localField: '_id',
  foreignField: 'oltId'
});

// ============================================
// METHODS
// ============================================

/**
 * Update OLT statistics
 */
oltSchema.methods.updateStats = function(stats) {
  this.stats = {
    ...this.stats,
    ...stats,
    lastUpdated: new Date()
  };
  this.lastChecked = new Date();
  return this.save();
};

/**
 * Mark OLT as online
 */
oltSchema.methods.markOnline = function() {
  this.status = 'online';
  this.lastOnline = new Date();
  this.lastChecked = new Date();
  return this.save();
};

/**
 * Mark OLT as offline
 */
oltSchema.methods.markOffline = function() {
  this.status = 'offline';
  this.lastChecked = new Date();
  return this.save();
};

/**
 * Get available capacity
 */
oltSchema.methods.getAvailableCapacity = function() {
  const total = this.totalCapacity;
  const used = this.stats?.totalOnus || 0;
  return total - used;
};

/**
 * Get the Router (MikroTik) this OLT's management port connects through
 */
oltSchema.methods.getRouter = async function() {
  const Router = mongoose.model('Router');
  return await Router.findById(this.routerId);
};

/**
 * Check if OLT can accept more ONUs
 */
oltSchema.methods.canAcceptOnu = function() {
  return this.getAvailableCapacity() > 0 && this.isActive && this.status === 'online';
};

// ============================================
// STATICS
// ============================================

/**
 * Find active OLTs at a site
 */
oltSchema.statics.findActiveBySite = function(siteId) {
  return this.find({ 
    siteId, 
    isActive: true,
    status: { $in: ['online', 'unknown'] }
  });
};

/**
 * Find OLT by IP
 */
oltSchema.statics.findByIp = function(ip) {
  return this.findOne({ ip });
};

/**
 * Get OLTs with available capacity
 */
oltSchema.statics.findWithCapacity = function(siteId) {
  return this.aggregate([
    {
      $match: {
        siteId: mongoose.Types.ObjectId(siteId),
        isActive: true,
        status: 'online'
      }
    },
    {
      $addFields: {
        totalCapacity: { $multiply: ['$ponPorts', '$maxOnusPerPort'] },
        usedCapacity: { $ifNull: ['$stats.totalOnus', 0] }
      }
    },
    {
      $match: {
        $expr: { $lt: ['$usedCapacity', '$totalCapacity'] }
      }
    }
  ]);
};

// ============================================
// MIDDLEWARE
// ============================================

// Before save: Update timestamps and validation
oltSchema.pre('save', function(next) {
  // Validate VLAN range
  if (this.vlanRange && this.vlanRange.start > this.vlanRange.end) {
    next(new Error('VLAN range start must be less than or equal to end'));
  }
  
  next();
});

// After find: Don't return password by default
oltSchema.post('find', function(docs) {
  docs.forEach(doc => {
    if (doc.password) {
      doc.password = undefined;
    }
  });
});

module.exports = mongoose.model('OLT', oltSchema);