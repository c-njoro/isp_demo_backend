const Customer = require("../models/Customer");
const Package = require("../models/Package");
const Router = require("../models/Router");
const radiusService = require("./radiusService");

/**
 * Internal function to suspend a single customer
 * @param {string} customerId
 * @param {Object} options { reason, source, siteId, routerId, triggeredBy }
 * @returns {Promise<Object>}
 */
async function suspendCustomerInternally(customerId, options = {}) {
  const { reason, source = 'admin', siteId = null, routerId = null, triggeredBy = null } = options;
  const customer = await Customer.findById(customerId);
  if (!customer) throw new Error('Customer not found');
  if (customer.subscription.status === 'suspended') return { alreadySuspended: true };

  customer.subscription.status = 'suspended';
  customer.subscription.pausedAt = new Date();
  customer.suspensionSource = {
    reason: source, // 'site_offline' or 'admin' etc.
    siteId: siteId,
    timestamp: new Date(),
    details: { routerId, hoursOffline: options.hoursOffline }
  };
  if (reason) {
    customer.notes.push({
      note: `Account suspended: ${reason}`,
      addedAt: new Date()
    });
  }
  await customer.save();

  // Disable in RADIUS
  const radiusResult = await radiusService.disableAccount(customer.pppoe.username);
  if (!radiusResult.success) console.error('RADIUS disable failed:', radiusResult.error);

  return { success: true, customer };
}

/**
 * Internal function to reactivate a single customer
 * @param {string} customerId
 * @param {Object} options { triggeredBy }
 * @returns {Promise<Object>}
 */
async function reactivateCustomerInternally(customerId, options = {}) {
  const { triggeredBy = null } = options;
  const customer = await Customer.findById(customerId);
  if (!customer) throw new Error('Customer not found');
  if (customer.subscription.status !== 'suspended') return { alreadyActive: true };

  const now = new Date();
  const pausedAt = customer.subscription.pausedAt;
  if (pausedAt) {
    const suspensionDuration = now - pausedAt;
    customer.subscription.expiresAt = new Date(customer.subscription.expiresAt.getTime() + suspensionDuration);
    customer.subscription.pausedAt = null;
  }
  customer.subscription.status = 'active';
  customer.suspensionSource = null; // clear source

  customer.notes.push({
    note: 'Account reactivated – expiry extended by suspension period (router downtime)',
    addedAt: now
  });
  await customer.save();

  // Re-enable in RADIUS
  const packageDoc = await Package.findById(customer.subscription.packageId);
  if (packageDoc) {
    const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
    await radiusService.enableAccount(customer.pppoe.username, groupName);
  }

  return { success: true, customer };
}

/**
 * Suspend customers that are using a specific router,
 * based on how long the router has been offline.
 * @param {Object} router - Router document
 * @param {number} hoursOffline - Hours the router has been offline
 * @returns {Promise<number>} Number of customers suspended
 */
async function suspendCustomersForRouter(router, hoursOffline) {
  // Determine which packages to target based on offline duration
  let packageIds = [];
  if (hoursOffline >= 5 && hoursOffline < 7) {
    // Only packages with price > 3000
    const packages = await Package.find({ price: { $gt: 3000 } });
    packageIds = packages.map(p => p._id);
  } else if (hoursOffline >= 7) {
    // All packages
    const packages = await Package.find({});
    packageIds = packages.map(p => p._id);
  } else {
    return 0;
  }

  // Find customers whose nasIp matches this router's IP,
  // who are active, and whose package is in the target list
  const customers = await Customer.find({
    nasIp: router.ip,
    'subscription.status': 'active',
    'subscription.packageId': { $in: packageIds }
  });

  let suspendedCount = 0;
  for (const cust of customers) {
    try {
      await suspendCustomerInternally(cust._id, {
        source: 'site_offline',
        siteId: router.site,
        routerId: router._id,
        reason: `Router ${router.name} (${router.ip}) offline for ${hoursOffline} hours`,
        hoursOffline,
        triggeredBy: 'system'
      });
      suspendedCount++;
    } catch (err) {
      console.error(`Failed to suspend ${cust.accountId}:`, err.message);
    }
  }
  return suspendedCount;
}

/**
 * Reactivate customers who were suspended due to a specific router being offline,
 * now that the router is back online.
 * @param {Object} router - Router document (now online)
 * @returns {Promise<number>} Number of customers reactivated
 */
async function reactivateCustomersForRouter(router) {
  const customers = await Customer.find({
    nasIp: router.ip,
    'subscription.status': 'suspended',
    'suspensionSource.reason': 'site_offline',
    'suspensionSource.details.routerId': router._id
  });

  let reactivatedCount = 0;
  for (const cust of customers) {
    try {
      await reactivateCustomerInternally(cust._id, { triggeredBy: 'system' });
      reactivatedCount++;
    } catch (err) {
      console.error(`Failed to reactivate ${cust.accountId}:`, err.message);
    }
  }
  return reactivatedCount;
}

// For backward compatibility (if any old code expects site-based functions)
// We'll also export dummy site-based functions that do nothing or delegate.
async function suspendCustomersForSite(site, hoursOffline) {
  console.warn('suspendCustomersForSite is deprecated. Use suspendCustomersForRouter instead.');
  return 0;
}

async function reactivateCustomersForSite(site) {
  console.warn('reactivateCustomersForSite is deprecated. Use reactivateCustomersForRouter instead.');
  return 0;
}

module.exports = {
  suspendCustomerInternally,
  reactivateCustomerInternally,
  suspendCustomersForRouter,
  reactivateCustomersForRouter,
  // Deprecated site-based exports for backward compatibility
  suspendCustomersForSite,
  reactivateCustomersForSite
};