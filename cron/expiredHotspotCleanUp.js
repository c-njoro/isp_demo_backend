const cron = require('node-cron');
const mongoose = require('mongoose');
const HotspotUser = require('../models/HotspotUser');
const radiusService = require('../services/radiusService');
const mikrotikService = require('../services/mikroticService');
const Router = require('../models/Router');

async function cleanupExpiredHotspots() {
  console.log('\n🧹 Running expired hotspot cleanup...');
  
  const now = new Date();
  
  // Find all expired active sessions
  const expiredUsers = await HotspotUser.find({
    'activeSession.isActive': true,
    'activeSession.expiresAt': { $lt: now }
  });

  console.log(`   Found ${expiredUsers.length} expired hotspot users`);

  for (const user of expiredUsers) {
    try {
      const username = `hs_${user.macAddress.replace(/[:-]/g, '')}`;
  
      // 1. Update MongoDB — mark session inactive
      user.activeSession.isActive = false;
      await user.save();
  
      // 3. Send CoA disconnect to MikroTik to immediately kick the session
      const conn = await radiusService.getConnection();
      const [sessions] = await conn.query(
        `SELECT nasipaddress, acctsessionid, framedipaddress 
         FROM radacct 
         WHERE username = ? AND acctstoptime IS NULL 
         LIMIT 1`,
        [username]
      );
      conn.release();
  
      if (sessions.length > 0) {
        const router = await Router.findOne({ip: sessions[0].nasipaddress});
        const macAddress = user.macAddress;

        if (router) {
          await mikrotikService.kickHotspotUser({ router }, macAddress);
        }
      }

      console.log(`   ✅ Expired user cleaned up: ${user.macAddress}`);
    } catch (error) {
      console.error(`   ❌ Failed to cleanup ${user.macAddress}:`, error.message);
    }
  }
  
  console.log('🧹 Cleanup complete\n');
}

function startExpiredHotspotCleanupCron() {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('[CRON] Running expired hotspot cleanup...');
    try {
      await cleanupExpiredHotspots();
    } catch (err) {
      console.error('[CRON] Expired hotspot cleanup failed:', err);
    }
  });
  console.log('[CRON] Expired hotspot cleanup scheduled (every 5 minutes).');
}

module.exports = { startExpiredHotspotCleanupCron };