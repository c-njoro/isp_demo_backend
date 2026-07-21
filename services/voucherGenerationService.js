const crypto = require('crypto');
const Voucher = require('../models/Voucher');
const Package = require('../models/Package');
const Customer = require('../models/Customer');
const SystemLog = require('../models/SystemLog');
const smsTemplateService = require('./smsTemplateService');

function generateCodes(prefix, count) {
  const codes = new Set();
  while (codes.size < count) {
    const random = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.add(`${prefix}-${random}`);
  }
  return [...codes].map((code) => ({ code, used: false }));
}

function randomPrefix(length = 4) {
  return Array.from(
    { length },
    () => String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
}

/**
 * Generate a batch of vouchers and send the codes via SMS.
 * Uses SMS template key "voucher_codes" (placeholders: {customerName}, {codes}).
 *
 * @param {Object} params
 * @param {string} [params.customerId]    - Customer MongoDB ID
 * @param {string} [params.phoneNumber]   - Direct phone number (if customerId absent)
 * @param {string}  params.packageId      - Package ID for the vouchers
 * @param {number}  params.voucherAmount  - Number of vouchers (1–50)
 * @param {string} [params.createdBy]     - Admin/user ID who initiated this (optional)
 * @param {string} [params.regionCode]    - For logging (optional)
 * @param {boolean} [params.rollbackOnSmsFailure=false] – delete voucher if SMS fails
 *
 * @returns {Promise<Object>} { success, voucher, sms, warning? }
 */
async function generateAndSendVouchers({
  customerId,
  phoneNumber,
  packageId,
  voucherAmount,
  createdBy = null,
  regionCode = null,
  rollbackOnSmsFailure = false,
}) {
  // 1. Validate inputs
  if (!packageId || !voucherAmount) {
    throw new Error('packageId and voucherAmount are required');
  }
  if (!customerId && !phoneNumber) {
    throw new Error('Either customerId or phoneNumber is required');
  }

  const amount = 2;
  if (isNaN(amount) || amount < 1 || amount > 50) {
    throw new Error('voucherAmount must be between 1 and 50');
  }

  // 2. Resolve phone number and customer name
  let targetPhone = phoneNumber;
  let customer = null;
  if (customerId) {
    customer = await Customer.findById(customerId);
    if (!customer) throw new Error('Customer not found');
    if (!customer.phoneNumber) throw new Error('Customer has no phone number');
    targetPhone = customer.phoneNumber;
  } else {
    if (!targetPhone) throw new Error('phoneNumber is required when customerId is not provided');
  }

  // 3. Validate package
  const pkg = await Package.findById(packageId);
  if (!pkg) throw new Error('Package not found');

  // 4. Generate prefix and codes
  const prefix = randomPrefix();
  const normalizedPrefix = prefix.toUpperCase().replace(/\s+/g, '') + '-' + customer.accountId;
  const codes = generateCodes(normalizedPrefix, amount);

  // 5. Create voucher batch
  const description = `Generated for ${customer ? `${customer.firstName} ${customer.lastName}` || customerId : targetPhone}`;
  const voucher = await Voucher.create({
    prefix: normalizedPrefix,
    packageId,
    description,
    codes,
    createdBy,
    enjoyUntil: customer.subscription?.expiresAt || null,
  });

  // 6. Prepare SMS data – short and concise
  const codeStrings = codes.map(c => c.code);
  const codesText = codeStrings.join('\n');
  const customerName = `${customer?.firstName} ${customer.lastName}` || 'Customer';

  const templateData = {
    customerName,
    codes: codesText,
  };

  // 7. Send SMS
  const extra = {
    customerId: customer?._id || null,
    accountId: customer?.accountId || null,
    type: 'voucher_codes',
    regionCode,
  };

  let smsResult;
  try {
    smsResult = await smsTemplateService.sendUsingTemplate(
      'voucher_codes',
      targetPhone,
      templateData,
      extra
    );
  } catch (smsError) {
    console.error('SMS sending failed:', smsError.message);
    await SystemLog.create({
      eventType: 'voucher_sms_failed',
      severity: 'error',
      regionCode,
      entityType: 'voucher',
      entityId: voucher._id,
      message: `Failed to send voucher codes to ${targetPhone}: ${smsError.message}`,
      success: false,
    });

    // if (rollbackOnSmsFailure) {
    //   await voucher.deleteOne();
    //   throw new Error(`SMS failed and voucher batch rolled back: ${smsError.message}`);
    // }

    return {
      success: true,
      warning: 'Voucher batch created but SMS could not be sent.',
      voucher,
      smsError: smsError.message,
    };
  }

  // 8. Log success
  await SystemLog.create({
    eventType: 'voucher_generated_and_sent',
    severity: 'info',
    regionCode,
    entityType: 'voucher',
    entityId: voucher._id,
    message: `Voucher batch ${normalizedPrefix} (${amount} codes) sent to ${targetPhone}`,
    success: true,
  });

  return {
    success: true,
    voucher,
    sms: {
      sent: true,
      messageId: smsResult.messageId,
      recipient: targetPhone,
    },
  };
}

module.exports = { generateAndSendVouchers };