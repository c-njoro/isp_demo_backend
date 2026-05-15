// cron/syncActiveSessions.js
const cron = require('node-cron');
const syncActiveSessions = require('../services/syncActiveSessions');

function startSyncActiveSessionsCron() {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    console.log('[CRON] Running syncActiveSessions...');
    try {
      await syncActiveSessions();
    } catch (err) {
      console.error('[CRON] syncActiveSessions failed:', err);
    }
  });
  console.log('[CRON] syncActiveSessions scheduled (every 15 minutes).');
}

module.exports = { startSyncActiveSessionsCron };