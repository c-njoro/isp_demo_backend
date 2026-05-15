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
      values: ['rest', 'snmp', 'cli', 'smartolt', 'telnet', 'ssh'],
      message: '{VALUE} is not a supported API type'
    },
    default: 'smartolt'
  },
  
  // SSL/TLS configuration
  useSSL: {
    type: Boolean,
    default: false
  },
  
  // ============================================
  // HARDWARE SPECIFICATIONS
  // ============================================
  
  brand: {
    type: String,
    enum: {
      values: ['smartolt', 'huawei', 'zte', 'fiberhome', 'other'],
      message: '{VALUE} is not a supported brand'
    },
    default: 'smartolt',
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