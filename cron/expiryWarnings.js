const cron = require('node-cron');
const Customer = require('../models/Customer');
const smsTemplateService = require('../services/smsTemplateService');
const mongoose = require('mongoose');

// ---------- Lock model for single execution across multiple instances ----------
const LockSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  lockedAt: { type: Date, default: Date.now },
  lockedBy: { type: String, default: process.env.HOSTNAME || 'unknown' }
});
const Lock = mongoose.models.Lock || mongoose.model('Lock', LockSchema);

async function acquireLock(lockName, ttlSeconds = 300) {
  const now = new Date();
  const expiry = new Date(now.getTime() - ttlSeconds * 1000);
  const result = await Lock.findOneAndUpdate(
    { name: lockName, $or: [{ lockedAt: { $lt: expiry } }, { lockedAt: null }] },
    { name: lockName, lockedAt: now, lockedBy: process.env.HOSTNAME || 'unknown' },
    { upsert: true, new: true }
  );
  return result !== null;
}

async function releaseLock(lockName) {
  await Lock.deleteOne({ name: lockName });
}

// ---------- Main expiry warning logic ----------
async function sendExpiryWarnings() {
  const lockName = 'expiry_warnings_cron';
  const acquired = await acquireLock(lockName, 300); // 5 minutes TTL
  if (!acquired) {
    console.log('Another instance is running expiry warning cron, skipping.');
    return;
  }

  try {
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
    const results = { sent: 0, failed: 0, errors: [] };

    for (const customer of customers) {
      const currentExpiry = customer.subscription.expiresAt;
      // Already warned for this exact expiry date?
      if (customer.lastExpiryWarningExpiry &&
          customer.lastExpiryWarningExpiry.getTime() === currentExpiry.getTime()) {
        continue;
      }

      try {
        const formattedExpiry = currentExpiry.toLocaleDateString('en-GB');
        await smsTemplateService.sendUsingTemplate(
          'expiry_warning',
          customer.phoneNumber,
          {
            customerName: `${customer.firstName} ${customer.lastName}`,
            expiryDate: formattedExpiry,
          },
          {
            customerId: customer._id,
            accountId: customer.accountId,
            type: 'expiry_warning',
            regionCode: customer.regionCode,
          }
        );

        customer.lastExpiryWarningSentAt = new Date();
        customer.lastExpiryWarningExpiry = currentExpiry;
        await customer.save();
        results.sent++;
      } catch (err) {
        console.error(`Expiry warning failed for ${customer.accountId}:`, err.message);
        results.failed++;
        results.errors.push({ accountId: customer.accountId, error: err.message });
      }
    }

    console.log(`Expiry warnings sent: ${results.sent} sent, ${results.failed} failed`);
  } catch (error) {
    console.error('Expiry warning cron error:', error);
  } finally {
    await releaseLock(lockName);
  }
}

// ---------- Start cron scheduler ----------
function startExpiryWarningsCron() {
  // Run every day at 8:00 AM Nairobi time
  cron.schedule('0 8 * * *', async () => {
    console.log('🕒 Running expiry warning cron...');
    await sendExpiryWarnings();
  }, {
    timezone: 'Africa/Nairobi'
  });
  console.log('✅ Expiry warning cron scheduled for 8:00 AM daily (Nairobi time).');
}

module.exports = { startExpiryWarningsCron };