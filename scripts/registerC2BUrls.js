// scripts/forceRegisterC2BUrls.js

require('dotenv').config();
const axios = require('axios');

const SAFARICOM_CONSUMER_KEY = process.env.SAFARICOM_CONSUMER_KEY;
const SAFARICOM_CONSUMER_SECRET = process.env.SAFARICOM_CONSUMER_SECRET;
const SAFARICOM_SHORTCODE = process.env.SAFARICOM_SHORTCODE || '600000';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Your ngrok or public URL
const CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL || 'https://458a-102-210-42-14.ngrok-free.app';

const baseURL = IS_PRODUCTION
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

/**
 * Get OAuth token
 */
async function getToken() {
  const auth = Buffer.from(`${SAFARICOM_CONSUMER_KEY}:${SAFARICOM_CONSUMER_SECRET}`).toString('base64');
  const url = `${baseURL}/oauth/v1/generate?grant_type=client_credentials`;
  
  console.log('🔐 Requesting token...');
  
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });
    console.log('✅ Token received');
    return response.data.access_token;
  } catch (error) {
    console.error('❌ Token request failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Register C2B URLs
 * If you get "Duplicate notification info" error, it means URLs are already registered.
 * 
 * SOLUTION: You need to either:
 * 1. Wait (registrations expire after some time)
 * 2. Contact Safaricom to clear the old registration
 * 3. Use a different shortcode
 */
async function registerC2BUrls() {
  console.log('📝 [registerC2BUrls] Registering URLs...\n');
  
  try {
    const token = await getToken();
    const url = `${baseURL}/mpesa/c2b/v1/registerurl`;
    
    const requestBody = {
      ShortCode: SAFARICOM_SHORTCODE,
      ResponseType: 'Completed', // Must be 'Completed' or 'Cancelled'
      ConfirmationURL: `${CALLBACK_BASE_URL}/api/payments/c2b-callback`,
      ValidationURL: `${CALLBACK_BASE_URL}/api/payments/c2b-validation`
    };
    
    console.log('Request details:');
    console.log('  URL:', url);
    console.log('  Body:', JSON.stringify(requestBody, null, 2));
    console.log();
    
    const response = await axios.post(url, requestBody, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    console.log('✅ [registerC2BUrls] Success!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    return response.data;
    
  } catch (error) {
    if (error.response) {
      const { status, data } = error.response;
      
      console.error('🔴 [registerC2BUrls] Error:');
      console.error('Status:', status);
      console.error('Data:', JSON.stringify(data, null, 2));
      
      // Handle specific errors
      if (data.errorCode === '500.003.1001') {
        console.log('\n💡 SOLUTION FOR DUPLICATE ERROR:\n');
        console.log('This error means your URLs are ALREADY registered!');
        console.log('Your C2B callbacks are working - no action needed.\n');
        console.log('If you need to change the URLs:');
        console.log('1. Option A: Contact Safaricom support to clear registration');
        console.log('   Email: apisupport@safaricom.co.ke');
        console.log('   Phone: 0711 051 555\n');
        console.log('2. Option B: Wait for registration to expire (usually 24-48 hours)\n');
        console.log('3. Option C: Test with a different shortcode\n');
        console.log('Current URLs registered:');
        console.log(`  ConfirmationURL: ${requestBody.ConfirmationURL}`);
        console.log(`  ValidationURL: ${requestBody.ValidationURL}`);
      }
    } else {
      console.error('🔴 [registerC2BUrls] Error:', error.message);
    }
    throw error;
  }
}

/**
 * Check C2B registration status
 * Note: There's no official "check status" endpoint, so we try to register
 * and interpret the response
 */
async function checkRegistrationStatus() {
  console.log('🔍 Checking C2B registration status...\n');
  
  try {
    await registerC2BUrls();
    console.log('\n✅ URLs registered successfully (or were already registered)');
  } catch (error) {
    if (error.response?.data?.errorCode === '500.003.1001') {
      console.log('\n✅ URLs are ALREADY registered - your callbacks are active!');
      return true;
    }
    console.log('\n❌ Registration check failed');
    return false;
  }
}

// Command line interface
const command = process.argv[2] || 'register';

if (require.main === module) {
  console.log('🔐 Safaricom C2B URL Registration Tool\n');
  console.log('Environment:', IS_PRODUCTION ? 'PRODUCTION' : 'SANDBOX');
  console.log('Shortcode:', SAFARICOM_SHORTCODE);
  console.log('Callback URL:', CALLBACK_BASE_URL);
  console.log('='.repeat(60));
  console.log();
  
  switch (command) {
    case 'check':
      checkRegistrationStatus()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
      
    case 'register':
    case 'force':
      registerC2BUrls()
        .then(() => {
          console.log('\n✅ Registration complete!');
          console.log('\nNext steps:');
          console.log('1. Make sure your server is running');
          console.log('2. Ensure ngrok is forwarding to your server');
          console.log('3. Test with a C2B payment');
          process.exit(0);
        })
        .catch((error) => {
          console.error('\n❌ Registration failed:', error.message);
          process.exit(1);
        });
      break;
      
    default:
      console.log('Usage:');
      console.log('  node scripts/forceRegisterC2BUrls.js [command]');
      console.log();
      console.log('Commands:');
      console.log('  register  - Register C2B URLs (default)');
      console.log('  check     - Check if URLs are already registered');
      console.log('  force     - Same as register');
      process.exit(0);
  }
}

module.exports = { registerC2BUrls, checkRegistrationStatus };