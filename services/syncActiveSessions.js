// services/syncActiveSessions.js
const Customer = require('../models/Customer');
const radiusService = require('./radiusService');

function isTrulyOnline(framedIp) {
  if (!framedIp) return false;
  const parts = framedIp.split('.').map(Number);
  if (parts.length !== 4) return false;
  // Problem IP ranges (online‑no‑internet)
  if (parts[0] === 10 && parts[1] === 254 && parts[2] === 254) return false;
  if (parts[0] === 20 && parts[1] === 20 && parts[2] === 0) return false;
  if (parts[0] === 30 && parts[1] === 30 && parts[2] === 0) return false;
  if (parts[0] === 40 && parts[1] === 40 && parts[2] === 0) return false;
  return true;
}

async function syncActiveSessions() {
  console.log('[Sync Active Sessions] Starting...', new Date().toISOString());
  let connection;
  try {
    connection = await radiusService.getConnection();
    const [activeSessions] = await connection.query(
      `SELECT username, nasipaddress, callingstationid, framedipaddress, acctstarttime
       FROM radacct WHERE acctstoptime IS NULL`
    );
    if (!activeSessions.length) {
      console.log('[Sync Active Sessions] No active sessions.');
      connection.release();
      return;
    }
    console.log(`[Sync Active Sessions] Found ${activeSessions.length} active sessions.`);

    const usernames = activeSessions.map(s => s.username);
    const customers = await Customer.find(
      { 'pppoe.username': { $in: usernames } },
      '_id pppoe.username pppoe.siteIp nasIp cpe.macAddress connectionStatus'
    ).lean();
    if (!customers.length) {
      console.log('[Sync Active Sessions] No matching customers.');
      connection.release();
      return;
    }

    const customerMap = new Map();
    customers.forEach(c => customerMap.set(c.pppoe.username, c));

    const customerUpdates = [];

    for (const session of activeSessions) {
      const customer = customerMap.get(session.username);
      if (!customer) continue;

      const currentNasIp = customer.pppoe.siteIp || null;
      const sessionNasIp = session.nasipaddress;
      const currentMac = customer.cpe?.macAddress || null;
      const sessionMac = session.callingstationid ? session.callingstationid.toUpperCase() : null;
      const isOnline = isTrulyOnline(session.framedipaddress);

      let needsUpdate = false;
      const updateFields = {};

      // 1. Update NAS IP (always)
      if (currentNasIp !== sessionNasIp) {
        updateFields['pppoe.siteIp'] = sessionNasIp;
        updateFields['nasIp'] = sessionNasIp;
        needsUpdate = true;
        console.log(`[Sync] ${session.username}: NAS IP ${currentNasIp} -> ${sessionNasIp}`);
      }

      // 2. Update MAC binding only if truly online
      if (isOnline && sessionMac && currentMac !== sessionMac) {
        updateFields['cpe.macAddress'] = sessionMac;
        needsUpdate = true;
        console.log(`[Sync] ${session.username}: MAC ${currentMac} -> ${sessionMac} (online, updating binding)`);
        // Update RADIUS binding inside a transaction
        try {
          await connection.query('START TRANSACTION');
          await connection.query(
            'DELETE FROM radcheck WHERE username = ? AND attribute = ?',
            [session.username, 'Calling-Station-Id']
          );
          await connection.query(
            'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
            [session.username, 'Calling-Station-Id', '==', sessionMac]
          );
          await connection.query('COMMIT');
          console.log(`[Sync] ${session.username}: RADIUS MAC binding updated.`);
        } catch (err) {
          await connection.query('ROLLBACK');
          console.error(`[Sync] ${session.username}: RADIUS binding failed:`, err);
        }
      } else if (!isOnline && sessionMac && currentMac !== sessionMac) {
        console.log(`[Sync] ${session.username}: Active but not truly online (IP ${session.framedipaddress}) – skip MAC binding.`);
      }

      // 3. Update connectionStatus cache
      const newStatus = isOnline ? 'online' : 'online-no-internet';
      const oldStatus = customer.connectionStatus?.status;
      if (oldStatus !== newStatus) {
        updateFields['connectionStatus.status'] = newStatus;
        if (newStatus === 'online') {
          updateFields['connectionStatus.lastOnline'] = new Date();
          updateFields['connectionStatus.noInternetSince'] = null;
        } else if (!customer.connectionStatus?.noInternetSince) {
          updateFields['connectionStatus.noInternetSince'] = new Date();
        }
        needsUpdate = true;
      }

      // Always refresh timestamp and current session data
      updateFields['connectionStatus.lastChecked'] = new Date();
      updateFields['connectionStatus.currentIp'] = session.framedipaddress || null;
      updateFields['connectionStatus.currentNasIp'] = sessionNasIp;
      updateFields['connectionStatus.currentMac'] = sessionMac;
      needsUpdate = true;

      if (needsUpdate) {
        customerUpdates.push({
          updateOne: {
            filter: { _id: customer._id },
            update: { $set: updateFields }
          }
        });
      }
    }

    if (customerUpdates.length) {
      const bulkResult = await Customer.bulkWrite(customerUpdates);
      console.log(`[Sync Active Sessions] Updated ${bulkResult.modifiedCount} customer records.`);
    }

    connection.release();
    console.log('[Sync Active Sessions] Completed.', new Date().toISOString());
  } catch (error) {
    console.error('[Sync Active Sessions] Error:', error);
    if (connection) connection.release();
  }
}

module.exports = syncActiveSessions;