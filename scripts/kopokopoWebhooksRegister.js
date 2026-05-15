/**
 * Standalone script to register Kopo Kopo webhooks
 * 
 * Usage:
 *   node scripts/registerKopokopoWebhooks.js
 * 
 * All credentials are hardcoded below – edit before running.
 */

const axios = require('axios');

// ============================================
// CONFIGURATION – EDIT THESE VALUES
// ============================================
const CONFIG = {
  // Kopo Kopo credentials (REPLACE with your real values)
  clientId: 'fgzx-s0HC5_stojqaqZaqqbXEByWbMmsBV-Wx-wTluI',       // <-- CHANGE THIS
  clientSecret: 'K_UX0GcSk7GacuspjOlPjRcQxbTJEe3ZSVPYO4x4Pb0', // <-- CHANGE THIS
  apiKey: '97eb8ae6f5e88c4edc11a89c4cf3ecb4d68a4544',           // <-- CHANGE THIS (optional, for signature)
  tillNumber: '5447591',            // Your till number
  
  // Environment: 'sandbox' or 'production'
  environment: 'production',
  
  // Your webhook endpoint (must be publicly accessible, HTTPS)
  webhookUrl: 'https://billing.skylinknetworks.co.ke/api/payments/kopokopo/webhook',
};

// Base URLs
const SANDBOX_BASE = 'https://sandbox.kopokopo.com';
const PRODUCTION_BASE = 'https://api.kopokopo.com';

// ============================================
// HELPER: Get Base URL
// ============================================
function getBaseURL(environment) {
  return environment === 'production' ? PRODUCTION_BASE : SANDBOX_BASE;
}

// ============================================
// HELPER: Get Access Token
// ============================================
async function getAccessToken(clientId, clientSecret, environment) {
  const baseURL = getBaseURL(environment);
  const tokenURL = `${baseURL}/oauth/token`;

  console.log('🔐 Requesting access token...');

  const response = await axios.post(
    tokenURL,
    {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    },
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  console.log('✅ Access token obtained');
  return response.data.access_token;
}

// ============================================
// HELPER: Subscribe to a webhook
// ============================================
async function subscribeWebhook(accessToken, baseURL, eventType, webhookUrl, scope, scopeReference = null) {
  const subscriptionURL = `${baseURL}/api/v1/webhook_subscriptions`;

  const requestBody = {
    event_type: eventType,
    url: webhookUrl,
    scope: scope,
  };

  if (scopeReference) {
    requestBody.scope_reference = scopeReference;
  }

  console.log(`🔔 Subscribing to ${eventType} (scope: ${scope})...`);

  const response = await axios.post(subscriptionURL, requestBody, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const location = response.headers.location;
  const subscriptionId = location ? location.split('/').pop() : null;

  console.log(`✅ Webhook subscribed: ${eventType} → ID: ${subscriptionId}`);
  return subscriptionId;
}

// ============================================
// MAIN: Register all webhooks
// ============================================
async function registerWebhooks() {
  console.log('🚀 Starting Kopo Kopo webhook registration...\n');

  // Validate required config (check for placeholders)
  if (!CONFIG.clientId || CONFIG.clientId === 'YOUR_CLIENT_ID') {
    throw new Error('Please set your real clientId in the CONFIG object');
  }
  if (!CONFIG.clientSecret || CONFIG.clientSecret === 'YOUR_CLIENT_SECRET') {
    throw new Error('Please set your real clientSecret in the CONFIG object');
  }
  if (!CONFIG.webhookUrl) {
    throw new Error('Missing webhookUrl');
  }

  const { clientId, clientSecret, environment, webhookUrl, tillNumber } = CONFIG;
  const baseURL = getBaseURL(environment);

  // Get access token
  const accessToken = await getAccessToken(clientId, clientSecret, environment);

  const results = [];

  // 1. Subscribe to payment_request.success (company scope)
  try {
    const id = await subscribeWebhook(
      accessToken,
      baseURL,
      'payment_request.success',
      webhookUrl,
      'company'
    );
    results.push({ event: 'payment_request.success', id, scope: 'company' });
  } catch (error) {
    console.error('❌ Failed to subscribe payment_request.success:', error.response?.data || error.message);
    results.push({ event: 'payment_request.success', error: error.message });
  }

  // 2. Subscribe to payment_request.failure (company scope)
  // try {
  //   const id = await subscribeWebhook(
  //     accessToken,
  //     baseURL,
  //     'payment_request.failure',
  //     webhookUrl,
  //     'company'
  //   );
  //   results.push({ event: 'payment_request.failure', id, scope: 'company' });
  // } catch (error) {
  //   console.error('❌ Failed to subscribe payment_request.failure:', error.response?.data || error.message);
  //   results.push({ event: 'payment_request.failure', error: error.message });
  // }

  // 3. Subscribe to buygoods_transaction_received (till scope) – only if tillNumber is provided
  if (tillNumber) {
    try {
      const id = await subscribeWebhook(
        accessToken,
        baseURL,
        'buygoods_transaction_received',
        webhookUrl,
        'till',
        tillNumber
      );
      results.push({ event: 'buygoods_transaction_received', id, scope: 'till', tillNumber });
    } catch (error) {
      console.error('❌ Failed to subscribe buygoods_transaction_received:', error.response?.data || error.message);
      results.push({ event: 'buygoods_transaction_received', error: error.message });
    }
  } else {
    console.warn('⚠️ Skipping buygoods webhook: tillNumber not configured.');
  }

  console.log('\n📋 Registration summary:');
  results.forEach(r => {
    if (r.error) {
      console.log(`  ❌ ${r.event}: FAILED – ${r.error}`);
    } else {
      console.log(`  ✅ ${r.event}: subscribed (ID: ${r.id})`);
    }
  });

  console.log('\n🎉 Webhook registration complete!');
}

// Run the script
if (require.main === module) {
  registerWebhooks().catch(error => {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { registerWebhooks };