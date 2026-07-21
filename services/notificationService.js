// services/notificationService.js
const Notification = require('../models/Notification');
const Admin = require('../models/Admin');
const User = require('../models/User');
const { sendSingle: sendSms } = require('./mobileSasaService');
const { sendWhatsAppText } = require('./whatsappService');
const { formatPhoneNumber } = require('../utils/phoneHelpers');

/**
 * Send a notification via one or more channels.
 * @param {Object} options
 * @param {string} options.regionCode
 * @param {string} [options.siteId]
 * @param {string} options.recipientType - 'admin', 'user', 'role'
 * @param {string} [options.recipientId] - Admin/User _id (if recipientType is not 'role')
 * @param {string} [options.recipientRole] - e.g. 'admin', 'manager'
 * @param {string} options.type - notification category
 * @param {string} options.title
 * @param {string} options.message
 * @param {Object} [options.data] - extra metadata
 * @param {string[]} [options.channels] - ['in-app', 'sms', 'whatsapp']
 * @param {string} [options.triggeredBy] - Admin/User _id
 * @param {string} [options.triggeredByModel] - 'Admin' or 'User'
 * @returns {Promise<Object>} { success, notification, errors: [] }
 */
async function sendNotification({
  regionCode,
  siteId,
  recipientType,
  recipientId,
  recipientRole,
  type = 'system',
  title,
  message,
  data = {},
  channels = ['in-app'],
  triggeredBy = null,
  triggeredByModel = 'Admin',
}) {
  const errors = [];

  // 1. Build the notification document
  const notificationDoc = {
    regionCode,
    siteId: siteId || null,
    recipientType,
    type,
    title,
    message,
    data,
    channels,
    triggeredBy,
    triggeredByModel,
  };

  // Resolve recipient
  if (recipientType === 'role') {
    notificationDoc.recipientRole = recipientRole;
    // Role notifications are saved once, not per user – we'll fetch users later for channels
  } else {
    notificationDoc.recipientId = recipientId;
    notificationDoc.recipientModel = recipientType === 'admin' ? 'Admin' : 'User';
  }

  // 2. Save the notification (for in‑app)
  let notification = null;
  if (channels.includes('in-app')) {
    notification = await Notification.create(notificationDoc);
  }

  // 3. Send via other channels
  const channelPromises = [];

  if (channels.includes('sms') || channels.includes('whatsapp')) {
    // Resolve phone numbers
    let phoneNumbers = [];

    if (recipientType === 'role') {
      // Fetch all admins/users with the given role
      const admins = await Admin.find({ role: recipientRole, regionCode }).select('phoneNumber');
      phoneNumbers = admins.map(a => a.phoneNumber).filter(Boolean);
    } else {
      // Get the specific recipient's phone
      let phoneNumber = null;
      if (recipientType === 'admin') {
        const admin = await Admin.findById(recipientId).select('phoneNumber');
        if (admin) phoneNumber = admin.phoneNumber;
      } else if (recipientType === 'user') {
        const user = await User.findById(recipientId).select('phoneNumber');
        if (user) phoneNumber = user.phoneNumber;
      }
      if (phoneNumber) phoneNumbers = [phoneNumber];
    }

    // Format and deduplicate
    const formattedNumbers = [...new Set(phoneNumbers.map(p => formatPhoneNumber(p)).filter(Boolean))];

    for (const phone of formattedNumbers) {
      const cleanMessage = `${title}\n${message}`;
      if (channels.includes('sms')) {
        channelPromises.push(
          sendSms(phone, cleanMessage)
            .then(() => ({ channel: 'sms', phone, success: true }))
            .catch(err => ({ channel: 'sms', phone, success: false, error: err.message }))
        );
      }
      if (channels.includes('whatsapp')) {
        channelPromises.push(
          sendWhatsAppText(phone, cleanMessage)
            .then(() => ({ channel: 'whatsapp', phone, success: true }))
            .catch(err => ({ channel: 'whatsapp', phone, success: false, error: err.error || err.message }))
        );
      }
    }
  }

  // Wait for all channel sends (but don't block on them – we can log results)
  const results = await Promise.allSettled(channelPromises);

  // Collect failures
  for (const r of results) {
    if (r.status === 'rejected' || (r.value && !r.value.success)) {
      errors.push(r.value || r.reason);
    }
  }

  // Mark notification as delivered (even if some channels failed)
  if (notification) {
    notification.delivered = true;
    await notification.save();
  }

  return {
    success: errors.length === 0,
    notification,
    errors,
    channelResults: results.map(r => r.value || r.reason),
  };
}

/**
 * Shorthand: send to an admin
 */
async function notifyAdmin({
  regionCode,
  adminId,
  type,
  title,
  message,
  data = {},
  channels = ['in-app'],
  triggeredBy = null,
  triggeredByModel = 'Admin',
}) {
  return sendNotification({
    regionCode,
    recipientType: 'admin',
    recipientId: adminId,
    type,
    title,
    message,
    data,
    channels,
    triggeredBy,
    triggeredByModel,
  });
}

/**
 * Shorthand: send to all admins of a given role in a region
 */
async function notifyRole({
  regionCode,
  role,
  type,
  title,
  message,
  data = {},
  channels = ['in-app'],
  triggeredBy = null,
  triggeredByModel = 'Admin',
}) {
  return sendNotification({
    regionCode,
    recipientType: 'role',
    recipientRole: role,
    type,
    title,
    message,
    data,
    channels,
    triggeredBy,
    triggeredByModel,
  });
}

module.exports = {
  sendNotification,
  notifyAdmin,
  notifyRole,
};