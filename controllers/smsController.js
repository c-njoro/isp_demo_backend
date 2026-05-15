const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const mobileSasaService = require('../services/mobileSasaService');
const SmsLog = require('../models/SmsLog');
const SmsTemplate = require('../models/SmsTemplate');
const Customer = require('../models/Customer');
const { formatPhoneNumber } = require('../utils/phoneHelpers');

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

  // Must provide either a direct message or a template ID
  if (!message && !templateId) {
    return next(new ErrorResponse('Either a message or a template ID is required', 400));
  }

  // Build the query from filters
  const query = buildCustomerQuery(filters);
  const customers = await Customer.find(query).select('phoneNumber accountId firstName lastName subscription.status');

  if (customers.length === 0) {
    return next(new ErrorResponse('No customers found matching the given filters', 404));
  }

  // If a template is provided, fetch and validate it
  let template = null;
  let templateBody = null;
  if (templateId) {
    template = await SmsTemplate.findById(templateId);
    if (!template) {
      return next(new ErrorResponse('Template not found', 404));
    }
    if (!template.isActive) {
      return next(new ErrorResponse('Template is inactive', 400));
    }
    templateBody = template.body;
  }

  const results = {
    total: customers.length,
    successful: 0,
    failed: 0,
    errors: [],
  };

  // Send to each customer
  for (const customer of customers) {
    let finalMessage = message;
    // If using template, replace placeholders with customer data
    if (templateBody) {
      const placeholderData = {
        customerName: `${customer.firstName} ${customer.lastName}`,
        // Add more placeholders as needed (e.g., accountId, status, etc.)
        accountId: customer.accountId,
        status: customer.subscription?.status || '',
      };
      finalMessage = replacePlaceholders(templateBody, placeholderData);
    }

    // Ensure message is not empty after replacement
    if (!finalMessage || finalMessage.trim() === '') {
      results.failed++;
      results.errors.push({
        accountId: customer.accountId,
        error: 'Message became empty after placeholder replacement',
      });
      continue;
    }

    try {
      const sendResult = await mobileSasaService.sendSingle(customer.phoneNumber, finalMessage);
      // Log success
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
      // Log failure
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
        error: err.message,
      });
    }
  }

  res.status(200).json({
    success: true,
    message: `Bulk SMS completed: ${results.successful} sent, ${results.failed} failed`,
    data: {
      total: results.total,
      successful: results.successful,
      failed: results.failed,
      errors: results.errors.slice(0, 20), // limit error list
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
    console.log("Req.body: ", req.body)
    console.log("Filters: ", filters)
    const query = buildCustomerQuery(filters);
    console.log("Query: ", query)
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

function buildCustomerQuery(filters) {
  const query = {};
  if (filters.subscriptionStatus && filters.subscriptionStatus !== '') {
    query['subscription.status'] = filters.subscriptionStatus;
  }
  if (Array.isArray(filters.siteId) && filters.siteId.length > 0) {
    query.siteId = { $in: filters.siteId };
  }
  if (Array.isArray(filters.subscriptionPackageId) && filters.subscriptionPackageId.length > 0) {
    query['subscription.packageId'] = { $in: filters.subscriptionPackageId };
  }
  return query;
}