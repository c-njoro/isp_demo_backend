const mongoose = require('mongoose');

const RouterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  site: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  ip: { type: String, required: true },
  apiPort: { type: Number, default: 8728 },
  username: { type: String, required: true },
  password: { type: String, required: true },
  regionCode: String,
  // Optional: track online status
  isOnline: { type: Boolean, default: false },
  lastOnline: Date,
  lastConnectionTest: {
    success: Boolean,
    timestamp: Date,
    error: String
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Router', RouterSchema);