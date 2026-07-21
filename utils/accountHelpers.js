const Customer = require('../models/Customer');
const HotspotUser = require('../models/HotspotUser');

/**
 * Generate next account ID for a region
 * Format: REGIONCODE + 4-digit sequential number (e.g., SKY0001, SKN0045)
 */
const generateAccountId = async (regionCode) => {
  try {
    // Get last customer in this region
    const lastCustomer = await Customer
      .findOne({ regionCode })
      .sort({ accountId: -1 })
      .limit(1);

    if (!lastCustomer) {
      // First customer in this region
      return `${regionCode}0001`;
    }

    // Extract number from account ID (remove region code)
    const lastNumber = parseInt(lastCustomer.accountId.replace(regionCode, ''));
    
    // Increment and pad with zeros
    const nextNumber = (lastNumber + 1).toString().padStart(4, '0');

    return `${regionCode}${nextNumber}`;
  } catch (error) {
    console.error('Error generating account ID:', error);
    throw error;
  }
};

/**
 * Generate random PPPoE password
 * Format: 8 characters alphanumeric
 */
function generatePPPoEPassword() {
  // Remove special characters that cause issues in SQL and RADIUS
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Activate all children that share expiry with the given parent.
 * Sets their status to active, updates expiry to parent's new expiry,
 * and enables RADIUS with their own package group.
 * @param {Object} parent - Parent customer document
 * @param {Date} newExpiry - The new expiry date (usually parent's expiry)
 */
async function activateSharedExpiryChildren(parent, newExpiry) {
  if (!parent.sharedExpiry || parent.sharedExpiry.length === 0) return;

  const radiusService = require("../services/radiusService");
  const children = await Customer.find({ _id: { $in: parent.sharedExpiry } }).populate('subscription.packageId');

  for (const child of children) {
    // Update expiry and status
    child.subscription.expiresAt = newExpiry;
    child.subscription.status = 'active';
    if (!child.subscription.activatedAt) child.subscription.activatedAt = new Date();
    await child.save();

    // Enable RADIUS with the child's own package group
    const packageDoc = child.subscription.packageId;
    if (packageDoc) {
      const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
      await radiusService.enableAccount(child.pppoe.username, groupName);
      await radiusService.setBillingCycleStart(child.pppoe.username, new Date());
    }

    // System log for child activation
    await SystemLog.create({
      eventType: "expiry_propagation",
      severity: "info",
      regionCode: child.regionCode,
      entityType: "customer",
      entityId: child._id,
      accountId: child.accountId,
      message: `Child account activated due to parent ${parent.accountId} renewal/activation`,
      details: { parentId: parent._id, newExpiry },
      triggeredBy: "system",
      success: true,
    });
  }
}

/**
 * Generate WiFi password
 * Format: 8 characters alphanumeric (easier to type)
 */
const generateWiFiPassword = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

/**
 * Validate MAC address format
 */
const isValidMacAddress = (mac) => {
  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
  return macRegex.test(mac);
};

/**
 * Normalize MAC address to uppercase with colons
 */
const normalizeMacAddress = (mac) => {
  // Remove all separators and convert to uppercase
  const cleaned = mac.replace(/[:-]/g, '').toUpperCase();
  
  // Insert colons every 2 characters
  return cleaned.match(/.{1,2}/g).join(':');
};

module.exports = {
  generateAccountId,
  generatePPPoEPassword,
  generateWiFiPassword,
  isValidMacAddress,
  normalizeMacAddress,
  activateSharedExpiryChildren
};