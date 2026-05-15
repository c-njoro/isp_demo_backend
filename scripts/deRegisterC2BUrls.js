// scripts/deRegisterC2BUrls.js

require('dotenv').config();
const axios = require('axios');

const SAFARICOM_CONSUMER_KEY = process.env.SAFARICOM_CONSUMER_KEY;
const SAFARICOM_CONSUMER_SECRET = process.env.SAFARICOM_CONSUMER_SECRET;
const SAFARICOM_SHORTCODE = process.env.SAFARICOM_SHORTCODE || '600000';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const baseURL = IS_PRODUCTION
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

/**
 * Get OAuth token from Safaricom
 */
async function getToken() {
  const auth = Buffer.from(`${SAFARICOM_CONSUMER_KEY}:${SAFARICOM_CONSUMER_SECRET}`).toString('base64');
  const url = `${baseURL}/oauth/v1/generate?grant_type=client_credentials`;
  
  console.log('Requesting token from:', url);
  
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });
    return response.data.access_token;
  } catch (error) {
    console.error('❌ Token request failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Deregister C2B URLs
 * 
 * NOTE: According to Safaricom API docs, there is NO official deregister endpoint!
 * The only way to "deregister" is to register with empty/null URLs or contact support.
 * 
 * Solution: Register with a dummy/inactive URL to effectively "disable" the callbacks
 */
async function deregisterC2BUrls() {
  console.log('🗑️ [deregisterC2BUrls] Deregistering by setting dummy URL...');
  
  try {
    const token = await getToken();
    const url = `${baseURL}/mpesa/c2b/v1/registerurl`;
    
    // Register with a dummy URL that won't respond
    // This effectively "disables" the C2B callbacks
    const requestBody = {
      ShortCode: SAFARICOM_SHORTCODE,
      ResponseType: 'Completed', // ✅ CORRECT: Must be 'Completed' or 'Cancelled'
      ConfirmationURL: 'https://example.com/inactive',
      ValidationURL: 'https://example.com/inactive'
    };
    
    console.log('Request body:', JSON.stringify(requestBody, null, 2));
    
    const response = await axios.post(url, requestBody, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    console.log('✅ [deregisterC2BUrls] Success:', response.data);
    return response.data;
    
  } catch (error) {
    if (error.response) {
      console.error('🔴 [deregisterC2BUrls] Error:');
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('🔴 [deregisterC2BUrls] Error:', error.message);
    }
    throw error;
  }
}

// ============================================
// ALTERNATIVE: Contact Safaricom Support
// ============================================
function showManualInstructions() {
  console.log('\n📝 ALTERNATIVE DEREGISTRATION METHOD:\n');
  console.log('Safaricom does not provide an official deregister API endpoint.');
  console.log('To completely remove C2B URL registration:\n');
  console.log('1. Contact Safaricom Support:');
  console.log('   Email: apisupport@safaricom.co.ke');
  console.log('   Phone: 0711 051 555\n');
  console.log('2. Provide them with:');
  console.log(`   - Shortcode: ${SAFARICOM_SHORTCODE}`);
  console.log('   - Request to deregister C2B URLs\n');
  console.log('3. OR use the script above to register dummy URLs');
  console.log('   (This effectively disables callbacks without full deregistration)\n');
}

// Run
if (require.main === module) {
  console.log('🗑️ Deregistering C2B URLs...\n');
  
  deregisterC2BUrls()
    .then(() => {
      console.log('\n✅ URLs updated to dummy endpoints (effectively deregistered)');
      console.log('💡 To fully deregister, contact Safaricom support');
      showManualInstructions();
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Deregistration failed:', error.message);
      showManualInstructions();
      process.exit(1);
    });
}

module.exports = { deregisterC2BUrls };