// test-voucher-redeem.js
// Run with: node test-voucher-redeem.js

const axios = require('axios'); // npm install axios if not installed

// Configuration – adjust to your environment
const BASE_URL = 'http://localhost:5000'; // change to your actual backend URL
const VOUCHER_CODE = 'TEST123';           // must exist in your Voucher collection
const MAC_ADDRESS = 'AA:BB:CC:DD:EE:FF';   // any MAC, will be normalized
const NAS_IP = '10.20.3.1';               // a valid NAS IP that has a router & site in DB

async function redeemVoucher() {
  try {
    const payload = {
      code: VOUCHER_CODE,
      macAddress: MAC_ADDRESS,
      nasIp: NAS_IP,
    };

    console.log('📡 Sending redeem request:', payload);

    const response = await axios.post(`${BASE_URL}/api/vouchers/redeem`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });

    console.log('✅ Voucher redeemed successfully');
    console.log('Response data:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    if (error.response) {
      console.error('❌ API returned error:', error.response.status, error.response.data);
    } else if (error.request) {
      console.error('❌ No response from server. Is your backend running?');
    } else {
      console.error('❌ Request failed:', error.message);
    }
  }
}

redeemVoucher();