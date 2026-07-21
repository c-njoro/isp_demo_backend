const mongoose = require('mongoose');

const RouterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  site: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  ip: { type: String, required: true },
  apiPort: { type: Number, default: 8728 },
  username: { type: String, required: true },
  password: { type: String, required: true },
  regionCode: String,
  tunnelIp:      { type: String,  default: null },
vpnClientName: { type: String,  default: null },
vpnConnected:  { type: Boolean, default: false },
vpnLastSeen:   { type: Date,    default: null },
  isOnline: { type: Boolean, default: false },
  hotspotPackages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Package', default: [] }],
  lastOnline: Date,
  lastConnectionTest: {
    success: Boolean,
    timestamp: Date,
    error: String
  },
  isActive: { type: Boolean, default: true },
  lastPollSuccessful: { type: Boolean, default: true },
lastPollTimestamp: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Router', RouterSchema);