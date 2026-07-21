const cron = require('node-cron');
const Router = require('../models/Router');
const mikrotikService = require('../services/mikroticService');
const { suspendCustomersForRouter, reactivateCustomersForRouter } = require('../services/siteAutomation');

async function checkRoutersConnectivity() {
  console.log('[RouterHealthCheck] Starting scheduled check...');
  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

  // Find all active routers that haven't been tested in the last 10 minutes
  const routers = await Router.find({
    isActive: true,
    $or: [
      { lastConnectionTest: { $exists: false } },
      { 'lastConnectionTest.timestamp': { $lt: tenMinutesAgo } }
    ]
  });

  for (const router of routers) {
    const previousSuccess = router.isOnline ?? false;
    let currentSuccess = false;

    try {
      // Test connection using router credentials
      const testResult = await mikrotikService.testConnection({
        router: {
          ip: router.ip,
          username: router.username,
          password: router.password,
          port: router.apiPort || 8728,
        }
      });
      currentSuccess = testResult.success;

      // Update router connection test record
      router.lastConnectionTest = {
        success: currentSuccess,
        timestamp: new Date(),
        method: 'api',
        error: currentSuccess ? null : (testResult.error || 'Unknown error')
      };
      router.isOnline = currentSuccess;
      if (currentSuccess) router.lastOnline = new Date();
      await router.save();

      // If coming back online, reactivate customers
      if (currentSuccess && !previousSuccess) {
        console.log(`[RouterHealthCheck] Router ${router.name} (${router.ip}) came online. Reactivating customers...`);
        const reactivated = await reactivateCustomersForRouter(router);
        console.log(`[RouterHealthCheck] Reactivated ${reactivated} customers for router ${router.name}`);
      }
    } catch (err) {
      console.error(`[RouterHealthCheck] Error testing router ${router.name} (${router.ip}):`, err.message);
      router.lastConnectionTest = {
        success: false,
        timestamp: new Date(),
        method: 'api',
        error: err.message
      };
      router.isOnline = false;
      await router.save();
    }
  }

  // After testing all routers, handle suspensions for those offline long enough
  await handleLongOfflineRouters();

  console.log('[RouterHealthCheck] Completed');
}

async function handleLongOfflineRouters() {
  const now = new Date();

  // Get routers that are currently offline
  const offlineRouters = await Router.find({ isOnline: false, isActive: true });

  for (const router of offlineRouters) {
    // Determine how long it has been offline
    const offlineSince = router.lastOnline || router.lastConnectionTest?.timestamp;
    if (!offlineSince) continue;

    const hoursOffline = (now - offlineSince) / (1000 * 60 * 60);

    if (hoursOffline >= 5) {
      console.log(`[RouterHealthCheck] Router ${router.name} offline for ${hoursOffline.toFixed(1)}h – suspending customers...`);
      const suspended = await suspendCustomersForRouter(router, hoursOffline);
      console.log(`[RouterHealthCheck] Suspended ${suspended} customers for router ${router.name}`);
    }
  }
}

// Schedule the cron job to run every 15 minutes
cron.schedule('*/45 * * * *', () => {
  checkRoutersConnectivity().catch(err => console.error('[Cron] Unhandled error:', err));
});

// Export for testing
module.exports = { checkRoutersConnectivity };