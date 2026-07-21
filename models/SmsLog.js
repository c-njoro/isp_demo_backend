const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SmsLogSchema = new Schema({
  recipient: {
    phoneNumber: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    accountId: { type: String }
  },
  message: { type: String, required: true },
  type: {
    type: String,
    enum: ['payment_confirmation', 'subscription_renewal', 'expiry_warning',
           'expiry_notice', 'welcome', 'general', 'bulk', 'personalized', 'otp', 'voucher_codes'],
    required: true
  },
  regionCode: { type: String, uppercase: true },
  provider: { type: String, enum: ['mobile_sasa', 'africas_talking', 'twilio'], default: 'mobile_sasa' },
  messageId: { type: String },
  status: { type: String, enum: ['sent', 'failed', 'pending'], default: 'pending' },
  cost: { type: Number },
  error: { code: String, message: String },
  sentAt: { type: Date }
}, { timestamps: true });

SmsLogSchema.index({ 'recipient.phoneNumber': 1, createdAt: -1 });
SmsLogSchema.index({ 'recipient.accountId': 1, createdAt: -1 });
SmsLogSchema.index({ type: 1, status: 1 });
SmsLogSchema.index({ regionCode: 1, createdAt: -1 });

module.exports = mongoose.model('SmsLog', SmsLogSchema);