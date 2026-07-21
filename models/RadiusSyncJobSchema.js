// models/RadiusSyncJob.js
const mongoose = require('mongoose');

const RadiusSyncJobSchema = new mongoose.Schema({
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  total: { type: Number, default: 0 },
  processed: { type: Number, default: 0 },
  created: { type: Number, default: 0 },
  updatedGroup: { type: Number, default: 0 },
  disabled: { type: Number, default: 0 },
  errors: { type: Array, default: [] },
  details: { type: Array, default: [] },  // optional, could be large
  dryRun: { type: Boolean, default: false },
  regionCode: { type: String },
  fixGroups: { type: Boolean, default: true },
  startedAt: Date,
  finishedAt: Date,
  triggeredBy: mongoose.Schema.Types.ObjectId,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RadiusSyncJob', RadiusSyncJobSchema);