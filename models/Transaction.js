const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TransactionSchema = new Schema({
  // Transaction Type
  type: {
    type: String,
    required: true,
    enum: ['MPESA', 'SUBSCRIPTION', 'REFUND', 'ADJUSTMENT', 'PENALTY', 'WALLET', 'PARENT-TO-CHILD', 'CASH_DEPOSIT', 'EXPENSE', 'MOVED_PAYMENT', 'PLAN_CHANGE', 'PRORATED_MOVE'],
    // MPESA = money coming in (credit)
    // SUBSCRIPTION = money allocated to subscription (debit)
    // REFUND = money going back
    // ADJUSTMENT = manual correction
    // PENALTY = late payment fee
  },
  
  // Account Reference
  customerType: {
    type: String,
    enum: ['pppoe', 'hotspot'],
    required: true
  },
  
  customerId: {
    type: Schema.Types.ObjectId,
    // Reference to Customer or HotspotUser
    required: true
  },
  
  accountId: {
    type: String
    // SKY0099 or MAC address for quick lookup
  },
  
  firstName: String,
  lastName: String,
  
  regionCode: {
    type: String,
    required: true,
    uppercase: true,
    index: true
  },
  
  siteId: {
    type: Schema.Types.ObjectId,
    ref: 'Site'
  },
  
  // Transaction Details
  amount: {
    type: Number,
    required: true
    // Positive = credit (money in)
    // Negative = debit (money out/allocated)
  },
  
  description: {
    type: String,
    required: true
  },
  
  // Payment Method Details
  paymentMethod: {
    type: String,
    enum: ['stk_push', 'till', 'paybill', 'cash', 'bank_transfer', 'adjustment', 'transfer', 'mpesa', 'airtel', 'card', 'bank', 'cash', 'wallet'],
    required: true
  },
  
  // M-Pesa Specific Fields
  mpesa: {
    transactionId: {
      type: String
      // M-Pesa receipt number
    },
    phoneNumber: {
      type: String
      // Phone number that made payment
    },
    accountReference: {
      type: String
      // What customer entered in M-Pesa
    },
    transactionDate: {
      type: Date
    }
  },
  
  // Reference to Related Transactions
  // For double-entry: MPESA transaction references its SUBSCRIPTION counterpart
  relatedTransactionId: {
    type: Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  
  // Package Reference (for subscription transactions)
  packageId: {
    type: Schema.Types.ObjectId,
    ref: 'Package'
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'reversed'],
    default: 'pending'
  },
  
  // Verification
  verifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Admin'
  },
  
  verifiedAt: {
    type: Date
  },
  
  // Additional Notes
  notes: String,
  
  processedBy: {
    type: String,
    default: 'system'
    // 'system' or admin ID
  }
}, {
  timestamps: true
});

// Indexes
TransactionSchema.index({ customerId: 1, createdAt: -1 });
TransactionSchema.index({ regionCode: 1, createdAt: -1 });
TransactionSchema.index({ type: 1, status: 1 });
TransactionSchema.index({ 'mpesa.transactionId': 1 });
TransactionSchema.index({ accountId: 1, createdAt: -1 });
TransactionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);