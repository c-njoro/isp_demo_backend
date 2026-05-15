// scripts/mockC2BCallback.js
const axios = require('axios');

const mockCallback = {
  TransactionType: 'Pay Bill',
  TransID: 'TEST' + Date.now(),
  TransTime: Date.now(),
  TransAmount: 1,
  BusinessShortCode: '600000',
  BillRefNumber: 'TEST001',
  MSISDN: '254720832123',
  FirstName: 'John',
  MiddleName: '',
  LastName: 'Doe'
};

const url = 'http://localhost:5000/api/payments/c2b-callback';

axios.post(url, mockCallback, {
  headers: { 'Content-Type': 'application/json' }
})
.then(res => {
  console.log('✅ Mock sent successfully');
  console.log('Response:', res.data);
})
.catch(err => {
  console.error('❌ Mock failed');
  if (err.response) {
    console.error('Status:', err.response.status);
    console.error('Data:', err.response.data);
  } else {
    console.error('Error message:', err.message);
  }
});