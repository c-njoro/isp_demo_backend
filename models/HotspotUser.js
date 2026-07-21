const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const HotspotUserSchema = new Schema({
  // Identification (usually by MAC address)
  macAddress: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
    // Format: F0:9F:C2:E4:6A:B1
  },

  firstName: {
    type: String,
    default: null
  },
  lastName: {
    type: String,
    default: null
  },
  
  phoneNumber: {
    type: String
    // Optional - for customer lookup
  },

  paymentCounter: { type: Number, default: 0 },
  
  regionCode: {
    type: String,
    required: true,
    uppercase: true
  },
  
  siteId: {
    type: Schema.Types.ObjectId,
    ref: 'Site',
    required: true
  },
  
  // Current Active Session
  activeSession: {
    packageId: {
      type: Schema.Types.ObjectId,
      ref: 'Package'
    },
    startedAt: {
      type: Date
    },
    expiresAt: {
      type: Date
    },
    dataLimit: {
      type: Number
      // In MB
    },
    dataUsed: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: false
    }
  },
  
  // Connection Status
  isOnline: {
    type: Boolean,
    default: false
  },
  
  lastSeenAt: {
    type: Date
  },

  kickedAt: {
    type: Date,
    default: null,
  },
  
  // Purchase History (limited to last 10)
  purchaseHistory: [{
    packageId: {
      type: Schema.Types.ObjectId,
      ref: 'Package'
    },
    purchasedAt: {
      type: Date,
      default: Date.now
    },
    amount: Number,
    transactionId: {
      type: String,
      
    }
  }],
  
  radiusId: {
    type: String
  },
  
  notes: String
}, {
  timestamps: true
});

// Indexes
HotspotUserSchema.index({ macAddress: 1 });
HotspotUserSchema.index({ phoneNumber: 1 });
HotspotUserSchema.index({ regionCode: 1, 'activeSession.isActive': 1 });
HotspotUserSchema.index({ siteId: 1 });

module.exports = mongoose.model('HotspotUser', HotspotUserSchema);