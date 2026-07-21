const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PaymentSchema = new Schema({
  // Payment Request Details
  customerType: {
    type: String,
    enum: ['pppoe', 'hotspot', 'lead'],
    required: true
  },

  source: {
    type: String,
    enum: ['stk', 'till', 'manual', 'manual_deposit', 'payment_transfer'],
    default: 'stk'
  },

  resolutionStatus: {
    type: String,
    enum: ['pending', 'processed', 'unmatched'],
    default: 'pending'
  },

  stkID: { type: String,  unique: true, index: true },
  checkoutRequestId: { type: String,  unique: true, index: true },
  
  customerId: {
    type: Schema.Types.ObjectId,
    required: function () {
      return this.customerType === 'pppoe';
    }
  },

  leadId: {
    type: Schema.Types.ObjectId,
    required: function () {
      return this.customerType === 'lead';
    }
  },
  
  accountId: {
    type: String,
    required: true
  },
  
  regionCode: {
    type: String,
    required: true,
    uppercase: true
  },
  
  siteId: {
    type: Schema.Types.ObjectId,
    ref: 'Site'
  },
  
  // Amount
  amount: {
    type: Number,
    required: true
  },
  
  packageId: {
    type: Schema.Types.ObjectId,
    ref: 'Package',
    required: true
  },
  
  // STK Push Details
  stkPush: {
    phoneNumber: {
      type: String,
      
    },
    checkoutRequestId: {
      type: String
      // Daraja checkout request ID
    },
    merchantRequestId: {
      type: String
      // Daraja merchant request ID
    },
    initiatedAt: {
      type: Date,
      default: Date.now
    },
    resultCode: {
      type: String
    },
    resultDesc: {
      type: String
    }
  },
  
  // Payment Status
  status: {
    type: String,
    enum: ['initiated', 'pending', 'completed', 'failed', 'cancelled', 'timeout', 'moved'],
    default: 'initiated'
  },
  
  // Callback tracking
  callbackReceived: {
    type: Boolean,
    default: false
  },
  
  callbackData: {
    type: Schema.Types.Mixed
    // Store full callback response
  },
  
  // Transaction Reference
  transactionId: {
    type: Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  
  mpesaReceiptNumber: {
    type: String
  },
  
  // Error tracking
  error: {
    code: String,
    message: String
  },
  
// Kopo Kopo specific fields
kopokopoPaymentId: {
  type: String,
  index: true
},

kopokopoLocation: {
  type: String // URL to query payment status
},

kopokopoReceiptNumber: {
  type: String,
  index: true
},

kopokopoTransactionDate: {
  type: Date
},

paymentChannel: {
  type: String,
  enum: ['mpesa', 'airtel', 'card', 'bank', 'cash'],
  default: 'mpesa'
},

// Update paymentMethod to support multiple channels
paymentMethod: {
  type: String,
  enum: ['mpesa', 'airtel', 'card', 'bank', 'cash', 'wallet'],
  default: 'mpesa'
},

// Metadata now stores more information
metadata: {
  type: mongoose.Schema.Types.Mixed,
  default: {}
  // Can contain:
  // - packageId
  // - packageName
  // - phoneNumber
  // - initiatedAt
  // - webhookReceivedAt
  // - webhookData
  // - paymentUrl (for cards)
  // - transferHistory (for moved payments)
}
}, {
  timestamps: true
});

// Indexes
PaymentSchema.index({ customerId: 1, status: 1 });
PaymentSchema.index({ 'stkPush.checkoutRequestId': 1 });
PaymentSchema.index({ status: 1, createdAt: -1 });
PaymentSchema.index({ regionCode: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', PaymentSchema);