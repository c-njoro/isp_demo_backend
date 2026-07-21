const cron = require('node-cron');
const Customer = require('../models/Customer');
const Package = require('../models/Package');
const Transaction = require('../models/Transaction');
const SystemLog = require('../models/SystemLog');
const radiusService = require('../services/radiusService');
const { calculatePeriodEnd } = require('../utils/invoiceHelpers');
const {generateAndSendVouchers} = require("../services/voucherGenerationService");



async function activateWaitingCustomers() {
  console.log('⏰ [Activation Cron] Checking customers waiting for session...', new Date().toISOString());
  const now = new Date();

  // Find all customers waiting for a session
  const customers = await Customer.find({
    waitingForSession: true,
    'subscription.status': { $ne: 'active' }
  }).populate('subscription.packageId');

  if (customers.length === 0) {
    console.log('ℹ️ No customers waiting for session.');
    return;
  }

  console.log(`📋 Found ${customers.length} customers waiting for session.`);

  for (const customer of customers) {
    const packageDoc = customer.subscription.packageId;
    if (!packageDoc) {
      console.log(`⚠️ ${customer.accountId} has no package – clearing waiting flag.`);
      customer.waitingForSession = false;
      await customer.save();
      await radiusService.removePendingActivation(customer.pppoe.username); 
      continue;
    }

    const balance = customer.billing?.balance || 0;
    const packagePrice = packageDoc.price;

    if (balance < packagePrice) {
      console.log(`⚠️ ${customer.accountId} balance (${balance}) < package price (${packagePrice}) – clearing waiting flag.`);
      customer.waitingForSession = false;
      
      await customer.save();
      await radiusService.removePendingActivation(customer.pppoe.username); 
      continue;
    }

    // Check active RADIUS session – with detailed logging
    let hasActive = false;
    let sessionDetails = null;
    let status;
    let usedAccountId;
    let expiryBeforeCheck = null;
    try {
      // Use getUserConnectionStatus for more details (also returns isOnline, ip, etc.)
      

      status = await radiusService.getUserConnectionStatus(customer.pppoe.username);
      if(status.success && customer.accountId !== customer.pppoe.username && !status.isOnline && !status.isOnlineNoInternet){
        status = await radiusService.getUserConnectionStatus(customer.accountId);
        usedAccountId = true;
      }


      if (status.success) {
        // Treat any existing session (even with no internet) as "hasActive"
        hasActive = status.isOnline === true || status.isOnlineNoInternet === true;
        sessionDetails = {
          isOnline: status.isOnline,
          isOnlineNoInternet: status.isOnlineNoInternet,
          ipAddress: status.ipAddress,
          nasIpAddress: status.nasIpAddress,
          startTime: status.startTime,
          reason: status.reason
        };
        console.log(`🔍 ${customer.accountId} session status:`, sessionDetails);
      }else {
        console.error(`❌ Failed to get connection status for ${customer.accountId}:`, status.error);
        // Fallback to simple hasActiveSession
        hasActive = await radiusService.hasActiveSession(customer.pppoe.username);
        console.log(`   Fallback hasActiveSession returned: ${hasActive}`);
      }
    } catch (err) {
      console.error(`🔥 Error checking session for ${customer.accountId}:`, err.message);
      continue; // skip this customer for this cycle
    }

    if (!hasActive) {
      const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
      await radiusService.ensureReadyForSessionStart(customer.pppoe.username, groupName);
      console.log(`⏸️ ${customer.accountId} still no active session – waiting.`);
      continue;
    }

    // --- Activate the customer ---
    console.log(`✅ ${customer.accountId} has active session and sufficient balance – activating NOW.`);
    // if(usedAccountId && customer.pppoe.username !== customer.accountId){
    //   customer.pppoe.username = customer.accountId;
    //   await customer.save();
    // }

    try {
      const newBalance = balance - packagePrice;
      let newExpiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);
      if(packageDoc.period >= 30 && newExpiry - now < packageDoc.period){
        newExpiry = calculatePeriodEnd(now, 30, 'd');
      }
      // expiryBeforeCheck = newExpiry;
      if (customer.freeExtensionDays && customer.freeExtensionDays > 0) {
        newExpiry = new Date(newExpiry);
        newExpiry.setDate(newExpiry.getDate() - customer.freeExtensionDays);
        if (newExpiry < now && packageDoc.period >= 30) newExpiry  = calculatePeriodEnd(now, 30, 'd');
        newExpiry.setDate(newExpiry.getDate() - customer.freeExtensionDays);
        customer.freeExtensionDays = 0;
      }

      
    
      // Update customer in MongoDB
      customer.billing.balance = newBalance;
      customer.billing.lastPaymentDate = now;
      customer.subscription.status = 'active';
      customer.subscription.expiresAt = newExpiry;
      customer.subscription.activatedAt = now;
      customer.subscription.packageId = packageDoc._id;
      customer.waitingForSession = false;
    
      if (!customer.renewals) customer.renewals = [];
      customer.renewals.push({ dateRenewed: now, method: 'wallet_auto', amount: packagePrice });
    
      await customer.save();  // ← This could fail
    
      // Enable RADIUS group
      const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
      const radiusResult = await radiusService.enableAccount(customer.pppoe.username, groupName);
      await radiusService.removePendingActivation(customer.pppoe.username); 
      if (!radiusResult.success) {
        console.error(`⚠️ RADIUS enable failed for ${customer.accountId}:`, radiusResult.error);
      } else {
        console.log(`✅ RADIUS enabled for ${customer.accountId} (group: ${groupName})`);
      }
    const rightNow = new Date();
      await radiusService.setBillingCycleStart(customer.pppoe.username, new Date());

      if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
        // Propagate to children that share expiry
        const children = await Customer.find({ _id: { $in: customer.sharedExpiry } }).populate('subscription.packageId');
        for (const child of children) {
          child.subscription.expiresAt = newExpiry; // newExpiry is the parent's new expiry
          child.subscription.status = 'active';
          if (!child.subscription.activatedAt) child.subscription.activatedAt = now;
          await child.save();
          const childGroupName = child.subscription.packageId.packageName.replace(/\s+/g, '_').toUpperCase();
          await radiusService.enableAccount(child.pppoe.username, childGroupName);
          await radiusService.setBillingCycleStart(child.pppoe.username, new Date());
          // Log child activation (optional)
        }
      }

      const voucherData = {
        customerId: customer._id,
        packageId: '6a311253de22d46f9b16b375',
        voucherAmount: 3,
        createdBy: null,
        regionCode: customer.regionCode,
        rollbackOnSmsFailure: true,
      };
  
      try{
await generateAndSendVouchers(voucherData);
}catch(error){
console.log("Could not generate bonus vouchers for customer", error);
}
    
      // Create a SUBSCRIPTION transaction
      await Transaction.create({
        type: 'SUBSCRIPTION',
        customerType: 'pppoe',
        customerId: customer._id,
        accountId: customer.accountId,
        firstName: customer.firstName,
        lastName: customer.lastName,
        regionCode: customer.regionCode,
        siteId: customer.siteId,
        amount: -packagePrice,
        description: `Activated from wallet upon session start`,
        paymentMethod: 'wallet',
        packageId: packageDoc._id,
        status: 'completed',
      });
    
      await SystemLog.create({
        eventType: 'subscription_activation',
        severity: 'info',
        regionCode: customer.regionCode,
        entityType: 'customer',
        entityId: customer._id,
        accountId: customer.accountId,
        message: `Customer ${customer.accountId} activated (wallet deduction) after session detected`,
        details: {
          amount: packagePrice,
          oldBalance: balance,
          newBalance,
          newExpiry,
          sessionInfo: sessionDetails
          // expiryBeforeCheck: expiryBeforeCheck,
        },
        success: true,
      });
    
      console.log(`🎉 ${customer.accountId} activated, new expiry: ${newExpiry.toISOString()}`);
    } catch (err) {
      console.error(`🔥 Activation failed for ${customer.accountId}:`, err);
      // Optionally, you may want to revert the in-memory changes or log to a separate collection
    }}
}

// Schedule every 1 minute (instead of 5)
cron.schedule('*/3 * * * *', activateWaitingCustomers);  // Every 5 minutes

module.exports = activateWaitingCustomers;