// utils/macVendor.js
const axios = require('axios');
const cache = new Map(); // simple in‑memory cache

async function getMacVendor(mac) {
  if (!mac) return null;
  
  // Normalize MAC: uppercase, remove separators
  const normalized = mac.toUpperCase().replace(/[^A-F0-9]/g, '');
  
  // Check cache first
  if (cache.has(normalized)) {
    return cache.get(normalized);
  }
  
  try {
    // Use macvendors.com API (free, no key, returns plain text)
    const response = await axios.get(`https://api.macvendors.com/${normalized}`, {
      timeout: 3000,
      headers: { 'Accept': 'text/plain' }
    });
    
    const vendor = response.data.trim();
    const result = vendor === 'Not Found' ? null : vendor;
    
    // Cache for 24 hours
    cache.set(normalized, result);
    setTimeout(() => cache.delete(normalized), 24 * 60 * 60 * 1000);
    
    return result;
  } catch (error) {
    // On error, return null; do not fail the whole request
    console.error(`MAC lookup failed for ${mac}:`, error.message);
    return null;
  }
}

module.exports = { getMacVendor };