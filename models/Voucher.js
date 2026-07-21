const mongoose = require('mongoose');

const voucherCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    used: { type: Boolean, default: false },
    usedAt: { type: Date, default: null },
    usedByMac: { type: String, default: null }, // recorded for audit, not for validation
  },
  { _id: false }
);

const voucherSchema = new mongoose.Schema(
  {
    // Human-readable prefix / batch identifier (e.g. "AWWK")
    prefix: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Package',
      required: true,
    },

    description: { type: String, default: '' },

    // Array of individual one-time-use codes
    codes: {
      type: [voucherCodeSchema],
      default: [],
    },

    enjoyUntil: {
      type: Date,
      default: null
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Fast lookup: find a voucher batch that owns a specific code
voucherSchema.index({ 'codes.code': 1 });

// Convenience virtuals
voucherSchema.virtual('totalCodes').get(function () {
  return this.codes.length;
});
voucherSchema.virtual('usedCodes').get(function () {
  return this.codes.filter((c) => c.used).length;
});
voucherSchema.virtual('remainingCodes').get(function () {
  return this.codes.filter((c) => !c.used).length;
});

voucherSchema.set('toJSON', { virtuals: true });
voucherSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.Voucher || mongoose.model('Voucher', voucherSchema);