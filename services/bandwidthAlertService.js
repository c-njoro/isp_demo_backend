// services/bandwidthAlertService.js
const { notifyAdmin } = require('./notificationService');
const { sendWhatsAppTemplate } = require('./whatsappService');
const Admin = require('../models/Admin');

async function sendBandwidthPollAlert(router, isSuccess, errorMessage = '') {
  const adminIds = (process.env.BANDWIDTH_ALERT_ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (adminIds.length === 0) {
    console.warn('[bandwidthAlertService] No admin IDs configured for bandwidth alerts');
    return;
  }

  const now = new Date().toISOString();
  const templateName = isSuccess ? 'router_up_v2' : 'router_down';
  const title = isSuccess ? `✅ Router ${router.name} is back online` : `🚨 Router ${router.name} is unreachable`;
  const message = isSuccess 
    ? `Router ${router.name} (${router.ip}) is now reachable.` 
    : `Router ${router.name} (${router.ip}) is unreachable.`;

  const channels = ['in-app', 'whatsapp']; // We'll send both

  for (const adminId of adminIds) {
    try {
      const admin = await Admin.findById(adminId).select('_id phoneNumber');
      if (!admin) {
        console.warn(`[bandwidthAlertService] Admin ${adminId} not found`);
        continue;
      }

      // In-app notification
      await notifyAdmin({
        regionCode: 'SYSTEM',
        adminId: admin._id,
        type: 'system',
        title,
        message,
        channels: ['in-app'],
        triggeredBy: null,
        triggeredByModel: 'Admin',
      });

      // WhatsApp template message
      if (admin.phoneNumber) {
        const phone = admin.phoneNumber.startsWith('+') ? admin.phoneNumber : `+${admin.phoneNumber}`;
        const components = [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: router.name },
              { type: 'text', text: router.ip },
              { type: 'text', text: now },
            ],
          },
        ];
        const result = await sendWhatsAppTemplate(phone, templateName, 'en', components);
        if (result.success) {
          console.log(`[bandwidthAlertService] WhatsApp template sent to ${phone}`);
        } else {
          console.error(`[bandwidthAlertService] WhatsApp template failed for ${phone}:`, result.error);
        }
      } else {
        console.warn(`[bandwidthAlertService] Admin ${adminId} has no phone number`);
      }
    } catch (error) {
      console.error(`[bandwidthAlertService] Failed to notify ${adminId}:`, error.message);
    }
  }
}

module.exports = { sendBandwidthPollAlert };