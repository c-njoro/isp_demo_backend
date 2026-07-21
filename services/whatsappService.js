// services/whatsappService.js
const axios = require('axios');

const WHATSAPP_API_URL = `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;



/**
 * Send a text message via WhatsApp
 * @param {string} to - International phone number (e.g., 254712345678)
 * @param {string} message - Plain text message
 * @param {string} [previewUrl=false] - Whether to show link preview
 * @returns {Promise<Object>} { success, messageId, error? }
 */
console.log('[whatsappService] Config:', {
  apiUrl: WHATSAPP_API_URL,
  hasToken: !!ACCESS_TOKEN,
  tokenPreview: ACCESS_TOKEN ? ACCESS_TOKEN.slice(0, 10) + '...' : 'missing',
});

async function sendWhatsAppText(to, message, previewUrl = false) {
  console.log(`[whatsappService] Attempting to send to ${to}:`, message.slice(0, 50) + '...');
  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { preview_url: previewUrl, body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('[whatsappService] Success:', response.data);
    return {
      success: true,
      messageId: response.data.messages?.[0]?.id || null,
    };
  } catch (error) {
    console.error('[whatsappService] Error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
    };
  }
}

/**
 * Send a WhatsApp template message (for richer formatting)
 */
// services/whatsappService.js
async function sendWhatsAppTemplate(to, templateName, language = 'en', components = []) {
  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: language }, components },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return {
      success: true,
      messageId: response.data.messages?.[0]?.id || null,
    };
  } catch (error) {
    console.error('[whatsappService] Template error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
    };
  }
}

module.exports = { sendWhatsAppText, sendWhatsAppTemplate };