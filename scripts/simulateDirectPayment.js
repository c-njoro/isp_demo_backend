// scripts/simulateC2B.js
require('dotenv').config();
const mpesaService = require('../services/mpesaService');

async function simulate() {
  const result = await mpesaService.simulateC2B({
    amount: 2500,
    phoneNumber: '254708374144', // Safaricom test number
    billRefNumber: 'TEST',
    shortCode: '600000' // paybill receiving the payment
  });
  console.log(result);
}

simulate();