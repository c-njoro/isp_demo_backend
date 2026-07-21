const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const RadiusSyncJob = require('../models/RadiusSyncJobSchema');
const SystemLog = require('../models/SystemLog');
const radiusService = require('./radiusService');

async function processSyncJobInBackground(jobId, query, options) {
  const { dryRun, fixGroups } = options;

  console.log(`[JOB ${jobId}] Starting sync with query:`, JSON.stringify(query));
  console.log(`[JOB ${jobId}] dryRun=${dryRun}, fixGroups=${fixGroups}`);

  try {
    await RadiusSyncJob.findByIdAndUpdate(jobId, { status: 'processing', startedAt: new Date() });

    const batchSize = 100;
    
    // Count total customers matching query FIRST
    const totalCount = await Customer.countDocuments(query);
    console.log(`[JOB ${jobId}] Total customers matching query: ${totalCount}`);
    
    if (totalCount === 0) {
      console.log(`[JOB ${jobId}] No customers found. Aborting.`);
      await RadiusSyncJob.findByIdAndUpdate(jobId, {
        status: 'completed',
        processed: 0,
        created: 0,
        updatedGroup: 0,
        disabled: 0,
        errors: [{ error: 'No customers found matching query' }],
        finishedAt: new Date()
      });
      return;
    }

    const cursor = Customer.find(query)
      .populate('subscription.packageId')
      .populate('siteId')
      .cursor();

    let processed = 0;
    let created = 0;
    let updatedGroup = 0;
    let disabled = 0;
    const errors = [];
    const details = [];

    let batch = [];
    let customerCount = 0;
    
    for await (const customer of cursor) {
      customerCount++;
      console.log(`[JOB ${jobId}] Processing customer #${customerCount}: ${customer.accountId}`);
      batch.push(customer);
      
      if (batch.length >= batchSize) {
        console.log(`[JOB ${jobId}] Processing batch of ${batch.length} customers...`);
        const results = await processBatch(batch, dryRun, fixGroups);
        created += results.created;
        updatedGroup += results.updatedGroup;
        disabled += results.disabled;
        errors.push(...results.errors);
        details.push(...results.details);
        processed += batch.length;
        
        console.log(`[JOB ${jobId}] Batch complete: created=${results.created}, updated=${results.updatedGroup}, disabled=${results.disabled}, errors=${results.errors.length}`);
        await RadiusSyncJob.findByIdAndUpdate(jobId, { processed, created, updatedGroup, disabled, errors, details });
        batch = [];
      }
    }
    
    if (batch.length) {
      console.log(`[JOB ${jobId}] Processing final batch of ${batch.length} customers...`);
      const results = await processBatch(batch, dryRun, fixGroups);
      created += results.created;
      updatedGroup += results.updatedGroup;
      disabled += results.disabled;
      errors.push(...results.errors);
      details.push(...results.details);
      processed += batch.length;
      console.log(`[JOB ${jobId}] Final batch complete: created=${results.created}, updated=${results.updatedGroup}, disabled=${results.disabled}`);
    }

    console.log(`[JOB ${jobId}] FINAL TOTALS: processed=${processed}, created=${created}, updatedGroup=${updatedGroup}, disabled=${disabled}, errors=${errors.length}`);

    await RadiusSyncJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      processed,
      created,
      updatedGroup,
      disabled,
      errors,
      details: details.slice(0, 1000),
      finishedAt: new Date()
    });

    await SystemLog.create({
      eventType: 'radius_sync_bulk',
      severity: 'info',
      regionCode: query.regionCode || 'all',
      entityType: 'system',
      message: `RADIUS bulk sync completed: ${processed} processed, ${created} created, ${updatedGroup} updated`,
      details: { jobId, ...options },
      triggeredBy: options.triggeredBy,
      success: true
    });

  } catch (error) {
    console.error(`[JOB ${jobId}] FAILED:`, error);
    await RadiusSyncJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      finishedAt: new Date(),
      errors: [{ error: error.message }]
    });
  }
}

async function processBatch(customers, dryRun, fixGroups) {
  let created = 0;
  let updatedGroup = 0;
  let disabled = 0;
  const errors = [];
  const details = [];

  console.log(`[BATCH] Processing ${customers.length} customers, dryRun=${dryRun}, fixGroups=${fixGroups}`);

  for (const customer of customers) {
    console.log(`[BATCH] Starting customer: ${customer.accountId}`);
    try {
      const username = customer.pppoe?.username;
      if (!username) {
        console.log(`[BATCH] ${customer.accountId}: No PPPoE username, skipping`);
        errors.push({ accountId: customer.accountId, error: 'No PPPoE username' });
        details.push({ accountId: customer.accountId, action: 'skipped', reason: 'no username' });
        continue;
      }

      const packageDoc = customer.subscription?.packageId;
      const isActive = customer.subscription?.status === 'active' &&
                       new Date(customer.subscription.expiresAt) > new Date();
      let desiredGroup = null;
      let desiredEnabled = false;

      if (isActive && packageDoc) {
        desiredGroup = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
        desiredEnabled = true;
        console.log(`[BATCH] ${customer.accountId}: ACTIVE, desiredGroup=${desiredGroup}, desiredEnabled=true`);
      } else {
        desiredGroup = 'DISABLED';
        desiredEnabled = false;
        console.log(`[BATCH] ${customer.accountId}: NOT ACTIVE (status=${customer.subscription?.status}, expires=${customer.subscription?.expiresAt}), desiredGroup=DISABLED`);
      }

      let radiusUserExists = false;
      let currentGroup = null;
      let conn;
      try {
        const radiusService = require('../services/radiusService');
        conn = await radiusService.getConnection();
        console.log(`[BATCH] ${customer.accountId}: Connected to RADIUS DB`);

        const [userCheck] = await conn.query(
          'SELECT 1 FROM radcheck WHERE username = ? AND attribute = "Cleartext-Password" LIMIT 1',
          [username]
        );
        radiusUserExists = userCheck.length > 0;
        console.log(`[BATCH] ${customer.accountId}: radiusUserExists = ${radiusUserExists}`);

        if (radiusUserExists) {
          const [groupRows] = await conn.query(
            'SELECT groupname FROM radusergroup WHERE username = ? ORDER BY priority LIMIT 1',
            [username]
          );
          currentGroup = groupRows[0]?.groupname || null;
          console.log(`[BATCH] ${customer.accountId}: currentGroup = ${currentGroup}`);
        }
      } finally {
        if (conn) conn.release();
      }

      // CASE: User does NOT exist in RADIUS
      if (!radiusUserExists) {
        console.log(`[BATCH] ${customer.accountId}: User does NOT exist in RADIUS.`);
        if (!dryRun) {
          console.log(`[BATCH] ${customer.accountId}: Creating RADIUS account...`);
          const createResult = await radiusService.createAccount(customer, packageDoc);
          console.log(`[BATCH] ${customer.accountId}: createAccount result =`, createResult);
          if (!createResult.success) {
            console.log(`[BATCH] ${customer.accountId}: CREATE FAILED: ${createResult.error}`);
            errors.push({ accountId: customer.accountId, error: `Create failed: ${createResult.error}` });
            details.push({ accountId: customer.accountId, action: 'create failed', error: createResult.error });
            continue;
          }
          if (!desiredEnabled) {
            console.log(`[BATCH] ${customer.accountId}: desiredEnabled=false, disabling account`);
            await radiusService.disableAccount(username);
            disabled++;
          }
          created++;
          details.push({ accountId: customer.accountId, action: 'created', group: desiredGroup });
          console.log(`[BATCH] ${customer.accountId}: CREATED successfully`);
        } else {
          console.log(`[BATCH] ${customer.accountId}: DRY RUN - would create account`);
          details.push({ accountId: customer.accountId, action: 'would create', group: desiredGroup });
        }
        continue;
      }

      // CASE: User exists, check group mismatch
      console.log(`[BATCH] ${customer.accountId}: User exists. fixGroups=${fixGroups}, currentGroup=${currentGroup}, desiredGroup=${desiredGroup}`);
      if (fixGroups && currentGroup !== desiredGroup) {
        console.log(`[BATCH] ${customer.accountId}: Group mismatch detected`);
        if (!dryRun) {
          if (desiredEnabled) {
            console.log(`[BATCH] ${customer.accountId}: Enabling account with group ${desiredGroup}`);
            await radiusService.enableAccount(username, desiredGroup);
          } else {
            console.log(`[BATCH] ${customer.accountId}: Disabling account`);
            await radiusService.disableAccount(username);
            disabled++;
          }
          updatedGroup++;
          details.push({ accountId: customer.accountId, action: 'group updated', from: currentGroup, to: desiredGroup });
          console.log(`[BATCH] ${customer.accountId}: Group updated`);
        } else {
          details.push({ accountId: customer.accountId, action: 'would update group', from: currentGroup, to: desiredGroup });
        }
        continue;
      }

      // CASE: FUP handling (optional, but log)
      if (desiredEnabled && packageDoc && packageDoc.fup?.enabled) {
        const quotaBytes = packageDoc.fup.dataThresholdGB * 1024 * 1024 * 1024;
        if (!dryRun) {
          console.log(`[BATCH] ${customer.accountId}: Enabling FUP with quota ${quotaBytes} bytes`);
          await radiusService.enableFUPForCustomer(username, quotaBytes);
        }
      } else if (desiredEnabled && packageDoc && !packageDoc.fup?.enabled) {
        if (!dryRun) {
          console.log(`[BATCH] ${customer.accountId}: Disabling FUP`);
          await radiusService.disableFUPForCustomer(username);
        }
      }

      // Already synced
      details.push({ accountId: customer.accountId, action: 'already synced', group: currentGroup });
      console.log(`[BATCH] ${customer.accountId}: Already synced, no changes needed`);

    } catch (err) {
      console.error(`[BATCH] ERROR for ${customer.accountId}:`, err);
      errors.push({ accountId: customer.accountId, error: err.message });
      details.push({ accountId: customer.accountId, action: 'error', error: err.message });
    }
  }

  console.log(`[BATCH] Batch summary: created=${created}, updatedGroup=${updatedGroup}, disabled=${disabled}, errors=${errors.length}`);
  return { created, updatedGroup, disabled, errors, details };
}

module.exports = { processSyncJobInBackground };