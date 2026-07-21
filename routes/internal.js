const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const Transaction = require('../models/Transaction');
const SystemLog = require('../models/SystemLog');
const Router = require('../models/Router');
const radiusService = require('../services/radiusService');
const { calculatePeriodEnd } = require('../utils/invoiceHelpers');
const HotspotUser = require('../models/HotspotUser');
const {generateAndSendVouchers} = require("../services/voucherGenerationService");


// Simple middleware to verify the request is from our shell script
const verifyInternalSecret = (req, res, next) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== process.env.RADIUS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

router.post('/radius-activate', verifyInternalSecret, async (req, res) => {
  // Respond immediately — RADIUS shell script must not wait
  res.json({ received: true });

  const { username } = req.body;
  if (!username) return;

  try {
    const customer = await Customer.findOne({
      'pppoe.username': username,
    }).populate('subscription.packageId');

    if (!customer) {
      console.log(` [radius-activate] No waiting customer found for ${username}`);
      return;
    }

    if (customer.subscription.status !== 'expired') {
    customer.waitingForSession = false;

    await customer.save();

    const radiusService = require("../services/radiusService");
    await radiusService.removePendingActivation(customer.pppoe.username);
    await radiusService.killUserSession(customer.pppoe.username);
    await radiusService.disableAccount(customer.pppoe.username);

      console.log(`[radius-activate] Customer is not expired, skipping.`);
      return;
    }

    const packageDoc = customer.subscription.packageId;
    if (!packageDoc) return;

    const balance = customer.billing?.balance || 0;
    const packagePrice = packageDoc.price;

    if (balance < packagePrice) {
      console.log(` [radius-activate] ${username} insufficient balance — skipping`);

      customer.waitingForSession = false;

    await customer.save();

    
      const radiusService = require("../services/radiusService");
      await radiusService.removePendingActivation(customer.pppoe.username);
      await radiusService.killUserSession(customer.pppoe.username);
      await radiusService.disableAccount(customer.pppoe.username);
      return;
    }

    const now = new Date();
    const newBalance = balance - packagePrice;

    let newExpiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);
    if (customer.freeExtensionDays > 0) {
      newExpiry = new Date(newExpiry);
      newExpiry.setDate(newExpiry.getDate() - customer.freeExtensionDays);
      if (newExpiry < now) newExpiry = now;
      customer.freeExtensionDays = 0;
    }

    customer.billing.balance = newBalance;
    customer.billing.lastPaymentDate = now;
    customer.subscription.status = 'active';
    customer.subscription.expiresAt = newExpiry;
    customer.subscription.activatedAt = now;
    customer.waitingForSession = false;

    if (!customer.renewals) customer.renewals = [];
    customer.renewals.push({ dateRenewed: now, method: 'wallet_auto', amount: packagePrice });

    await customer.save();

    // Enable RADIUS + remove from pending table
    const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
    await radiusService.enableAccountWithNoKill(customer.pppoe.username, groupName);
    await radiusService.setBillingCycleStart(customer.pppoe.username, new Date());
    await radiusService.removePendingActivation(customer.pppoe.username);

    // Shared expiry children
    if (customer.sharedExpiry?.length > 0) {
      const children = await Customer.find({
        _id: { $in: customer.sharedExpiry }
      }).populate('subscription.packageId');

      for (const child of children) {
        child.subscription.expiresAt = newExpiry;
        child.subscription.status = 'active';
        if (!child.subscription.activatedAt) child.subscription.activatedAt = now;
        await child.save();
        const childGroup = child.subscription.packageId.packageName
          .replace(/\s+/g, '_').toUpperCase();
        await radiusService.enableAccount(child.pppoe.username, childGroup);
        await radiusService.setBillingCycleStart(child.pppoe.username, new Date());
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
      type: 'SUBSCRIPTION',
      customerType: 'pppoe',
      customerId: customer._id,
      accountId: customer.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: customer.regionCode,
      siteId: customer.siteId,
      amount: -packagePrice,
      description: 'Instant activation via RADIUS dial-in webhook',
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
      message: `⚡ Instant-activated ${customer.accountId} via RADIUS dial-in webhook`,
      details: { amount: packagePrice, newBalance, newExpiry },
      success: true,
    });

    console.log(` [radius-activate] Instant-activated ${customer.accountId}, expiry: ${newExpiry}`);

  } catch (err) {
    console.error(`🔥 [radius-activate] Failed for ${username}:`, err);
  }
});

// Add this to your existing internal.js, before module.exports

router.post('/kick-hotspot', verifyInternalSecret, async (req, res) => {
  // Respond immediately – the webhook does not wait for the result
  res.json({ received: true });

  const { username, nasIp, sessionId } = req.body;
  if (!username) {
    console.log('⚡ [kick-hotspot] No username provided');
    return;
  }

  try {
    // Convert hs_MACADDRESS to colon‑separated MAC (e.g., "hs_2EB1C434522F" → "2E:B1:C4:34:52:2F")
    const macAddress = username.replace(/^hs_/, '').replace(/(..)/g, '$1:').slice(0, -1);
    
    // Find the router by NAS IP
    const router = await Router.findOne({ ip: nasIp });
    if (!router) {
      console.log(`⚡ [kick-hotspot] No router found for NAS IP: ${nasIp}`);
      return;
    }

    // ============================================================
    // STEP 1: Check if HotspotUser record exists AND kickedAt is null
    // ============================================================
    const hotspotUser = await HotspotUser.findOne({ macAddress, kickedAt: null });
    if (!hotspotUser) {
      console.log(`⚡ [kick-hotspot] No HotspotUser record with kickedAt=null for MAC ${macAddress} – skipping kick`);
      return;
    }

    // ============================================================
    // STEP 2: Verify the user actually has an active session on the MikroTik
    // ============================================================
    const mikrotikService = require('../services/mikroticService');
    let hasActiveSession = false;

    try {
      const api = await mikrotikService._getConnection({ router });
      const active = await api.write('/ip/hotspot/active/print', [
        `?mac-address=${macAddress}`
      ]);
      hasActiveSession = active && active.length > 0;
      await api.close();
    } catch (err) {
      console.error(`⚡ [kick-hotspot] Failed to check active session: ${err.message}`);
    }

    if (!hasActiveSession) {
      console.log(`⚡ [kick-hotspot] ${username} has no active hotspot session on ${nasIp} – skipping kick`);
      return;
    }

    console.log(`⚡ [kick-hotspot] ${username} has active session – proceeding with kick`);

    // ============================================================
    // STEP 3: Perform the kick (remove active session from MikroTik)
    // ============================================================
    const result = await mikrotikService.kickHotspotUser({ router }, macAddress);
    console.log(`⚡ [kick-hotspot] Kicked ${username} from ${nasIp}:`, result);

    // ============================================================
    // STEP 4: Update kickedAt timestamp only if the kick actually succeeded
    // ============================================================
    if (result.success && result.wasConnected) {
      await HotspotUser.updateOne(
        { _id: hotspotUser._id },
        { $set: { kickedAt: new Date() } }
      );
      console.log(`⚡ [kick-hotspot] Updated kickedAt for ${macAddress}`);
    } else {
      console.log(`⚡ [kick-hotspot] Kick did not remove a session – not updating kickedAt`);
    }

  } catch (err) {
    console.error(`🔥 [kick-hotspot] Failed for ${username}:`, err);
  }
});

// Add this at the top with other requires


module.exports = router;