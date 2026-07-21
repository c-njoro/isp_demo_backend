const mongoose = require('mongoose');

const BulkSmsJobSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  total: { type: Number, default: 0 },
  processed: { type: Number, default: 0 },
  succeeded: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  errors: [
    {
      accountId: String,
      phoneNumber: String,
      error: String,
    },
  ],
  filters: { type: mongoose.Schema.Types.Mixed, default: {} },
  message: { type: String },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SmsTemplate' },
  type: { type: String, default: 'bulk' },
  regionCode: { type: String },
  triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  startedAt: { type: Date },
  finishedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('BulkSmsJob', BulkSmsJobSchema);