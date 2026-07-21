#!/usr/bin/env node
/**
 * KopoKopo Webhook Simulator
 * Simulates a successful incoming_payment webhook for a specific pending payment.
 *
 * Usage:
 *   node simulate-kopokopo-webhook.js
 *
 * Or override the webhook URL:
 *   WEBHOOK_URL=http://localhost:3000/api/payments/kopokopo/webhook node simulate-kopokopo-webhook.js
 */

const http  = require('http');
const https = require('https');

// ─── Target ───────────────────────────────────────────────────────────────────
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:5000/api/payments/kopokopo/webhook';

// ─── Payment details (from your pending Payment document) ────────────────────
const KOPOKOPO_PAYMENT_ID  = '4bbe8e3a-3282-4be7-b1f8-6bcb49d1b6de'; // must match kopokopoPaymentId in DB
const AMOUNT               = '1.0';
const SENDER_PHONE         = '+254712345678';   // any valid phone; won't affect matching
const SENDER_FIRST_NAME    = 'Test';
const SENDER_LAST_NAME     = 'User';
const MPESA_REFERENCE      = 'SIM' + Date.now().toString().slice(-8); // unique receipt each run
const TILL_NUMBER          = 'K000000';         // sandbox till — not used for matching here
const SITE_ID = "69f63382c0261141bbad2670"
const REFERENCE= "HOTSPOT-1E0D64C69EC9"


// ─── Payload ──────────────────────────────────────────────────────────────────
// Mirrors the real KopoKopo incoming_payment webhook structure exactly.
// The webhook handler matches on:  payload.data.id  →  payment.kopokopoPaymentId
const payload = {
  data: {
    id:   KOPOKOPO_PAYMENT_ID,
    type: 'incoming_payment',
    attributes: {
      initiation_time: new Date().toISOString(),
      status: 'Success',
      event: {
        type: 'Incoming Payment Request',
        resource: {
          id:                  KOPOKOPO_PAYMENT_ID,
          reference:           MPESA_REFERENCE,
          origination_time:    new Date().toISOString(),
          sender_phone_number: SENDER_PHONE,
          amount:              AMOUNT,
          currency:            'KES',
          till_number:         TILL_NUMBER,
          system:              'Lipa Na M-PESA',
          status:              'Received',          // must be 'Received' | 'Success' | 'success'
          sender_first_name:   SENDER_FIRST_NAME,
          sender_middle_name:  null,
          sender_last_name:    SENDER_LAST_NAME,
        },
        errors: null,
      },
      metadata: {
        siteId: SITE_ID,
        
        reference: REFERENCE,
        
        regionCode: "RFV",

        macAddress:        '1E:0D:64:C6:9E:C9',
        initiatedFrom:     'hotspot_redirect',
        packageId:         '6a1a95fa13f348f987bdde5a',
        paymentRequestId:  KOPOKOPO_PAYMENT_ID,
      },
      _links: {
        callback_url: WEBHOOK_URL,
        self:         `https://sandbox.kopokopo.com/api/v1/incoming_payments/${KOPOKOPO_PAYMENT_ID}`,
      },
    },
  },
};

// ─── Send ─────────────────────────────────────────────────────────────────────
const body   = JSON.stringify(payload);
const parsed = new URL(WEBHOOK_URL);
const lib    = parsed.protocol === 'https:' ? https : http;

const options = {
  hostname: parsed.hostname,
  port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
  path:     parsed.pathname + parsed.search,
  method:   'POST',
  headers:  {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
    // No real signature — your handler only logs a warning if missing, doesn't reject
  },
};

console.log('─────────────────────────────────────────────────');
console.log('🚀 KopoKopo Webhook Simulator');
console.log('─────────────────────────────────────────────────');
console.log(`📡 Target URL       : ${WEBHOOK_URL}`);
console.log(`🔑 KopoKopo ID      : ${KOPOKOPO_PAYMENT_ID}`);
console.log(`💵 Amount           : KES ${AMOUNT}`);
console.log(`📱 Sender phone     : ${SENDER_PHONE}`);
console.log(`🧾 M-Pesa reference : ${MPESA_REFERENCE}`);
console.log('─────────────────────────────────────────────────');
console.log('📦 Payload:\n', JSON.stringify(payload, null, 2));
console.log('─────────────────────────────────────────────────');

const req = lib.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`\n✅ Response status : ${res.statusCode}`);
    if (data) console.log(`📨 Response body   : ${data}`);
    if (res.statusCode === 200) {
      console.log('\n🎉 Webhook accepted! Check your server logs for processing output.');
    } else {
      console.log('\n⚠️  Unexpected status — check your server logs.');
    }
  });
});

req.on('error', (err) => {
  console.error('\n❌ Request failed:', err.message);
  console.error('   Is your server running on', WEBHOOK_URL, '?');
});

req.write(body);
req.end();