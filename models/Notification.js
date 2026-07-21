const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  // Region & site for multi‑site scoping
  regionCode: { type: String, required: true, index: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },

  // Recipient – either a specific Admin/User or a role
  recipientType: { type: String, enum: ['admin', 'user', 'role'], default: 'admin' },
  recipientId: { type: mongoose.Schema.Types.ObjectId, refPath: 'recipientModel' },
  recipientModel: { type: String, enum: ['Admin', 'User'] },
  recipientRole: { type: String, enum: ['super_admin', 'admin', 'manager', 'tech', 'accounts'] },

  // Notification content
  type: { 
    type: String, 
    enum: ['system', 'payment', 'expiry', 'outage', 'customer', 'support', 'alert'], 
    default: 'system' 
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed },

  // Delivery channels
  channels: [{ type: String, enum: ['in-app', 'sms', 'whatsapp'] }],
  delivered: { type: Boolean, default: false },

  // Read status (only for in‑app)
  isRead: { type: Boolean, default: false, index: true },
  readAt: { type: Date },

  // Who triggered this
  triggeredBy: { type: mongoose.Schema.Types.ObjectId, refPath: 'triggeredByModel' },
  triggeredByModel: { type: String, enum: ['Admin', 'User'] },
}, { timestamps: true });

// Indexes for fast queries
NotificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ regionCode: 1, recipientRole: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);