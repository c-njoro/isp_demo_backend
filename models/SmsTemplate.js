const mongoose = require('mongoose');

const smsTemplateSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    // Examples: 'welcome', 'payment_confirmation', 'payment_wallet', 'expiry_warning', 'bulk_general'
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  subject: {
    type: String,
    trim: true,
    default: '',
  },
  body: {
    type: String,
    required: true,
    trim: true,
  },
  placeholders: {
    type: [String],
    default: ['customerName'],
    // e.g. ['customerName', 'amount', 'newBalance', 'expiryDate']
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  description: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('SmsTemplate', smsTemplateSchema);