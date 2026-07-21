const cron = require('node-cron');
const Router = require('../models/Router');
const IfaceStatsTimeseries = require('../models/IfaceStatsTimeseries');
const mikrotikService = require('../services/mikroticService');
const { sendBandwidthPollAlert } = require('../services/bandwidthAlertService');

/**
 * Poll a single router: fetch current counters, diff against the last
 * stored sample per interface, write new timeseries rows.
 */
async function pollRouter(router) {
  // Fetch the router document with the state fields
  const routerDoc = await Router.findById(router._id).select('lastPollSuccessful lastPollTimestamp');
  
  const site = {
    ip: router.ip,
    port: router.apiPort || 8728,
    username: router.username,
    password: router.password
  };

  console.log(`[bandwidthPoller] Polling ${router.name} (${router.ip})...`);

  let success = false;
  let errorMessage = null;
  let interfacesWritten = 0;

  try {
    const result = await Promise.race([
      mikrotikService.getInterfaceCounters(site),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('getInterfaceCounters timed out after 30s')), 60000)
      )
    ]);

    if (!result.success) {
      success = false;
      errorMessage = result.error;
      console.error(`[bandwidthPoller] ❌ ${router.name}: ${result.error}`);
    } else {
      success = true;
      const now = new Date();
      const ifaceCount = result.data.length;
      console.log(`[bandwidthPoller] ${router.name}: found ${ifaceCount} interfaces`);

      if (ifaceCount === 0) {
        console.warn(`[bandwidthPoller] ⚠️ ${router.name}: no interfaces — skipping write`);
        // We still consider this a "successful" poll (we got a response, just no interfaces)
        success = true;
      } else {
        for (const current of result.data) {
          if (!current.iface) continue;
          const last = await IfaceStatsTimeseries.findOne({
            routerId: router._id,
            iface: current.iface
          }).sort({ sampledAt: -1 });

          let rxBps = 0, txBps = 0;
          if (last) {
            const elapsedSeconds = (now - last.sampledAt) / 1000;
            if (elapsedSeconds > 1) {
              rxBps = computeRate(current.rxByte, last.rxBytesRaw, elapsedSeconds);
              txBps = computeRate(current.txByte, last.txBytesRaw, elapsedSeconds);
            }
          }

          await IfaceStatsTimeseries.create({
            routerId: router._id,
            iface: current.iface,
            rxBps,
            txBps,
            rxBytesRaw: current.rxByte,
            txBytesRaw: current.txByte,
            ifSpeed: current.ifSpeed,
            sampledAt: now
          });
          interfacesWritten++;
        }
        console.log(`[bandwidthPoller] ✅ ${router.name}: wrote ${interfacesWritten} interface samples`);
      }
    }
  } catch (error) {
    success = false;
    errorMessage = error.message;
    console.error(`[bandwidthPoller] ❌ ${router.name}: unhandled error: ${error.message}`);
  }

  // ─── Update router state and send alerts ──────────────────────────────────────
  const prevSuccess = routerDoc.lastPollSuccessful;
  const now = new Date();
  routerDoc.lastPollTimestamp = now;
  routerDoc.lastPollSuccessful = success;
  await routerDoc.save();

  // Send alert only if we have a previous state (not the first poll) AND the state changed
  if (prevSuccess !== null && prevSuccess !== success) {
    await sendBandwidthPollAlert(router, success, errorMessage || '');
  }

  return { routerId: router._id, routerName: router.name, success, interfacesWritten };
}

function computeRate(currentBytes, lastBytes, elapsedSeconds) {
  const deltaBytes = currentBytes >= lastBytes
    ? currentBytes - lastBytes
    : currentBytes;
  const bps = (deltaBytes * 8) / elapsedSeconds;
  return Number.isFinite(bps) && bps >= 0 ? Math.round(bps) : 0;
}

async function pollAllRouters() {
  console.log('[bandwidthPoller] Run starting...');
  const routers = await Router.find({ isActive: true });
  console.log(`[bandwidthPoller] Found ${routers.length} active routers`);

  const results = [];
  for (const router of routers) {
    const start = Date.now();
    try {
      const result = await pollRouter(router);
      results.push(result);
      if (!result.success) {
        console.error(`[bandwidthPoller] ❌ ${router.name}: ${result.error}`);
      }
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`[bandwidthPoller] ⏱️ ${router.name}: ${elapsed}s`);
    } catch (error) {
      console.error(`[bandwidthPoller] Unexpected error polling ${router.name}:`, error.message);
      results.push({ routerId: router._id, routerName: router.name, success: false, error: error.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const totalInterfaces = results.reduce((sum, r) => sum + (r.interfacesWritten || 0), 0);
  console.log(`[bandwidthPoller] Run complete: ${succeeded}/${results.length} routers polled, ${totalInterfaces} interface samples written`);
}

let scheduledTask = null;

function start() {
  if (scheduledTask) {
    console.warn('[bandwidthPoller] start() called more than once — ignoring duplicate call');
    return scheduledTask;
  }

  scheduledTask = cron.schedule('*/5 * * * *', () => {
    pollAllRouters().catch(error => {
      console.error('[bandwidthPoller] Run failed entirely:', error.message);
    });
  });

  console.log('[bandwidthPoller] Scheduled: every 5 minutes');
  return scheduledTask;
}

function stop() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

module.exports = {
  start,
  stop,
  pollAllRouters,
  pollRouter
};