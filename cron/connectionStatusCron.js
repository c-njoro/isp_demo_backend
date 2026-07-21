const cron = require('node-cron');
const Customer = require('../models/Customer');
const Site = require('../models/Site');
const mikroticService = require('../services/mikroticService');

/**
 * Background Cron Job: Update Customer Connection Status
 * 
 * WHY THIS IS NEEDED:
 * - We only update lastOnline when someone manually checks customer status
 * - If a customer stays online for days without being checked, lastOnline becomes stale
 * - When they go offline, it looks like they were offline for days (incorrect!)
 * 
 * SOLUTION:
 * - Run this job every 5-15 minutes
 * - Fetch ALL active PPPoE sessions from all sites
 * - Update lastOnline for all currently connected customers
 * - This keeps lastOnline timestamps fresh even if nobody checks status
 */

class ConnectionStatusCron {
  
  /**
   * Start the cron job
   * @param {string} schedule - Cron schedule (default: every 10 minutes)
   */
  static start(schedule = '*/30 * * * *') {
    console.log('🕐 Starting Connection Status Cron Job...');
    console.log(`   Schedule: ${schedule}`);
    
    // Run immediately on startup
    this.updateAllConnectionStatuses();
    
    // Schedule recurring job
    cron.schedule(schedule, async () => {
      await this.updateAllConnectionStatuses();
    });
    
    console.log('✅ Connection Status Cron Job started successfully');
  }
  
  /**
   * Main function: Update connection status for all customers
   */
  static async updateAllConnectionStatuses() {
    const startTime = Date.now();
    console.log('\n================================================');
    console.log('🔄 Starting Connection Status Update...');
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log('================================================\n');
    
    try {
      // Get all active sites with routers
      const sites = await Site.find({ 
        isActive: true,
        'router.ip': { $exists: true }
      });
      
      console.log(`📍 Found ${sites.length} active sites with routers`);
      
      let totalCustomersUpdated = 0;
      let totalCustomersOnline = 0;
      let totalSitesProcessed = 0;
      let totalErrors = 0;
      
      // Process each site
      for (const site of sites) {
        try {
          console.log(`\n🏢 Processing site: ${site.siteName} (${site.router.ip})`);
          
          // Get all active PPPoE sessions from this site's router
          const sessionsResult = await mikroticService.getActivePPPoESessions(site);
          
          if (!sessionsResult.success) {
            console.error(`   ❌ Failed to get sessions: ${sessionsResult.error}`);
            totalErrors++;
            continue;
          }
          
          const sessions = sessionsResult.sessions || [];
          console.log(`   📡 Found ${sessions.length} active PPPoE sessions`);
          
          if (sessions.length === 0) {
            console.log(`   ℹ️  No active sessions on this site`);
            totalSitesProcessed++;
            continue;
          }
          
          // Extract usernames from sessions
          const activeUsernames = sessions.map(s => s.name);
          
          // Find customers from this site who are in the active sessions
          const onlineCustomers = await Customer.find({
            siteId: site._id,
            'pppoe.username': { $in: activeUsernames }
          });
          
          console.log(`   👥 Found ${onlineCustomers.length} customers to update`);
          
          // Update each online customer
          for (const customer of onlineCustomers) {
            const session = sessions.find(s => s.name === customer.pppoe.username);
            
            if (session) {
              // Initialize connectionStatus if it doesn't exist
              if (!customer.connectionStatus) {
                customer.connectionStatus = {};
              }
              
              // Update connection status
              const wasOffline = customer.connectionStatus.status !== 'online';
              
              customer.connectionStatus = {
                status: 'online',
                lastOnline: new Date(),
                lastChecked: new Date(),
                currentIp: session.address,
                currentMac: session.callingStation,
                lastOffline: customer.connectionStatus.lastOffline // Preserve
              };
              
              // Save without validation
              await customer.save({ validateBeforeSave: false });
              
              totalCustomersUpdated++;
              totalCustomersOnline++;
              
              if (wasOffline) {
                console.log(`   🟢 ${customer.accountId} came back ONLINE (${session.address})`);
              }
            }
          }
          
          // Mark customers as offline if they're not in active sessions
          // (Optional: only do this if you want automatic offline detection)
          await this.markOfflineCustomers(site, activeUsernames);
          
          totalSitesProcessed++;
          console.log(`   ✅ Site processed successfully`);
          
        } catch (siteError) {
          console.error(`   ❌ Error processing site ${site.siteName}:`, siteError.message);
          totalErrors++;
        }
      }
      
      const duration = Date.now() - startTime;
      
      // Summary
      console.log('\n================================================');
      console.log('📊 Connection Status Update Complete');
      console.log('================================================');
      console.log(`✅ Sites processed: ${totalSitesProcessed}/${sites.length}`);
      console.log(`🟢 Customers online: ${totalCustomersOnline}`);
      console.log(`📝 Customers updated: ${totalCustomersUpdated}`);
      console.log(`❌ Errors: ${totalErrors}`);
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log('================================================\n');
      
    } catch (error) {
      console.error('\n❌ Fatal error in Connection Status Cron:');
      console.error(error);
    }
  }
  
  /**
   * Mark customers as offline if they're not in active sessions
   * @param {Object} site - Site document
   * @param {Array} activeUsernames - List of currently active PPPoE usernames
   */
  static async markOfflineCustomers(site, activeUsernames) {
    try {
      // Find customers from this site who should be online but aren't in sessions
      const shouldBeOnlineCustomers = await Customer.find({
        siteId: site._id,
        'connectionStatus.status': 'online',
        'pppoe.username': { $nin: activeUsernames }
      });
      
      if (shouldBeOnlineCustomers.length === 0) {
        return;
      }
      
      console.log(`   🔴 Marking ${shouldBeOnlineCustomers.length} customers as OFFLINE`);
      
      for (const customer of shouldBeOnlineCustomers) {
        if (!customer.connectionStatus) {
          customer.connectionStatus = {};
        }
        
        customer.connectionStatus.status = 'offline';
        customer.connectionStatus.lastOffline = new Date();
        customer.connectionStatus.lastChecked = new Date();
        customer.connectionStatus.currentIp = null;
        
        await customer.save({ validateBeforeSave: false });
        
        console.log(`   🔴 ${customer.accountId} went OFFLINE`);
      }
      
    } catch (error) {
      console.error(`   ⚠️  Error marking offline customers:`, error.message);
    }
  }
  
  /**
   * Stop the cron job (for testing/shutdown)
   */
  static stop() {
    console.log('🛑 Stopping Connection Status Cron Job...');
    // Cron tasks are stopped automatically when process exits
  }
}

module.exports = ConnectionStatusCron;


/**
 * USAGE IN server.js or app.js:
 * 
 * const ConnectionStatusCron = require('./cron/connectionStatusCron');
 * 
 * // Start cron job
 * ConnectionStatusCron.start('*\/10 * * * *'); // Every 10 minutes
 * 
 * // Or use different schedules:
 * // ConnectionStatusCron.start('*\/5 * * * *');  // Every 5 minutes
 * // ConnectionStatusCron.start('*\/15 * * * *'); // Every 15 minutes
 * // ConnectionStatusCron.start('0 * * * *');     // Every hour
 */