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
  normalizeMacAddress
};