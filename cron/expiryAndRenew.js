const cron = require('node-cron');
const Customer = require('../models/Customer');
const Package = require('../models/Package');
const Transaction = require('../models/Transaction');
const SystemLog = require('../models/SystemLog');
const Site = require('../models/Site');
const mikrotikService = require('../services/mikroticService');
const radiusService = require('../services/radiusService');
const { calculatePeriodEnd } = require('../utils/invoiceHelpers');

/**
 * Run every 10 minutes:
 * - Find all active customers whose expiry date has passed.
 * - If they have enough balance, renew them automatically.
 * - Otherwise, deactivate them.
 */
async function processExpiredCustomers() {
  console.log('⏰ [Cron] Checking for expired active customers...');
  const now = new Date();

  try {
    // Find customers with status 'active' and expiry passed
    const customers = await Customer.find({
      'subscription.status': 'active',
      'subscription.expiresAt': { $lt: now }
    }).populate('subscription.packageId');

    if (customers.length === 0) {
      console.log('ℹ️ No expired active customers found.');
      return;
    }

    for (const customer of customers) {
      const packageDoc = customer.subscription.packageId;
      if (!packageDoc) {
        console.warn(`⚠️ Customer ${customer.accountId} has no package, skipping.`);
        continue;
      }

      const packagePrice = packageDoc.price;
      const balance = customer.billing?.balance || 0;

      if (balance >= packagePrice) {
        // ---- RENEW (sufficient balance) ----
        console.log(`✅ ${customer.accountId} has sufficient balance (${balance} >= ${packagePrice}), renewing...`);

        // Deduct price from balance
        const newBalance = balance - packagePrice;
        customer.billing.balance = newBalance;
        customer.billing.lastPaymentDate = now;

        // Extend expiry
        // Extend expiry
let baseDate = customer.subscription.expiresAt > now ? customer.subscription.expiresAt : now;
let newExpiry = calculatePeriodEnd(baseDate, packageDoc.period, packageDoc.periodUnit);

// Apply free extension days deduction if any
if (customer.freeExtensionDays && customer.freeExtensionDays > 0) {
  const extensionDays = customer.freeExtensionDays;
  newExpiry = new Date(newExpiry);
  newExpiry.setDate(newExpiry.getDate() - extensionDays);
  // Optionally, you might want to cap it to not go below today
  if (newExpiry < now) newExpiry = now;
  console.log(`   Deducted ${extensionDays} free extension days from new expiry.`);
  customer.freeExtensionDays = 0; // reset after use
}

customer.subscription.expiresAt = newExpiry;
        // Status remains 'active'
        customer.subscription.activatedAt = now;

        // Push renewal record
        customer.renewals.push({
          dateRenewed: now,
          method: 'wallet'
        });

       

        await customer.save();

        // Ensure services are enabled (they might have been disabled, but enable them just in case)
        const site = await Site.findById(customer.siteId);
        if (site) {
       

          const packageName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
          const radiusResult = await radiusService.enableAccount(customer.pppoe.username, packageName);
          const cycleResult = await radiusService.setBillingCycleStart(customer.pppoe.username, Date.now())
          if (!radiusResult.success) {
            console.error(`⚠️ RADIUS enable failed for ${customer.accountId}:`, radiusResult.error);
          } else {
            console.log(`✅ RADIUS enabled for ${customer.accountId}`);
          }
        } else {
          console.error(`❌ Site not found for ${customer.accountId}, cannot enable services.`);
        }

        // Log renewal
        await SystemLog.create({
          eventType: 'auto_renewal',
          severity: 'info',
          regionCode: customer.regionCode,
          entityType: 'customer',
          entityId: customer._id,
          accountId: customer.accountId,
          message: `Auto‑renewed ${customer.accountId} from wallet`,
          details: {
            amount: packagePrice,
            newBalance,
            packageName: packageDoc.packageName,
            newExpiry: customer.subscription.expiresAt,
            fupBillingCycleReset: customer.fupEnabled && packageDoc.fup?.resetPeriod === 'billingCycle'
          },
          success: true,
        });

        console.log(`🎉 Auto‑renewal completed for ${customer.accountId}, new expiry: ${customer.subscription.expiresAt}`);

      } else {
        // ---- DEACTIVATE (insufficient balance) ----
        console.log(`⏳ ${customer.accountId} has insufficient balance (${balance} < ${packagePrice}), deactivating...`);

        // Update status to expired
        customer.subscription.status = 'expired';
        await customer.save();

        // Disable services
        const site = await Site.findById(customer.siteId);
        if (site) {

          const radiusResult = await radiusService.disableAccount(customer.pppoe.username);
          if (!radiusResult.success) {
            console.error(`⚠️ RADIUS disable failed for ${customer.accountId}:`, radiusResult.error);
          } else {
            console.log(`✅ RADIUS disabled for ${customer.accountId}`);
          }


        } else {
          console.error(`❌ Site not found for ${customer.accountId}`);
        }

        // Log deactivation
        await SystemLog.create({
          eventType: 'auto_deactivation',
          severity: 'info',
          regionCode: customer.regionCode,
          entityType: 'customer',
          entityId: customer._id,
          accountId: customer.accountId,
          message: `Account expired and deactivated due to insufficient balance`,
          success: true
        });

        console.log(`✅ Deactivated ${customer.accountId}`);
      }
    }

    console.log('✅ [Cron] Finished processing expired customers.');
  } catch (error) {
    console.error('🔥 [Cron] Error:', error);
    await SystemLog.create({
      eventType: 'error',
      severity: 'critical',
      message: 'Expiry/renewal cron job failed',
      details: { error: error.message, stack: error.stack }
    });
  }
}

// ------------------------------------------------------------------
// Schedule: run every 10 minutes
// ------------------------------------------------------------------
cron.schedule('*/10 * * * *', processExpiredCustomers);

// For testing, you can call the function directly:
// processExpiredCustomers();

module.exports = processExpiredCustomers;