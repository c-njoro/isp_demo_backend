const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const InvoiceSchema = new Schema({
  // Invoice Number (auto-generated)
  invoiceNumber: {
    type: String,
    required: true,
    unique: true
    // Format: INV-SKY-2024-0001
  },
  
  regionCode: {
    type: String,
    required: true,
    uppercase: true
  },
  
  // Customer Reference
  customerType: {
    type: String,
    enum: ['pppoe', 'hotspot'],
    required: true
  },
  
  customerId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  
  accountId: {
    type: String,
    required: true
  },
  
  customerName: {
    type: String,
    required: true
  },
  
  customerPhone: {
    type: String
  },
  
  customerEmail: {
    type: String
  },
  
  // Invoice Details
  packageId: {
    type: Schema.Types.ObjectId,
    ref: 'Package',
    required: true
  },
  
  packageName: {
    type: String,
    required: true
  },
  
  // Amounts
  subtotal: {
    type: Number,
    required: true
  },
  
  discount: {
    type: Number,
    default: 0
  },
  
  total: {
    type: Number,
    required: true
  },
  
  // Period Covered
  periodStart: {
    type: Date,
    required: true
  },
  
  periodEnd: {
    type: Date,
    required: true
  },
  
  // Payment Reference
  transactionId: {
    type: Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  
  paymentId: {
    type: Schema.Types.ObjectId,
    ref: 'Payment'
  },
  
  mpesaReceiptNumber: {
    type: String
  },
  
  // Status
  status: {
    type: String,
    enum: ['draft', 'issued', 'paid', 'cancelled'],
    default: 'draft'
  },
  
  issuedAt: {
    type: Date
  },
  
  paidAt: {
    type: Date
  },
  
  // Notes
  notes: String,
  
  generatedBy: {
    type: String,
    default: 'system'
  }
}, {
  timestamps: true
});

// Indexes
InvoiceSchema.index({ invoiceNumber: 1 });
InvoiceSchema.index({ customerId: 1, status: 1 });
InvoiceSchema.index({ regionCode: 1, createdAt: -1 });
InvoiceSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Invoice', InvoiceSchema);