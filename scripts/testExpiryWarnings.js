// scripts/testExpiryWarnings.js
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Package = require('../models/Package');
require('dotenv').config({ path: '../.env' }); // adjust path to your .env file

async function sendExpiryWarnings() {
  try {
    // 1. Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(`mongodb://localhost:27017/isp_management`);
    console.log('✅ MongoDB connected');

    const now = new Date();
    const twoDaysFromNow = new Date(now);
    twoDaysFromNow.setDate(now.getDate() + 2);
    twoDaysFromNow.setHours(0, 0, 0, 0);

    const threeDaysFromNow = new Date(now);
    threeDaysFromNow.setDate(now.getDate() + 3);
    threeDaysFromNow.setHours(23, 59, 59, 999);

    const query = {
      'subscription.status': 'active',
      'subscription.expiresAt': { $gte: twoDaysFromNow, $lte: threeDaysFromNow },
    };

    const customers = await Customer.find(query).populate('subscription.packageId');
    console.log(`Found ${customers.length} customers expiring in 2-3 days`);

    const results = { sent: 0, failed: 0, errors: [] };

    for (const customer of customers) {
      const packageDoc = customer.subscription.packageId;
      console.log(`\nProcessing: ${customer.accountId} | Balance: ${customer.billing?.balance} | Package Price: ${packageDoc?.price}`);

      // Check if balance is sufficient
      if (customer.billing?.balance >= packageDoc?.price) {
        console.log(`   → Has enough balance, skipping warning`);
        continue;
      }

      const currentExpiry = customer.subscription.expiresAt;
      // Check if already warned for this exact expiry
      if (customer.lastExpiryWarningExpiry &&
          customer.lastExpiryWarningExpiry.getTime() === currentExpiry.getTime()) {
        console.log(`   → Already warned for expiry ${currentExpiry}, skipping`);
        continue;
      }

      // TODO: Send SMS here
      console.log(`   → Would send warning SMS to ${customer.phoneNumber} about expiry on ${currentExpiry}`);
      results.sent++;

      // Uncomment to actually update the warning flag
      // customer.lastExpiryWarningExpiry = currentExpiry;
      // await customer.save();
    }

    console.log(`\n✅ Done. Sent: ${results.sent}, Failed: ${results.failed}`);
  } catch (error) {
    console.error('❌ Expiry warning cron error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
  }
}

sendExpiryWarnings();