const SmsTemplate = require('../models/SmsTemplate');
const mobileSasaService = require('./mobileSasaService');
const SmsLog = require('../models/SmsLog');

/**
 * Replace placeholders in text with actual values.
 */
function replacePlaceholders(text, data) {
  let result = text;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, value !== undefined ? value : `{${key}}`);
  }
  return result;
}

/**
 * Send SMS using a template.
 * @param {string} templateKey - e.g., 'welcome', 'payment_wallet', 'payment_renewal'
 * @param {string} phoneNumber - Recipient phone number
 * @param {Object} data - Placeholder values
 * @param {Object} extra - { customerId, accountId, type, regionCode } for logging
 * @returns {Promise<Object>} { success, messageId, message }
 */
async function sendUsingTemplate(templateKey, phoneNumber, data = {}, extra = {}) {
  const template = await SmsTemplate.findOne({ key: templateKey, isActive: true });
  if (!template) {
    throw new Error(`Active SMS template not found for key: ${templateKey}`);
  }
  const finalMessage = replacePlaceholders(template.body, data);
  const result = await mobileSasaService.sendSingle(phoneNumber, finalMessage);

  // Log the SMS (using the same logSms function from controllers, but we replicate here to avoid circular deps)
  const logData = {
    recipient: {
      phoneNumber,
      customerId: extra.customerId || null,
      accountId: extra.accountId || null,
    },
    message: finalMessage,
    type: extra.type || templateKey,
    regionCode: extra.regionCode || null,
    provider: 'mobile_sasa',
    messageId: result.messageId,
    status: 'sent',
    cost: result.cost,
    sentAt: new Date(),
  };
  await SmsLog.create(logData);

  return { success: true, messageId: result.messageId, message: finalMessage };
}

/**
 * Send a direct message (no template).
 */
async function sendDirect(phoneNumber, message, extra = {}) {
  const result = await mobileSasaService.sendSingle(phoneNumber, message);
  await SmsLog.create({
    recipient: {
      phoneNumber,
      customerId: extra.customerId || null,
      accountId: extra.accountId || null,
    },
    message,
    type: extra.type || 'direct',
    regionCode: extra.regionCode || null,
    provider: 'mobile_sasa',
    messageId: result.messageId,
    status: 'sent',
    cost: result.cost,
    sentAt: new Date(),
  });
  return { success: true, messageId: result.messageId };
}

module.exports = { sendUsingTemplate, sendDirect, replacePlaceholders };