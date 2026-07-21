const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const mobileSasaService = require('../services/mobileSasaService');
const SmsLog = require('../models/SmsLog');
const SmsTemplate = require('../models/SmsTemplate');
const Customer = require('../models/Customer');
const { formatPhoneNumber } = require('../utils/phoneHelpers');
const BulkSmsJob = require('../models/BulkSmsJob');
const MAX_SYNC_BATCH = 500;


// Helper to log SMS with recipient details
async function logSms(recipient, message, type, regionCode, providerResponse, status, cost, error = null) {
  const logData = {
    recipient: {
      phoneNumber: recipient.phoneNumber,
      customerId: recipient.customerId || null,
      accountId: recipient.accountId || null
    },
    message,
    type,
    regionCode,
    provider: 'mobile_sasa',
    messageId: providerResponse?.messageId || providerResponse?.bulkId || null,
    status,
    cost: cost || null,
    sentAt: status === 'sent' ? new Date() : null,
    error: error ? { code: error.code, message: error.message } : null
  };
  await SmsLog.create(logData);
}

function replacePlaceholders(text, data) {
  let result = text;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, value !== undefined ? value : `{${key}}`);
  }
  return result;
}

// Send single SMS (no senderId in body)
exports.sendSingleSms = asyncHandler(async (req, res, next) => {
  const { phone, message, type = 'general' } = req.body;
  if (!phone || !message) {
    return next(new ErrorResponse('Phone and message are required', 400));
  }

  const formattedPhone = formatPhoneNumber(phone);
  const customer = await Customer.findOne({ phoneNumber: formattedPhone }).select('accountId');
  
  try {
    const result = await mobileSasaService.sendSingle(formattedPhone, message);
    await logSms(
      { phoneNumber: formattedPhone, customerId: customer?._id, accountId: customer?.accountId },
      message,
      type,
      req.regionFilter?.regionCode || null,
      result.response,
      'sent',
      result.cost
    );
    res.status(200).json({
      success: true,
      message: 'SMS sent successfully',
      data: { messageId: result.messageId }
    });
  } catch (error) {
    await logSms(
      { phoneNumber: formattedPhone, customerId: customer?._id, accountId: customer?.accountId },
      message,
      type,
      req.regionFilter?.regionCode || null,
      null,
      'failed',
      null,
      { code: 'api_error', message: error.message }
    );
    return next(new ErrorResponse(error.message, 500));
  }
});

// Bulk SMS by filters (instead of providing phones array)
exports.sendBulkByFilter = asyncHandler(async (req, res, next) => {
  const { filters, message, templateId, type = 'bulk' } = req.body;

  // Validate message or template
  if (!message && !templateId) {
    return next(new ErrorResponse('Either a message or a template ID is required', 400));
  }

  // Build the query using the region filter
  const query = buildCustomerQuery(filters, req.regionFilter || {});

  // Count matching customers
  const total = await Customer.countDocuments(query);
  if (total === 0) {
    return next(new ErrorResponse('No customers found matching the given filters', 404));
  }

  // If total exceeds threshold, create a background job
  if (total > MAX_SYNC_BATCH) {
    const job = await BulkSmsJob.create({
      status: 'pending',
      total,
      filters,
      message,
      templateId,
      type,
      regionCode: req.regionFilter?.regionCode || null,
      triggeredBy: req.user?._id || req.session?.userId || null,
    });

    // Start background processing (non-blocking)
    processBulkSmsJobInBackground(job._id, query, { message, templateId, type }, req);

    return res.status(202).json({
      success: true,
      message: `Bulk SMS job started. ${total} recipients will be processed in the background.`,
      data: { jobId: job._id, total },
    });
  }

  // Small batch – process synchronously
  const results = await processBulkSmsSynchronously(query, { message, templateId, type }, req);

  res.status(200).json({
    success: true,
    message: `Bulk SMS completed: ${results.successful} sent, ${results.failed} failed`,
    data: {
      total: results.total,
      successful: results.successful,
      failed: results.failed,
      errors: results.errors.slice(0, 20),
    },
  });
});

// Personalized bulk by filters (each customer gets a customized message)
exports.sendPersonalizedByFilter = asyncHandler(async (req, res, next) => {
  const { filters, messageTemplate, type = 'personalized' } = req.body;
  if (!filters || !messageTemplate) {
    return next(new ErrorResponse('Filters and message template are required', 400));
  }

  const customers = await Customer.find(filters).select('phoneNumber accountId firstName');
  if (customers.length === 0) {
    return next(new ErrorResponse('No customers found matching filters', 404));
  }

  const messages = customers.map(cust => ({
    phone: cust.phoneNumber,
    message: messageTemplate.replace('{name}', `${cust.firstName}`) // example personalization
  }));

  try {
    const result = await mobileSasaService.sendPersonalized(messages);
    for (let i = 0; i < customers.length; i++) {
      await logSms(
        { phoneNumber: customers[i].phoneNumber, customerId: customers[i]._id, accountId: customers[i].accountId },
        messages[i].message,
        type,
        req.regionFilter?.regionCode || null,
        result.response,
        'sent',
        null
      );
    }
    res.status(200).json({
      success: true,
      message: `Personalized SMS sent to ${customers.length} customers`,
      data: { bulkId: result.bulkId, count: customers.length }
    });
  } catch (error) {
    return next(new ErrorResponse(error.message, 500));
  }
});

// Balance
exports.getSmsBalance = asyncHandler(async (req, res, next) => {
  try {
    const balance = await mobileSasaService.getBalance();
    res.status(200).json({ success: true, data: balance });
  } catch (error) {
    return next(new ErrorResponse(error.message, 500));
  }
});

// Delivery status (fixed)
exports.getDeliveryStatus = asyncHandler(async (req, res, next) => {
  const { messageId } = req.params;
  if (!messageId) return next(new ErrorResponse('Message ID is required', 400));
  try {
    const status = await mobileSasaService.checkDeliveryStatus(messageId);
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    return next(new ErrorResponse(error.message, 500));
  }
});

// Get SMS logs (admin)
exports.getSmsLogs = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, type, status, phoneNumber, startDate, endDate } = req.query;
  const query = {};
  if (type) query.type = type;
  if (status) query.status = status;
  if (phoneNumber) query['recipient.phoneNumber'] = phoneNumber;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }
  const logs = await SmsLog.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));
  const total = await SmsLog.countDocuments(query);
  res.status(200).json({
    success: true,
    data: { logs, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } }
  });
});

// Test filter to get customer count (before sending bulk)
exports.testFilter = asyncHandler(async (req, res, next) => {
  const { filters } = req.body;
  const query = buildCustomerQuery(filters, req.regionFilter || {});
  const count = await Customer.countDocuments(query);
  res.json({ success: true, data: { count } });
});

// Helper to build customer query from filters
// function buildCustomerQuery(filters) {
//   const query = {};
//   if (filters['subscription.status']) {
//     query['subscription.status'] = filters['subscription.status'];
//   }
//   if (filters.siteId && Array.isArray(filters.siteId) && filters.siteId.length) {
//     query.siteId = { $in: filters.siteId };
//   } else if (filters.siteId && typeof filters.siteId === 'string') {
//     query.siteId = filters.siteId;
//   }
//   if (filters['subscription.packageId'] && Array.isArray(filters['subscription.packageId']) && filters['subscription.packageId'].length) {
//     query['subscription.packageId'] = { $in: filters['subscription.packageId'] };
//   } else if (filters['subscription.packageId'] && typeof filters['subscription.packageId'] === 'string') {
//     query['subscription.packageId'] = filters['subscription.packageId'];
//   }
//   // regionCode removed
//   return query;
// }

// Replace the buildCustomerQuery function with this:

function buildCustomerQuery(filters, regionFilter = {}) {
  const query = { ...regionFilter };

  // Search across city, subLocation, localArea
  if (filters.search && filters.search.trim()) {
    const search = filters.search.trim();
    query.$or = [
      { city: { $regex: search, $options: 'i' } },
      { subLocation: { $regex: search, $options: 'i' } },
      { localArea: { $regex: search, $options: 'i' } },
    ];
  }

  // Subscription status
  if (filters.subscriptionStatus && filters.subscriptionStatus !== '') {
    query['subscription.status'] = filters.subscriptionStatus;
  }

  // Sites (multi-select)
  if (filters.siteId && Array.isArray(filters.siteId) && filters.siteId.length > 0) {
    query.siteId = { $in: filters.siteId };
  } else if (filters.siteId && typeof filters.siteId === 'string') {
    query.siteId = filters.siteId;
  }

  // Packages (multi-select)
  if (filters.subscriptionPackageId && Array.isArray(filters.subscriptionPackageId) && filters.subscriptionPackageId.length > 0) {
    query['subscription.packageId'] = { $in: filters.subscriptionPackageId };
  } else if (filters.subscriptionPackageId && typeof filters.subscriptionPackageId === 'string') {
    query['subscription.packageId'] = filters.subscriptionPackageId;
  }

  // Router (NAS IP) – exact match on pppoe.siteIp
 // Router (NAS IP) – multiple values
if (filters.nasIp && Array.isArray(filters.nasIp) && filters.nasIp.length > 0) {
  query.nasIp = { $in: filters.nasIp };
} else if (filters.nasIp && typeof filters.nasIp === 'string') {
  query.nasIp = filters.nasIp;
}

  // Child accounts are included by default – no filter to exclude them.

  return query;
}





/**
 * Process bulk SMS synchronously for a given customer query.
 * Returns { total, successful, failed, errors }
 */
async function processBulkSmsSynchronously(query, options, req) {
  const { message, templateId, type } = options;
  const customers = await Customer.find(query).select('phoneNumber accountId firstName lastName subscription.status');
  const results = {
    total: customers.length,
    successful: 0,
    failed: 0,
    errors: [],
  };

  let template = null;
  let templateBody = null;
  if (templateId) {
    template = await SmsTemplate.findById(templateId);
    if (!template || !template.isActive) {
      throw new Error('Template not found or inactive');
    }
    templateBody = template.body;
  }

  for (const customer of customers) {
    let finalMessage = message;
    if (templateBody) {
      const placeholderData = {
        customerName: `${customer.firstName} ${customer.lastName}`,
        accountId: customer.accountId,
        status: customer.subscription?.status || '',
      };
      finalMessage = replacePlaceholders(templateBody, placeholderData);
    }

    if (!finalMessage || finalMessage.trim() === '') {
      results.failed++;
      results.errors.push({
        accountId: customer.accountId,
        phoneNumber: customer.phoneNumber,
        error: 'Message became empty after placeholder replacement',
      });
      continue;
    }

    try {
      const sendResult = await mobileSasaService.sendSingle(customer.phoneNumber, finalMessage);
      await logSms(
        {
          phoneNumber: customer.phoneNumber,
          customerId: customer._id,
          accountId: customer.accountId,
        },
        finalMessage,
        type,
        req.regionFilter?.regionCode || null,
        sendResult.response,
        'sent',
        sendResult.cost
      );
      results.successful++;
    } catch (err) {
      await logSms(
        {
          phoneNumber: customer.phoneNumber,
          customerId: customer._id,
          accountId: customer.accountId,
        },
        finalMessage,
        type,
        req.regionFilter?.regionCode || null,
        null,
        'failed',
        null,
        { code: 'api_error', message: err.message }
      );
      results.failed++;
      results.errors.push({
        accountId: customer.accountId,
        phoneNumber: customer.phoneNumber,
        error: err.message,
      });
    }
  }
  return results;
}



/**
 * Process a bulk SMS job in the background.
 * Updates the job document with progress and final status.
 */
async function processBulkSmsJobInBackground(jobId, query, options, req) {
  const job = await BulkSmsJob.findById(jobId);
  if (!job) return;

  try {
    job.status = 'processing';
    job.startedAt = new Date();
    await job.save();

    const batchSize = 100;
    let skip = 0;
    const results = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    // We need a minimal req object for logging (regionCode + user)
    const logReq = {
      regionFilter: job.regionCode ? { regionCode: job.regionCode } : null,
      user: { _id: job.triggeredBy },
    };

    while (true) {
      const customers = await Customer.find(query)
        .select('phoneNumber accountId firstName lastName subscription.status')
        .skip(skip)
        .limit(batchSize)
        .lean();

      if (customers.length === 0) break;

      // Process this batch synchronously (reuse the helper)
      const batchResults = await processBulkSmsSynchronously(
        { _id: { $in: customers.map(c => c._id) } },
        options,
        logReq
      );

      results.successful += batchResults.successful;
      results.failed += batchResults.failed;
      results.errors.push(...batchResults.errors);

      job.processed += customers.length;
      job.succeeded = results.successful;
      job.failed = results.failed;
      // Keep only the first 100 errors to avoid document size blow-up
      job.errors = results.errors.slice(0, 100);
      await job.save();

      skip += batchSize;
    }

    job.status = 'completed';
    job.finishedAt = new Date();
    await job.save();
  } catch (error) {
    job.status = 'failed';
    job.finishedAt = new Date();
    job.errors.push({ error: error.message });
    await job.save();
  }
}


// Get bulk SMS job status
exports.getBulkSmsJobStatus = asyncHandler(async (req, res, next) => {
  const { jobId } = req.params;
  const job = await BulkSmsJob.findById(jobId);
  if (!job) {
    return next(new ErrorResponse('Job not found', 404));
  }
  res.status(200).json({
    success: true,
    data: {
      status: job.status,
      total: job.total,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      errors: job.errors.slice(0, 50),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    },
  });
});