const cron = require('node-cron');
const Customer = require('../models/Customer');
const radiusService = require('../services/radiusService');

async function cleanupExpiredBursts() {
  console.log('Running burst cleanup job...');
  const now = new Date();
  const expiredBursts = await Customer.find({
    'burst.enabled': true,
    'burst.expiresAt': { $lt: now }
  });

  for (const customer of expiredBursts) {
    console.log(`Removing expired burst for ${customer.accountId}`);
    try {
      await radiusService.removeBurstOverride(
        customer.pppoe.username,
        customer.burst.originalGroup,
        customer.burst.burstGroup
      );
      customer.burst = { enabled: false };
      await customer.save();
      console.log(`✅ Burst removed for ${customer.accountId}`);
    } catch (err) {
      console.error(`Failed to remove burst for ${customer.accountId}:`, err.message);
    }
  }
}

// Run every 10 minutes
cron.schedule('*/10 * * * *', cleanupExpiredBursts);