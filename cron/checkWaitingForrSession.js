const cron = require('node-cron');
const Customer = require('../models/Customer');

async function markPendingActivation() {
  console.log('⏰ [Pending Activation Cron] Checking customers with sufficient balance...', new Date().toISOString());

  const customers = await Customer.find({
    isActive: true,
    'subscription.status': 'expired',
    waitingForSession: false,
    'billing.balance': { $gt: 0 }
  }).populate('subscription.packageId');

  if (customers.length === 0) {
    console.log('ℹ️ No customers with pending activation.');
    return;
  }

  let updated = 0;
  for (const customer of customers) {
    const packagePrice = customer.subscription.packageId?.price;

    if(!packagePrice){
      continue;
    }


    if (customer.billing.balance >= packagePrice) {
      customer.waitingForSession = true;
     
      await customer.save();

      try{
        const radiusService = require("../services/radiusService");
      await radiusService.killUserSession(customer.pppoe.username);

      const groupName = customer.packageId.packageName.replace(/\s+/g, '_').toUpperCase();
      await radiusService.ensureReadyForSessionStart(customer.pppoe.username, groupName);
      
      }catch{
        console.log("Some radius failed in checking customer balances.")
      }
      
      updated++;
      console.log(`✅ ${customer.accountId} marked (balance: ${customer.billing.balance} >= ${packagePrice})`);
    } else {
      console.log(`⏸️ ${customer.accountId} balance (${customer.billing.balance}) < ${packagePrice} – skipped`);
    }
  }
  console.log(`[Pending Activation Cron] Done: ${updated} customers marked as waitingForSession.`);
}

cron.schedule('*/5 * * * *', markPendingActivation);

module.exports = markPendingActivation;