const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PackageSchema = new Schema({
  packageName: {
    type: String,
    required: true,
    trim: true
    // e.g., '12Mbps', '24Hrs 10GB'
  },
  
  packageType: {
    type: String,
    required: true,
    enum: ['ppp', 'hotspot'],
    // ppp = PPPoE fixed home internet
    // hotspot = time/data bundles
  },
  
  regionCode: {
    type: String,
    required: true,
    uppercase: true
    // Package pricing varies by region
  },
  
  siteId: {
    type: Schema.Types.ObjectId,
    ref: 'Site',
    required: true
  },
  
  // Speed Configuration (for both types)
  speed: {
    download: {
      type: Number,
      required: true
      // In Mbps
    },
    upload: {
      type: Number,
      required: true
      // In Mbps
    },
    burstSpeed: {
      type: Number,
      default: 0
    },
    burstThreshold: {
      type: Number,
      default: 0
    },
    burstTime: {
      type: Number,
      default: 0
    },
    burstEnabled: {
      type: Boolean,
      default: false
    }
  },

  applicableToRouters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Router', default: [] }],

  fup: {
    enabled: { type: Boolean, default: false },
    dataThresholdGB: { type: Number, default: 0 },    // e.g., 100
    throttleDownloadMbps: { type: Number, default: 1 },
    throttleUploadMbps: { type: Number, default: 1 },
    resetPeriod: { type: String, enum: ['monthly', 'billingCycle'], default: 'billingCycle' }
  },
  
  // Pricing
  price: {
    type: Number,
    required: true
    // In KSH
  },
  
  // Period Configuration
  period: {
    type: Number,
    required: true
    // For PPP: usually 2592000 (30 days in minutes)
    // For Hotspot: could be hours/minutes
  },
  
  periodUnit: {
    type: String,
    enum: ['m', 'h', 'd'], // minutes, hours, days
    default: 'm'
  },
  
  // Data Cap (mainly for hotspot)
  dataLimit: {
    type: Number,
    default: 0
    // 0 = unlimited
    // For hotspot: in MB (e.g., 10000 = 10GB)
  },
  
  // RADIUS Configuration
  radiusAttributes: {
    framedProtocol: {
      type: String,
      default: 'PPP'
    },
    // Other RADIUS attributes as needed
  },
  
  description: {
    type: String
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  priority: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});

// Indexes
PackageSchema.index({ packageType: 1, regionCode: 1 });
PackageSchema.index({ siteId: 1, isActive: 1 });
PackageSchema.index({ regionCode: 1, isActive: 1 });

module.exports = mongoose.model('Package', PackageSchema);