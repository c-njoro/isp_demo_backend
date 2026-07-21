// services/syncActiveSessions.js
const Customer = require('../models/Customer');
const radiusService = require('./radiusService');

/**
 * Check if a username already has a radcheck entry with Calling-Station-Id
 * @param {string} username
 * @returns {Promise<boolean>} true if exists, false otherwise
 */
async function hasCallingStationIdBinding(username) {
  let conn;
  try {
    conn = await radiusService.getConnection();
    const [rows] = await conn.query(
      `SELECT 1 FROM radcheck 
       WHERE username = ? AND attribute = 'Calling-Station-Id' LIMIT 1`,
      [username]
    );
    return rows.length > 0;
  } catch (err) {
    console.error(`Error checking Calling-Station-Id binding for ${username}:`, err);
    return false; // On error, assume no binding to avoid blocking
  } finally {
    if (conn) conn.release();
  }
}

async function syncActiveSessions() {
  console.log('[syncActiveSessions] Starting...');

  // 1. Get all active RADIUS sessions
  const activeResult = await radiusService.getActiveSessions();
  if (!activeResult.success) {
    console.error('[syncActiveSessions] Failed to get active sessions:', activeResult.error);
    return;
  }

  const activeSessions = activeResult.sessions;
  console.log(`[syncActiveSessions] Found ${activeSessions.length} active sessions`);

  let updated = 0;
  let skippedBound = 0;

  for (const session of activeSessions) {
    const username = session.username;
    const callingMac = session.callingMac; // MAC from RADIUS (Calling-Station-Id)
    const callingNas = session.nasIpAddress;
    if (!callingMac) continue;

   

    const customer = await Customer.findOne({ 'pppoe.username': username });
    if (!customer) continue;

    if(callingNas && customer.nasIp !== callingNas){
      console.log("Updating nas for customer, ")
      customer.nasIp = callingNas;
      customer.pppoe.siteIp = callingNas;
      await customer.save();
    }


    // If user already has a radcheck Calling-Station-Id entry, skip entirely
    const alreadyBound = await hasCallingStationIdBinding(username);
    if (alreadyBound) {
     
      skippedBound++;
      continue;
    }

    // Find the customer by PPPoE username


    // Update MAC if different
    if (customer.cpe?.macAddress !== callingMac) {

      customer.cpe.macAddress = callingMac;
      await customer.save();

      
        // Update RADIUS MAC binding in background (fire and forget)
        radiusService.updateMacBinding(customer.pppoe.username, callingMac).catch(err =>
          console.error("Background MAC update failed:", err)
        );
      
      updated++;
    }
  }

  console.log(`[syncActiveSessions] Done: ${updated} MACs updated, ${skippedBound} skipped (already MAC-bound via radcheck)`);
}

module.exports = syncActiveSessions;