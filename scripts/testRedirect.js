const axios = require('axios');

const url = 'http://localhost:8081/portal';

const headers = {
  'host': 'redirect.skylinknetworks.co.ke',
  'x-real-ip': '192.168.88.1',
  'x-forwarded-for': '192.176.1.247, 192.168.88.1',
  'x-forwarded-proto': 'http',
  'cache-control': 'max-age=0',
  'upgrade-insecure-requests': '1',
  'user-agent': 'Mozilla/5.0 (Linux; Android 13; CPH2325 Build/TP1A.220905.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/148.0.7778.178 Mobile Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'x-requested-with': 'com.google.android.captiveportallogin',
  'referer': 'http://redirect.skylinknetworks.co.ke/portal',
  'accept-encoding': 'gzip, deflate',
  'accept-language': 'en-US,en;q=0.9',
  'x-proxy-id': '706145889',
  'via': '1.1 192.168.88.1 (Mikrotik HttpProxy)'
};

(async () => {
  try {
    console.log('Sending request to', url);
    console.log('Headers:', headers);

    const response = await axios.get(url, {
      headers,
      // Do not follow redirects automatically (optional)
      maxRedirects: 0,
      // Allow receiving large HTML (default is fine)
      // timeout: 10000
    });

    console.log('\n===== RESPONSE =====');
    console.log('Status:', response.status, response.statusText);
    console.log('\nHeaders:');
    console.log(response.headers);
    console.log('\nBody:');
    console.log(response.data);
  } catch (error) {
    // If the request fails (e.g., 302 redirect, 500, etc.), still show details
    if (error.response) {
      console.log('\n===== ERROR RESPONSE =====');
      console.log('Status:', error.response.status, error.response.statusText);
      console.log('\nHeaders:');
      console.log(error.response.headers);
      console.log('\nBody:');
      console.log(error.response.data);
    } else if (error.request) {
      console.log('No response received:', error.message);
    } else {
      console.log('Request error:', error.message);
    }
  }
})();