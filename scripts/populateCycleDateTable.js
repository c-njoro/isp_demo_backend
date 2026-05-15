const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Customer = require('../models/Customer');
const radiusService = require('../services/radiusService');

async function run() {
  try {
    // Connect to MongoDB
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI not defined in .env file');
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Ensure RADIUS connection works
    const testConn = await radiusService.getConnection();
    console.log('✅ RADIUS database connected');
    testConn.release();

    // Get all customers with PPPoE username (ignore those without)
    const customers = await Customer.find({
      'pppoe.username': { $exists: true, $ne: null }
    }).select('pppoe.username billingCycle.startDate subscription.activatedAt createdAt');

    console.log(`📊 Found ${customers.length} customers with PPPoE credentials`);

    let inserted = 0;
    let updated = 0;
    let errors = 0;

    for (const customer of customers) {
      try {
        const username = customer.pppoe.username;
        // Determine cycle start date
        let cycleStartDate = customer.billingCycle?.startDate ||
                             customer.subscription?.activatedAt ||
                             customer.createdAt;
        if (!cycleStartDate) {
          console.warn(`⚠️ No valid date for ${username}, skipping`);
          errors++;
          continue;
        }
        // Ensure it's a Date object and format as YYYY-MM-DD
        const date = new Date(cycleStartDate);
        if (isNaN(date.getTime())) {
          console.warn(`⚠️ Invalid date for ${username}: ${cycleStartDate}, skipping`);
          errors++;
          continue;
        }
        const formattedDate = date.toISOString().slice(0, 10);

        // Insert/update in RADIUS table
        const conn = await radiusService.getConnection();
        await conn.query(
          `INSERT INTO user_billing_cycle (username, cycle_start) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE cycle_start = VALUES(cycle_start)`,
          [username, formattedDate]
        );
        conn.release();

        if (customer.billingCycle?.startDate) {
          updated++;
        } else {
          inserted++;
        }

        if ((inserted + updated) % 100 === 0) {
          console.log(`   Processed ${inserted + updated} customers...`);
        }
      } catch (err) {
        console.error(`❌ Error for customer ${customer._id}:`, err.message);
        errors++;
      }
    }

    console.log('\n🎉 Population completed!');
    console.log(`   Inserted (new entries): ${inserted}`);
    console.log(`   Updated (existing entries): ${updated}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Total processed: ${inserted + updated + errors}`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  }
}

run();