const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load local MAC vendor database
let macVendorMap = null;

function loadLocalDatabase() {
  if (macVendorMap !== null) return macVendorMap;
  try {
    const dbPath = path.join(__dirname, '../data/mac-vendors.json');
    const rawData = fs.readFileSync(dbPath, 'utf8');
    macVendorMap = new Map(Object.entries(JSON.parse(rawData)));
    console.log(`✅ Loaded ${macVendorMap.size} MAC vendor entries from local database`);
  } catch (err) {
    console.error('⚠️ Failed to load local MAC vendor database:', err.message);
    macVendorMap = new Map(); // empty map, fallback to API
  }
  return macVendorMap;
}

// Extract OUI (first 6 hex digits, colon-separated)
function getOui(mac) {
  if (!mac) return null;
  const normalized = mac.toUpperCase().replace(/[^A-F0-9]/g, '');
  if (normalized.length < 6) return null;
  const oui = normalized.slice(0, 6);
  return oui.match(/.{1,2}/g).join(':');
}

const cache = new Map(); // runtime cache for lookups

async function getMacVendor(mac) {
  if (!mac) return null;

  const oui = getOui(mac);
  if (!oui) return null;

  // Check runtime cache
  if (cache.has(oui)) return cache.get(oui);

  // 1. Try local database first
  const localMap = loadLocalDatabase();
  if (localMap.has(oui)) {
    const vendor = localMap.get(oui);
    cache.set(oui, vendor);
    return vendor;
  }

  // 2. Fallback to online API (with caching)
  try {
    const response = await axios.get(`https://api.macvendors.com/${oui}`, {
      timeout: 3000,
      headers: { 'User-Agent': 'ISP-Management-System/1.0' }
    });
    if (response.status === 200 && response.data && typeof response.data === 'string') {
      const vendor = response.data.trim();
      if (vendor && !vendor.includes('Not Found')) {
        cache.set(oui, vendor);
        // Optionally store in local map for future runs? Not necessary.
        return vendor;
      }
    }
    // Cache negative result to avoid repeated API calls for unknown OUIs
    cache.set(oui, null);
    return null;
  } catch (error) {
    console.error(`MAC vendor lookup failed for ${oui}:`, error.message);
    cache.set(oui, null);
    return null;
  }
}

module.exports = { getMacVendor };