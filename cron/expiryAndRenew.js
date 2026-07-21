const cron = require('node-cron');
const Customer = require('../models/Customer');
const Package = require('../models/Package');
const Transaction = require('../models/Transaction');
const SystemLog = require('../models/SystemLog');
const Site = require('../models/Site');
const mikrotikService = require('../services/mikroticService');
const radiusService = require('../services/radiusService');
const { calculatePeriodEnd } = require('../utils/invoiceHelpers');
const smsTemplateService = require('../services/smsTemplateService');
const {generateAndSendVouchers} = require("../services/voucherGenerationService");



/**
 * Run every 10 minutes:
 * - Find all active customers whose expiry date has passed.
 * - If they have enough balance, renew them automatically.
 * - Otherwise, deactivate them.
 */
async function processExpiredCustomers() {
  console.log('⏰ [Cron] Checking for expired active customers...');
  const now = new Date();

  const customers = await Customer.find({
    'subscription.status': 'active',
    'subscription.expiresAt': { $lt: now }
  }).populate('subscription.packageId');

  for (const customer of customers) {
    
    const packageDoc = customer.subscription.packageId;
    if (!packageDoc) continue;

    const balance = customer.billing?.balance || 0;
    const packagePrice = packageDoc.price;

    if (balance >= packagePrice) {
      // Check active session
      const hasActive = await radiusService.hasActiveSession(customer.pppoe.username);
      if (hasActive) {
        // Renew
        const newBalance = balance - packagePrice;
        customer.billing.balance = newBalance;
        customer.billing.lastPaymentDate = now;

        let newExpiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);
        if (customer.freeExtensionDays && customer.freeExtensionDays > 0) {
          newExpiry = new Date(newExpiry);
          newExpiry.setDate(newExpiry.getDate() - customer.freeExtensionDays);
          if (newExpiry < now) newExpiry = now;
          customer.freeExtensionDays = 0;
        }
        customer.subscription.expiresAt = newExpiry;
        // status stays active

        if (!customer.renewals) customer.renewals = [];
        customer.renewals.push({ dateRenewed: now, method: 'wallet', amount: packagePrice });

        await customer.save();

        // Ensure RADIUS is correct
        const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
        await radiusService.enableAccount(customer.pppoe.username, groupName);
        await radiusService.setBillingCycleStart(customer.pppoe.username, new Date());

        if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
          console.log(`👨‍👦 Parent ${customer.accountId} has ${customer.sharedExpiry.length} shared children. Checking...`);
          
          const children = await Customer.find({ _id: { $in: customer.sharedExpiry } }).populate('subscription.packageId');
          console.log(`   Found ${children.length} child documents.`);
        
          for (const child of children) {
            if (!child.subscription.packageId) {
              console.error(`⚠️ Child ${child.accountId} has no package – skipping`);
              continue;
            }
        
            // Update child's expiry and status
            child.subscription.expiresAt = newExpiry;
            child.subscription.status = 'active';
            if (!child.subscription.activatedAt) child.subscription.activatedAt = now;
            child.waitingForSession = false;
            
            // Save child – ensure the changes are written
            await child.save();
            console.log(`   📝 Child ${child.accountId} saved: status=${child.subscription.status}, expires=${child.subscription.expiresAt}`);
        
            // Force a fresh fetch to confirm persistence (optional, but helps debug)
            const freshChild = await Customer.findById(child._id).populate('subscription.packageId');
            if (freshChild.subscription.status !== 'active') {
              console.error(`   ❌ Child ${child.accountId} status not active after save! Attempting to force update.`);
              // Force update directly via MongoDB update
              await Customer.updateOne(
                { _id: child._id },
                { $set: { 'subscription.status': 'active', 'subscription.expiresAt': newExpiry, waitingForSession: false } }
              );
            }
        
            // Apply RADIUS changes
            const childGroupName = freshChild ? freshChild.subscription.packageId.packageName.replace(/\s+/g, '_').toUpperCase() : child.subscription.packageId.packageName.replace(/\s+/g, '_').toUpperCase();
            try {
              const radiusResult = await radiusService.enableAccount(child.pppoe.username, childGroupName);
              if (!radiusResult.success) {
                console.error(`   ❌ RADIUS enable failed for child ${child.accountId}: ${radiusResult.error}`);
              } else {
                console.log(`   ✅ RADIUS enabled for child ${child.accountId} (group: ${childGroupName})`);
              }
            } catch (err) {
              console.error(`   ❌ RADIUS enable error for child ${child.accountId}:`, err.message);
            }
            
            await radiusService.setBillingCycleStart(child.pppoe.username, new Date());
            await radiusService.removePendingActivation(child.pppoe.username);
        
            // Log child renewal
            await SystemLog.create({
              eventType: "child_auto_renewal",
              severity: "info",
              regionCode: child.regionCode,
              entityType: "customer",
              entityId: child._id,
              accountId: child.accountId,
              message: `Child automatically renewed via parent ${customer.accountId}`,
              details: { parentId: customer._id, newExpiry, radiusSuccess: radiusResult?.success || false },
              success: true,
            });
        
            console.log(`   ✅ Child ${child.accountId} renewed, new expiry ${newExpiry}`);
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

        await Transaction.create({
          type: "SUBSCRIPTION",
          customerType: "pppoe",
          customerId: customer._id,
          accountId: customer.accountId,
          firstName: customer.firstName,
          lastName: customer.lastName,
          regionCode: customer.regionCode,
          siteId: customer.siteId,
          amount: -packagePrice,
          description: "Auto-renewal from wallet",
          paymentMethod: "wallet",
          packageId: packageDoc._id,
          status: "completed",
        });

        await SystemLog.create({
          eventType: "auto_renewal",
          severity: "info",
          regionCode: customer.regionCode,
          entityType: "customer",
          entityId: customer._id,
          accountId: customer.accountId,
          message: `Auto-renewed ${customer.accountId} from wallet (active session)`,
          details: { amount: packagePrice, newBalance, newExpiry },
          success: true,
        });

        console.log(`✅ Renewed ${customer.accountId}, new expiry ${newExpiry}`);
      } else {
        // No active session – expire and set waiting flag
        customer.subscription.status = "expired";
        customer.waitingForSession = true;
        await customer.save();

        // Disable RADIUS (optional, but good)
        await radiusService.disableAccount(customer.pppoe.username);
        await radiusService.addPendingActivation(customer.pppoe.username); 

        await SystemLog.create({
          eventType: "auto_deactivation",
          severity: "info",
          regionCode: customer.regionCode,
          entityType: "customer",
          entityId: customer._id,
          accountId: customer.accountId,
          message: `Account expired, set waiting for session (balance KES ${balance} available)`,
          success: true,
        });
        console.log(`⏸️ ${customer.accountId} expired but has balance, waiting for session.`);
      }
    } else {
      // Insufficient balance – expire
      customer.subscription.status = "expired";
      customer.waitingForSession = false;
      await customer.save();

      await radiusService.disableAccount(customer.pppoe.username);
      await radiusService.removePendingActivation(customer.pppoe.username); 


      if(customer.isChild && customer.shared.expiryWithParent){
        continue;
      }


      if (!customer.lastExpiryNoticeSent || 
        customer.lastExpiryNoticeSent.getTime() !== currentExpiry.getTime()) {

          const region = await Site.findById(customer.siteId);
      let till = "";
      if(region){
        till = region.payment?.tillNumber;
      }else{
        till = "";
      }
      try {
        await smsTemplateService.sendUsingTemplate(
          'expiry_notice',   // ← use your actual template key (e.g., 'expiry_warning')
          customer.phoneNumber,
          {
            customerName: `${customer.firstName} ${customer.lastName}`,
            tillNumber: till,
          },
          {
            customerId: customer._id,
            accountId: customer.accountId,
            type: 'expiry_notice',
            regionCode: customer.regionCode,
          }
        );
        customer.lastExpiryNoticeSent = new Date();
        await customer.save();
        console.log(`📱 Expiry notice sent to ${customer.accountId}`);
      } catch (err) {
        console.error(`Failed to send expiry notice to ${customer.accountId}:`, err.message);
      }
    }

      
      

      await SystemLog.create({
        eventType: "auto_deactivation",
        severity: "info",
        regionCode: customer.regionCode,
        entityType: "customer",
        entityId: customer._id,
        accountId: customer.accountId,
        message: `Account expired due to insufficient balance (KES ${balance})`,
        success: true,
      });
    }
  }
}
// ------------------------------------------------------------------
// Schedule: run every 10 minutes
// ------------------------------------------------------------------
cron.schedule('*/10 * * * *', processExpiredCustomers);

// For testing, you can call the function directly:
// processExpiredCustomers();

module.exports = processExpiredCustomers;