// models/IfaceStatsTimeseries.js
//
// Raw bandwidth samples, one row per router+interface per poll (every 5 min,
// see services/pollers/bandwidthPoller.js).
//
// rxBps/txBps are the COMPUTED rate since the previous sample, not raw
// cumulative counters. rxBytesRaw/txBytesRaw are the raw cumulative counters
// AT THE TIME OF THIS SAMPLE — they exist purely so the next poll has
// something to diff against without needing a separate "last known counter"
// collection. Don't use rxBytesRaw/txBytesRaw for anything except computing
// the next delta; for "how much traffic happened", use rxBps/txBps.
//
// TTL index on sampledAt auto-expires documents after 24 hours, matching the
// frontend's history window ceiling (the bandwidth panel's dropdown tops out
// at 24h — see RouterBandwidthPanel.tsx). This is intentionally a HARD
// retention limit, not just a UI cap: data is not kept anywhere beyond 24h.
// If that ever changes (e.g. a future "7 day" view), raise this value AND
// the frontend's window options together — they're meant to stay in sync.
//
// MongoDB's TTL background task runs roughly every 60 seconds, so actual
// deletion lags `expires` by up to ~a minute; this is normal and not
// something the app needs to compensate for.

const mongoose = require('mongoose');

const IfaceStatsTimeseriesSchema = new mongoose.Schema({
  routerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Router',
    required: true
  },
  iface: { type: String, required: true },

  rxBps: { type: Number, default: 0 },
  txBps: { type: Number, default: 0 },

  // Raw cumulative counters at sample time — used only to compute the NEXT
  // sample's delta. A router reboot resets these to near-zero; the poller
  // detects that case (current < last) and treats the delta as the current
  // raw value rather than letting it go negative.
  rxBytesRaw: { type: Number, default: 0 },
  txBytesRaw: { type: Number, default: 0 },

  // Negotiated link speed at sample time (e.g. "1Gbps"). Can be null for
  // non-ethernet interfaces (bridges, VLANs) or a port that's currently down.
  ifSpeed: { type: String, default: null },

  sampledAt: {
    type: Date,
    required: true,
    default: Date.now,
    expires: 60 * 60 * 24 * 30 // 30 days (in seconds)
  }
});

// Compound index for the poller's "give me the last sample for this
// router+interface" lookup, sorted by recency.
IfaceStatsTimeseriesSchema.index({ routerId: 1, iface: 1, sampledAt: -1 });

module.exports = mongoose.model('IfaceStatsTimeseries', IfaceStatsTimeseriesSchema);