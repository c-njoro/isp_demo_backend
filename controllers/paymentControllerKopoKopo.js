const asyncHandler = require("../middleware/asyncHandler");
const { ErrorResponse } = require("../middleware/errorHandler");
const Payment = require("../models/Payment");
const Transaction = require("../models/Transaction");
const Customer = require("../models/Customer");
const HotspotUser = require("../models/HotspotUser");
const Package = require("../models/Package");
const Site = require("../models/Site");
const Router = require("../models/Router");
const Invoice = require("../models/Invoice");
const UnprocessedPayment = require("../models/UnprocessedPayment");
const SmsLog = require("../models/SmsLog");
const SystemLog = require("../models/SystemLog");
const kopokopoService = require("../services/kopokopoService");
const { calculatePeriodEnd } = require("../utils/invoiceHelpers");
const { formatPhoneNumber } = require("../utils/phoneHelpers");

async function logSms(
  recipient,
  message,
  type,
  regionCode,
  providerResponse,
  status,
  cost,
  error = null,
) {
  const logData = {
    recipient: {
      phoneNumber: recipient.phoneNumber,
      customerId: recipient.customerId || null,
      accountId: recipient.accountId || null,
    },
    message,
    type,
    regionCode,
    provider: "mobile_sasa",
    messageId: providerResponse?.messageId || providerResponse?.bulkId || null,
    status,
    cost: cost || null,
    sentAt: status === "sent" ? new Date() : null,
    error: error ? { code: error.code, message: error.message } : null,
  };
  await SmsLog.create(logData);
}

/**
 * Parse Kopo Kopo date to JavaScript Date
 */
function parseKopoKopoDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr);
  } catch (error) {
    console.error("Date parsing error:", error);
    return null;
  }
}

function normalizePhone(phone) {
  if (!phone) return phone;

  // Convert 07XXXXXXXX → 2547XXXXXXXX
  if (phone.startsWith("07")) {
    return "254" + phone.slice(1);
  }

  // Convert +2547XXXXXXXX → 2547XXXXXXXX
  if (phone.startsWith("+254")) {
    return phone.slice(1);
  }

  return phone;
}

function parseMpesaDate(dateValue) {
  if (!dateValue) return new Date();

  let parsed = new Date(dateValue);
  if (isNaN(parsed.getTime())) {
    // Try to handle common M-Pesa formats (e.g., "2026-04-07T13:11:41+03:00")
    // If still invalid, fallback to now
    console.warn("Invalid M-Pesa date, using current time:", dateValue);
    return new Date();
  }
  return parsed;
}

/**
 * Activate account in Mikrotik and RADIUS
 * @param {Object} customer - Customer document
 * @param {Object} site - Site document
 * @param {Object} packageDoc - Package document
 * @returns {Object} { success, mikrotikResult, radiusResult }
 */
async function activateAccount(customer, packageDoc) {
  console.log("⚙️ [activateAccount] Activating account:", customer.accountId);
  const radiusService = require("../services/radiusService");
  const packageName = packageDoc.packageName.replace(/\s+/g, "_").toUpperCase();
  console.log(`   Group name: ${packageName}`);
  const radiusResult = await radiusService.enableAccount(
    customer.pppoe.username,
    packageName,
  );
  const cycleResult = await radiusService.setBillingCycleStart(
    customer.pppoe.username,
    Date.now(),
  );
  if (!radiusResult.success) {
    console.error("⚠️ RADIUS enable failed:", radiusResult.error);
    throw new Error(`RADIUS enable failed: ${radiusResult.error}`);
  }
  console.log("✅ RADIUS enabled");

  customer.billingCycle = { startDate: Date.now() };
  await customer.save();

  if (customer.fupEnabled && packageDoc.fup?.enabled) {
    const quotaBytes = packageDoc.fup.dataThresholdGB * 1024 * 1024 * 1024;
    await radiusService.enableFUPForCustomer(
      customer.pppoe.username,
      quotaBytes,
    );
  }
  return { success: true, radiusResult };
}

// ============================================
// CUSTOMER LOOKUP
// ============================================

/**
 * @desc    Lookup customer by phone number (for payment portal)
 * @route   POST /api/payments/lookup
 * @access  Public
 */
exports.lookupCustomer = asyncHandler(async (req, res, next) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return next(new ErrorResponse("Phone number is required", 400));
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);

  const customers = await Customer.find({
    phoneNumber: formattedPhone,
    isActive: true,
  })
    .populate("subscription.packageId", "packageName price")
    .populate("siteId", "siteName regionCode")
    .select(
      "accountId firstName lastName phoneNumber subscription siteId regionCode",
    );

  if (customers.length === 0) {
    return res.status(404).json({
      success: false,
      message: "No active account found with this phone number",
      data: null,
    });
  }

  const customerData = customers.map((customer) => ({
    customerId: customer._id,
    packageId: customer.subscription.packageId?._id,
    customerType: "pppoe",
    name: `${customer.firstName} ${customer.lastName}`,
    accountId: customer.accountId,
    packageName: customer.subscription.packageId?.packageName,
    packagePrice: customer.subscription.packageId?.price,
    location: customer.siteId?.siteName,
    status: customer.subscription.status,
    expiresAt: customer.subscription.expiresAt,
    regionCode: customer.regionCode,
    siteId: customer.siteId?._id,
  }));

  res.status(200).json({
    success: true,
    message: "Customer accounts found",
    data: {
      phoneNumber: formattedPhone,
      customers: customerData,
      count: customerData.length,
    },
  });
});


// ============================================
// INITIATE PAYMENT
// ============================================

/**
 * @desc    Initiate payment (STK Push with channel selection)
 * @route   POST /api/payments/initiate
 * @access  Public
 *
 * Supports M-Pesa, Airtel Money, and Card payments
 */
exports.initiatePayment = asyncHandler(async (req, res, next) => {
  const {
    customerId,
    packageId,
    phoneNumber,
    channel = "auto",
    amount: customAmount,
    redirectUrl,
  } = req.body;

  console.log("\n💰 [initiatePayment] Starting payment initiation...");
  console.log(`   Customer ID: ${customerId}`);
  console.log(`   Package ID: ${packageId}`);
  console.log(`   Phone: ${phoneNumber}`);
  console.log(`   Channel: ${channel}`);

  if (!customerId || !packageId || (!phoneNumber && channel !== "card")) {
    return next(new ErrorResponse("Missing required fields", 400));
  }

  const customer = await Customer.findById(customerId)
    .populate("subscription.packageId")
    .populate("siteId");
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  const site = customer.siteId;
const siteConfig = site?.payment?.kopokopo || null;

  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) return next(new ErrorResponse("Package not found", 404));

  const amount = customAmount || packageDoc.price;
  let paymentChannel = channel;
  if (channel === "auto" && phoneNumber) {
    paymentChannel = kopokopoService.detectChannel(phoneNumber);
    console.log(`   📡 Auto-detected channel: ${paymentChannel.toUpperCase()}`);
  }

  const callbackUrl = `${process.env.BASE_URL}/api/payments/kopokopo/webhook`;

  const parameters = {
    phoneNumber,
    amount,
    description: `${packageDoc.packageName} subscription`,
    callbackUrl,
    channel: paymentChannel,
    reference: customer.accountId,
    metadata: {
      customerId: customer._id.toString(),
      packageId: packageDoc._id.toString(),
      customerType: "pppoe",
    },
  };

  try {
    let paymentResult;
    if (paymentChannel === "card") {
      paymentResult = await kopokopoService.initiatePaymentRequest({
        phoneNumber,
        amount,
        description: `${packageDoc.packageName} subscription`,
        callbackUrl,
        channel: paymentChannel,
        reference: customer.accountId,
        metadata: {
          customerId: customer._id.toString(),
          packageId: packageDoc._id.toString(),
          customerType: "pppoe",
        },
        credentials: siteConfig,
        redirectUrl,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
      });
    } else {
      paymentResult = await kopokopoService.initiatePaymentRequest({
        phoneNumber,
        amount,
        description: `${packageDoc.packageName} subscription`,
        callbackUrl,
        channel: paymentChannel,
        reference: customer.accountId,
        metadata: {
          customerId: customer._id.toString(),
          packageId: packageDoc._id.toString(),
          customerType: "pppoe",
        },
        credentials: siteConfig,
        redirectUrl,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
      });
    }

    if (!paymentResult.success) {
      return next(
        new ErrorResponse(
          paymentResult.error || "Payment initiation failed",
          500,
        ),
      );
    }

    console.log("✅ Payment request sent successfully");

    // Create pending payment record with the Kopo Kopo payment request ID
    const payment = await Payment.create({
      customerId: customer._id,
      accountId: customer.accountId,
      customerType: customer.pppoe ? "pppoe" : "hotspot",
      regionCode: customer.regionCode,
      siteId: customer.siteId,
      amount,
      paymentMethod: paymentChannel,
      status: "pending",
      kopokopoPaymentId: paymentResult.paymentRequestId, // ← used to match webhook
      checkoutRequestId: paymentResult.paymentRequestId,
      stkID: paymentResult.paymentRequestId,
      kopokopoLocation: paymentResult.location,
      stkPush: {
        phoneNumber: phoneNumber,
      },
      packageId: packageDoc._id,
      paymentChannel,
      metadata: {
        packageId: packageDoc._id,
        packageName: packageDoc.packageName,
        phoneNumber: phoneNumber || "card",
        initiatedAt: new Date(),
        paymentUrl: paymentResult.paymentUrl,
      },
    });

    await SystemLog.create({
      eventType: "payment_initiated",
      severity: "info",
      regionCode: customer.regionCode,
      entityType: "payment",
      entityId: payment._id,
      accountId: customer.accountId,
      message: `${paymentChannel.toUpperCase()} payment of KES ${amount} initiated for ${customer.accountId}`,
      details: {
        amount,
        channel: paymentChannel,
        paymentId: payment._id,
        kopokopoPaymentId: paymentResult.paymentRequestId,
      },
      success: true,
    });

    res.status(200).json({
      success: true,
      message:
        paymentChannel === "card"
          ? "Card payment initiated. Redirect user to payment URL."
          : `${paymentChannel.toUpperCase()} payment request sent. Please check your phone.`,
      data: {
        paymentId: payment._id,
        amount,
        channel: paymentChannel,
        status: "pending",
        kopokopoPaymentId: paymentResult.paymentRequestId,
        ...(paymentResult.paymentUrl && {
          paymentUrl: paymentResult.paymentUrl,
        }),
      },
    });
  } catch (error) {
    console.error("❌ Payment initiation error:", error);
    return next(new ErrorResponse("Payment initiation failed", 500));
  }
});

// ============================================
// KOPO KOPO WEBHOOK (properly parsing event.resource)
// ============================================

/**
 * @desc    Handle Kopo Kopo webhooks
 * @route   POST /api/payments/kopokopo/webhook
 * @access  Public (but verified)
 */
exports.kopokopoWebhook = asyncHandler(async (req, res, next) => {
  const signature = req.headers["x-kopokopo-signature"];
  if (!signature) {
    console.error("Missing signature header");
  }

  console.log("📡 [KopoKopoWebhook] Received body:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);

  setImmediate(async () => {
    try {
      const payload = req.body;

      // Determine the webhook type
      const isIncomingPayment = payload.data && payload.data.type === "incoming_payment";
      const isBuygoods = payload.topic === "buygoods_transaction_received";

      let paymentRequestId = null;
      let resource = null;
      let senderTill = null;
      let amount = 0;
      let phoneNumber = null;
      let transactionReference = null;
      let transactionDate = Date.now();
      let hashedPhoneNumber = null;

      if (isIncomingPayment) {
        // Incoming payment webhook structure
        paymentRequestId = payload.data.id;
        const attributes = payload.data.attributes || {};
        const event = attributes.event || {};
        resource = event.resource || {};
        amount = parseFloat(resource.amount);
        phoneNumber = resource.sender_phone_number || resource.subscriber?.phone_number;
        hashedPhoneNumber = resource.hashed_sender_phone;
        transactionReference = resource.transaction_reference || resource.reference;
        senderTill = resource.till_number;
      } 
      else if (isBuygoods) {
        // Buygoods transaction webhook
        resource = payload.event?.resource || {};
        amount = parseFloat(resource.amount);
        phoneNumber = resource.sender_phone_number;
        hashedPhoneNumber = resource.hashed_sender_phone;
        transactionReference = resource.reference;
        senderTill = resource.till_number;
        // No paymentRequestId for buygoods
      }
      else {
        console.log("⚠️ Unknown webhook type, ignoring");
        return;
      }

      const alreadyRecievedWebhook = await Payment.findOne({
        mpesaReceiptNumber: transactionReference
      });

      if(alreadyRecievedWebhook){
        console.error("❌ We had already received a webhook about this payment");
        return;
      }


      // Only process successful / received payments
      const status = resource.status;
      if (status !== "Received" && status !== "success" && status !== "Success") {
        console.log(`ℹ️ Payment not successful, status: ${status}`);
        if (paymentRequestId) {
          await Payment.findOneAndUpdate(
            { kopokopoPaymentId: paymentRequestId },
            { status: "failed", errorMessage: `Webhook status: ${status}` }
          );
        }
        return;
      }

      // Try to find pending payment by paymentRequestId (only for incoming_payment)
      let payment = null;
      if (paymentRequestId) {
        payment = await Payment.findOne({
          kopokopoPaymentId: paymentRequestId,
          status: "pending",
        });
      }

      if (payment) {
        console.log(`✅ Found pending payment for request ID: ${paymentRequestId}`);
        if (payment.customerType === 'hotspot') {
          await activateHotspotAfterPayment(payment, {
            receiptNumber: transactionReference,
            transactionDate: new Date(transactionDate),
            phoneNumber: phoneNumber || payment.metadata?.phoneNumber,
          });
        } else {
          const customer = await Customer.findById(payment.customerId);
          if (customer) {
            await processSuccessfulPayment(payment, customer, {
              receiptNumber: transactionReference,
              transactionDate: new Date(transactionDate),
              phoneNumber: phoneNumber || payment.metadata?.phoneNumber,
            });
          }
        }
        return;
      }

      if (!senderTill) {
        console.error("❌ No till number in webhook");
        return;
      }

      const projectedSite = await Site.findOne({
        $or: [
          { "payment.tillNumber": senderTill },
          { "payment.kopokopo.tillNumber": senderTill }
        ]
      });

      if (!projectedSite) {
        console.error(`❌ No site found for till ${senderTill}, we will store this as unprocessed.`);
        await UnprocessedPayment.create({
          receiptNumber: transactionReference,
          phoneNumber: phoneNumber || hashedPhoneNumber,
          amount,
          transactionDate: new Date(transactionDate),
          rawData: payload,
          status: "new",
          tillNumber: senderTill
        });
        return;
      }

      // No pending payment – treat as direct C2B
      if (!hashedPhoneNumber) {
        console.log("ℹ️ No hashed phone number in webhook, cannot match");
        await UnprocessedPayment.create({
          receiptNumber: transactionReference || "unknown",
          phoneNumber: null,
          amount,
          transactionDate: new Date(transactionDate),
          rawData: payload,
          status: "new",
          tillNumber: senderTill
        });
        return;
      }

      

      let customer = await Customer.findOne({
        hashedPhone: hashedPhoneNumber,
        regionCode: projectedSite.regionCode
      });

      if (!customer) {
        customer = await Customer.findOne({
          hashedAlternatePhone: hashedPhoneNumber,
          regionCode: projectedSite.regionCode
        });
      }

      if (!customer) {
        console.log(`❌ No customer found for phone ${hashedPhoneNumber} region ${projectedSite.regionCode}`);
        await UnprocessedPayment.create({
          receiptNumber: transactionReference,
          phoneNumber: phoneNumber || hashedPhoneNumber,
          amount,
          transactionDate: new Date(transactionDate),
          rawData: payload,
          status: "new",
          tillNumber: senderTill
        });
        return;
      }

      const packageId = customer.subscription?.packageId;
      if (!packageId) {
        console.error(`❌ Customer ${customer.accountId} has no package assigned`);
        await UnprocessedPayment.create({
          receiptNumber: transactionReference,
          phoneNumber: phoneNumber || hashedPhoneNumber,
          amount,
          transactionDate: new Date(transactionDate),
          rawData: payload,
          status: "new",
          tillNumber: senderTill
        });
        return;
      }

      const newPayment = await Payment.create({
        customerId: customer._id,
        accountId: customer.accountId,
        regionCode: customer.regionCode,
        siteId: customer.siteId,
        amount,
        paymentMethod: "mpesa",
        status: "pending",
        kopokopoPaymentId: paymentRequestId || `C2B-${transactionReference}`,
        mpesaReceiptNumber: transactionReference,
        customerType: "pppoe",
        packageId,
        stkID: `C2B-${Date.now()}`,
        checkoutRequestId: transactionReference,
        stkPush: { phoneNumber: phoneNumber || hashedPhoneNumber, initiatedAt: new Date() },
        metadata: {
          packageId,
          phoneNumber: phoneNumber || hashedPhoneNumber,
          source: "c2b_webhook",
          receivedAt: new Date(),
          rawWebhook: payload,
        },
      });

      await processSuccessfulPayment(newPayment, customer, {
        receiptNumber: transactionReference,
        transactionDate: new Date(transactionDate),
        phoneNumber: phoneNumber || hashedPhoneNumber,
      });

    } catch (error) {
      console.error("🔥 [KopoKopoWebhook] Async error:", error);
    }
  });
});

// ============================================
// PROCESS SUCCESSFUL PAYMENT (shared logic)
// ============================================

/**
 * Process a successful payment (both from initiated STK and direct C2B)
 * @param {Object} payment - Payment document (will be updated to completed)
 * @param {Object} customer - Customer document
 * @param {Object} webhookData - { receiptNumber, transactionDate, phoneNumber }
 */
async function processSuccessfulPayment(payment, customer, webhookData) {
  console.log(`\n💰 Processing successful payment for ${customer.accountId}`);
  const { receiptNumber, transactionDate, phoneNumber } = webhookData;

  // 1. Update payment record
  payment.status = "completed";
  payment.mpesaReceiptNumber = receiptNumber;
  payment.completedAt = new Date();
  if (phoneNumber) payment.stkPush = { phoneNumber, completedAt: new Date() };
  await payment.save();

  // 2. Get the associated package
  const packageId =
    payment.metadata?.packageId || customer.subscription?.packageId;
  if (!packageId) {
    throw new Error(`No package found for customer ${customer.accountId}`);
  }
  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) {
    throw new Error(`Package ${packageId} not found`);
  }

  // 3. Create MPESA transaction (credit)
  const mpesaTransaction = await Transaction.create({
    type: "MPESA",
    customerType: "pppoe",
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: payment.amount,
    description: `M-Pesa payment via ${payment.paymentMethod || "KopoKopo"}`,
    paymentMethod: payment.paymentMethod || "mpesa",
    mpesa: {
      transactionId: receiptNumber,
      phoneNumber: phoneNumber || customer.phoneNumber,
      accountReference: payment.kopokopoPaymentId,
      transactionDate: transactionDate || new Date(),
    },
    status: "completed",
    relatedPaymentId: payment._id,
  });

  console.log(`✅ MPESA transaction created: ${mpesaTransaction._id}`);

  // 4. Determine if customer is active or expired
  const now = new Date();
  const currentBalance = customer.billing?.balance || 0;
  const totalAvailable = currentBalance + payment.amount;
  const packagePrice = packageDoc.price;
  const isActive = customer.subscription?.status === "active";

  let transactionType,
    transactionDescription,
    newBalance,
    smsMessage,
    shouldActivate = false;

  if (isActive) {
    // Active: add to wallet
    transactionType = "WALLET";
    transactionDescription = `Funds added to wallet (KopoKopo payment)`;
    newBalance = totalAvailable;
    shouldActivate = false;
    smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your payment of KES ${payment.amount} was successfully received. The amount has been added to your wallet balance and will be used to renew once your subscription expires. Your new skylink wallet balance is KES ${totalAvailable}. Thank you!`;
  } else {
    // Inactive: check if payment covers package price
    if (totalAvailable >= packagePrice) {
      transactionType = "SUBSCRIPTION";
      transactionDescription = `Subscription activation via KopoKopo - ${packageDoc.packageName}`;
      newBalance = totalAvailable - packagePrice;
      shouldActivate = true;
      smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your payment of KES ${payment.amount} was successfully received. The amount has been used to renew your subscription. Your new skylink wallet balance is KES ${newBalance}. Thank you!`;
    } else {
      transactionType = "WALLET";
      transactionDescription = `Insufficient balance - funds added to wallet (KopoKopo payment)`;
      newBalance = totalAvailable;
      smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your payment of KES ${payment.amount} was successfully received. The amount has been added to your wallet balance since it is not enough to renew your current subscription. Incase you want to change your subcsription, please contact 0111053184. Your new balance is KES ${totalAvailable}. Thank you!`;
      shouldActivate = false;
    }
  }

  // 5. Create secondary transaction (debit for subscription or credit for wallet)
  const secondaryAmount =
    transactionType === "SUBSCRIPTION" ? -packagePrice : -payment.amount;
  const secondTransaction = await Transaction.create({
    type: transactionType,
    customerType: "pppoe",
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: secondaryAmount,
    description: transactionDescription,
    paymentMethod: payment.paymentMethod || "mpesa",
    packageId: transactionType === "SUBSCRIPTION" ? packageDoc._id : undefined,
    relatedTransactionId: mpesaTransaction._id,
    status: "completed",
    relatedPaymentId: payment._id,
  });

  mpesaTransaction.relatedTransactionId = secondTransaction._id;
  await mpesaTransaction.save();

  console.log(
    `✅ Secondary transaction created: ${secondTransaction._id} (${transactionType})`,
  );

  // 6. Update customer balance
  if (!customer.billing) customer.billing = {};
  customer.billing.balance = newBalance;
  customer.billing.lastPaymentDate = now;
  await customer.save();

  console.log(`💵 Customer balance updated to ${newBalance}`);

  // 7. Handle activation if needed
  if (shouldActivate && customer.pppoe && customer.pppoe.username) {
    const currentExpiry = customer.subscription?.expiresAt;
    const baseDate = isActive && currentExpiry > now ? currentExpiry : now;
    let newExpiry = calculatePeriodEnd(baseDate, packageDoc.period, packageDoc.periodUnit);
    
    // Apply free extension days deduction if any
    if (customer.freeExtensionDays && customer.freeExtensionDays > 0) {
      const extensionDays = customer.freeExtensionDays;
      newExpiry = new Date(newExpiry);
      newExpiry.setDate(newExpiry.getDate() - extensionDays);
      if (newExpiry < now) newExpiry = now;
      console.log(`   Deducted ${extensionDays} free extension days from new expiry.`);
      customer.freeExtensionDays = 0; // reset after use
    }
    
    customer.subscription.expiresAt = newExpiry;

    customer.subscription = customer.subscription || {};
    customer.subscription.status = "active";
    customer.subscription.packageId = packageDoc._id;
    customer.subscription.activatedAt =
      customer.subscription.activatedAt || now;
    customer.subscription.expiresAt = newExpiry;
    customer.subscription.autoRenew = true;

    await customer.save();
    console.log(`📅 Subscription activated, expires at ${newExpiry}`);

    // Activate in RADIUS
    const site = await Site.findById(customer.siteId);
    if (site) {
      try {
        await activateAccount(customer, packageDoc);
        console.log("✅ RADIUS account activated");
      } catch (err) {
        console.error("⚠️ RADIUS activation failed:", err.message);
      }
    }
  }

  // 5. Send SMS (optional – you already have mobileSasaService)
  const smsTemplateService = require("../services/smsTemplateService")
if(shouldActivate){
  
  await smsTemplateService.sendUsingTemplate(
    'payment_renewal',
    customer.phoneNumber,
    {
      customerName: `${customer.firstName} ${customer.lastName}`,
      amount: payment.amount,
      expiryDate: newExpiry.toLocaleDateString(),
    },
    { customerId: customer._id, accountId: customer.accountId, type: 'subscription_renewal', regionCode: payment.regionCode }
  );
}else{
  const smsTemplateService = require('../services/smsTemplateService');
// After computing newBalance and before the SMS log
try {
  await smsTemplateService.sendUsingTemplate(
    'payment_wallet',
    customer.phoneNumber,
    {
      customerName: `${customer.firstName} ${customer.lastName}`,
      amount: payment.amount,
      newBalance: newBalance,
    },
    { customerId: customer._id, accountId: customer.accountId, type: 'payment_confirmation', regionCode: payment.regionCode }
  );
} catch (err) {
  console.error('Wallet SMS failed:', err.message);
}
}

  // 8. Log system event
  await SystemLog.create({
    eventType: shouldActivate ? "subscription_renewal" : "payment_received",
    severity: "info",
    regionCode: payment.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: shouldActivate
      ? `Subscription activated for ${customer.accountId} via KopoKopo payment`
      : `Payment of KES ${payment.amount} added to wallet for ${customer.accountId}`,
    details: {
      amount: payment.amount,
      receipt: receiptNumber,
      transactionType,
      newBalance,
      activated: shouldActivate,
    },
    success: true,
    relatedTransactionId: mpesaTransaction._id,
    relatedPaymentId: payment._id,
  });

  console.log(`✅ Payment processing completed for ${customer.accountId}`);
}

/**
 * Activate a hotspot user after successful payment
 * @param {Object} payment - Payment document (will be updated to completed)
 * @param {Object} webhookData - { receiptNumber, transactionDate, phoneNumber }
 */
async function activateHotspotAfterPayment(payment, webhookData) {
  console.log(`\n🔓 Activating hotspot user after payment: ${payment.customerId}`);
  const { receiptNumber, transactionDate, phoneNumber } = webhookData;

  // 1. Update payment record
  payment.status = "completed";
  payment.mpesaReceiptNumber = receiptNumber;
  payment.completedAt = new Date();
  if (phoneNumber) payment.stkPush = { phoneNumber, completedAt: new Date() };
  await payment.save();

  // 2. Fetch HotspotUser
  const hotspotUser = await HotspotUser.findById(payment.customerId);
  if (!hotspotUser) {
    console.error(`❌ HotspotUser not found: ${payment.customerId}`);
    throw new Error("Hotspot user not found");
  }

  // 3. Fetch the package
  const packageId = payment.metadata?.packageId || payment.packageId;
  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) {
    throw new Error(`Package ${packageId} not found`);
  }

  // 4. Create MPESA transaction (credit)
  const mpesaTransaction = await Transaction.create({
    type: "MPESA",
    customerType: "hotspot",
    customerId: hotspotUser._id,
    accountId: hotspotUser.macAddress,  // use MAC as identifier
    firstName: "Hotspot",
    lastName: "User",
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: payment.amount,
    description: `Hotspot payment via ${payment.paymentMethod || "KopoKopo"}`,
    paymentMethod: payment.paymentMethod || "mpesa",
    mpesa: {
      transactionId: receiptNumber,
      phoneNumber: phoneNumber || payment.metadata?.phoneNumber,
      accountReference: payment.kopokopoPaymentId,
      transactionDate: transactionDate || new Date(),
    },
    status: "completed",
    relatedPaymentId: payment._id,
  });

  // 5. Activate the hotspot user
  const now = new Date();
  const expiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);

  hotspotUser.activeSession = {
    packageId: packageDoc._id,
    startedAt: now,
    expiresAt: expiry,
    isActive: true,
    dataLimit: packageDoc.dataLimit,
  };
  await hotspotUser.save();

  // 6. Create or enable RADIUS account
  const radiusService = require("../services/radiusService");
  const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
  const username = `hs_${hotspotUser.macAddress.replace(/[:-]/g, '')}`;

  // Check if RADIUS account already exists
  let radiusUserExists = false;
  try {
    const conn = await radiusService.getConnection();
    const [rows] = await conn.query(
      'SELECT 1 FROM radcheck WHERE username = ? LIMIT 1',
      [username]
    );
    radiusUserExists = rows.length > 0;
    conn.release();
  } catch (e) {
    console.error("RADIUS check error:", e);
  }

  if (radiusUserExists) {
    // Enable the account (move to active group)
    await radiusService.enableAccount(username, groupName);
    console.log(`   ✅ RADIUS account enabled: ${username}`);
  } else {
    // Create fresh hotspot account
    const dataLimitMB = packageDoc.dataLimit || (packageDoc.fup?.enabled ? (packageDoc.fup.dataThresholdGB * 1024) : null);
    const createResult = await radiusService.createHotspotAccount(
      hotspotUser.macAddress,
      groupName,
      dataLimitMB,
      expiry
    );
    if (!createResult.success) {
      console.error("❌ RADIUS creation failed:", createResult.error);
      throw new Error("RADIUS account creation failed");
    }
    console.log(`   ✅ RADIUS account created: ${username}`);
  }

  // 7. Set billing cycle start
  await radiusService.setBillingCycleStart(username, now);

  // 8. Apply FUP if enabled
  if (packageDoc.fup?.enabled) {
    const quotaBytes = packageDoc.fup.dataThresholdGB * 1024 * 1024 * 1024;
    await radiusService.enableFUPForCustomer(username, quotaBytes);
    console.log(`   ✅ FUP enabled (${packageDoc.fup.dataThresholdGB} GB)`);
  }

  // 9. Disconnect the device (force reconnect with new settings)
  await radiusService.killUserSession(username);
  console.log(`   ✅ Session disconnected (reconnect will give internet)`);


  const mikrotikService = require("../services/mikrotikService");

// Get the router for this site
const router = await Router.findOne({ site: payment.siteId });
if (!router) {
    console.error("No router found for site");
} else {
    const siteObj = {
        router: {
            ip: router.ip,
            username: router.username,
            password: router.password,
            port: router.apiPort || 8728,
            apiType: router.apiType || "api",
        }
    };
    
    // Add to hotspot active users (allows internet immediately)
    await mikrotikService.addHotspotActiveUser(siteObj, {
        name: username,           // hs_MACADDRESS
        password: password,       // from RADIUS
        macAddress: hotspotUser.macAddress,
        profile: packageGroupName, // e.g., "10MBPS_HOTSPOT"
        routes: "yes",
        limitUptime: packageDoc.period + packageDoc.periodUnit, // e.g., "1d"
    });
}

  // 10. Create subscription transaction (debit of package price)
  const secondaryTransaction = await Transaction.create({
    type: "SUBSCRIPTION",
    customerType: "hotspot",
    customerId: hotspotUser._id,
    accountId: hotspotUser.macAddress,
    firstName: "Hotspot",
    lastName: "User",
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: -packageDoc.price,
    description: `Hotspot activation via payment - ${packageDoc.packageName}`,
    paymentMethod: payment.paymentMethod || "mpesa",
    packageId: packageDoc._id,
    relatedTransactionId: mpesaTransaction._id,
    status: "completed",
    relatedPaymentId: payment._id,
  });

  mpesaTransaction.relatedTransactionId = secondaryTransaction._id;
  await mpesaTransaction.save();

  // 11. Log system event
  await SystemLog.create({
    eventType: "hotspot_activation",
    severity: "info",
    regionCode: payment.regionCode,
    entityType: "hotspot_user",
    entityId: hotspotUser._id,
    accountId: hotspotUser.macAddress,
    message: `Hotspot user ${hotspotUser.macAddress} activated with package ${packageDoc.packageName} until ${expiry.toISOString()}`,
    details: {
      amount: payment.amount,
      receipt: receiptNumber,
      packageName: packageDoc.packageName,
      expiresAt: expiry,
      activatedFrom: "payment_webhook"
    },
    success: true,
    relatedTransactionId: mpesaTransaction._id,
    relatedPaymentId: payment._id,
  });

  console.log(`   ✅ Hotspot user fully activated`);
}

// ============================================
// CHECK PAYMENT STATUS
// ============================================

/**
 * @desc    Check payment status
 * @route   GET /api/payments/:paymentId/status
 * @access  Public
 */
exports.checkPaymentStatus = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await Payment.findById(paymentId);
  if (!payment) {
    return next(new ErrorResponse("Payment not found", 404));
  }

  // Query Kopo Kopo if still pending
  if (payment.status === "pending" && payment.kopokopoLocation) {
    const statusResult = await kopokopoService.queryPaymentStatus(
      payment.kopokopoLocation,
    );

    if (statusResult.success) {
      payment.status = statusResult.status;
      await payment.save();
    }
  }

  res.status(200).json({
    success: true,
    data: {
      paymentId: payment._id,
      status: payment.status,
      amount: payment.amount,
      channel: payment.paymentChannel,
      createdAt: payment.createdAt,
    },
  });
});

// ============================================
// PAYMENT HISTORY
// ============================================

/**
 * @desc    Get payment history for a customer
 * @route   GET /api/payments/history/:customerId
 * @access  Private
 */
exports.getPaymentHistory = asyncHandler(async (req, res, next) => {
  const { customerId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const payments = await Payment.find({
    customerId,
    status: { $ne: "pending" },
  })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Payment.countDocuments({
    customerId,
    status: { $ne: "pending" },
  });

  res.status(200).json({
    success: true,
    data: {
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

/**
 * @desc    Get transaction history
 * @route   GET /api/payments/transactions/:customerId
 * @access  Private
 */
exports.getTransactionsHistory = asyncHandler(async (req, res, next) => {
  const { customerId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const transactions = await Transaction.find({ customerId })
    .sort({ processedAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Transaction.countDocuments({ customerId });

  res.status(200).json({
    success: true,
    data: {
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// ============================================
// UNPROCESSED PAYMENTS
// ============================================

/**
 * @desc    Search unprocessed payments
 * @route   GET /api/payments/unprocessed/search
 * @access  Private
 */
exports.searchUnprocessed = asyncHandler(async (req, res, next) => {
  const { phone, receipt, accountId } = req.query;

  const query = { status: "unmatched" };

  if (phone) {
    const formattedPhone = formatPhoneNumber(phone);
    query.phoneNumber = formattedPhone;
  }

  if (receipt) {
    query.receiptNumber = { $regex: receipt, $options: "i" };
  }

  if (accountId) {
    query.accountReference = { $regex: accountId, $options: "i" };
  }

  const payments = await UnprocessedPayment.find(query)
    .sort({ transactionDate: -1 })
    .limit(50);

  res.status(200).json({
    success: true,
    data: { payments, count: payments.length },
  });
});

/**
 * @desc    Get single unprocessed payment
 * @route   GET /api/payments/unprocessed/:id
 * @access  Private
 */
exports.getAnUnprocessedPayment = asyncHandler(async (req, res, next) => {
  const { receipt } = req.params;

  const unprocessedPayment = await UnprocessedPayment.findOne({
    receiptNumber: receipt,
  });

  if (!unprocessedPayment) {
    return next(new ErrorResponse("Unprocessed payment not found", 404));
  }

  res.status(200).json({
    success: true,
    message: "Unprocessed payment retrieved successfully",
    data: unprocessedPayment,
  });
});

// Note: Keep all your other payment controller functions:
// - movePayment
// - movePaymentToParent
// - getPaymentTransferHistory
// - resolvePayment
//
// These remain unchanged as they work with Payment model, not payment gateway

/**
 * @desc    Manually resolve an unmatched payment
 * @route   POST /api/payments/resolve
 * @access  Private
 */
exports.resolvePayment = asyncHandler(async (req, res, next) => {
  const { receiptNumber, customerId, customerType } = req.body;

  if (!receiptNumber || !customerId || !customerType) {
    return next(
      new ErrorResponse("Receipt, customer ID and type required", 400),
    );
  }
  if (!["pppoe", "hotspot"].includes(customerType)) {
    return next(new ErrorResponse("Invalid customer type", 400));
  }

  let payment = await Payment.findOne({ mpesaReceiptNumber: receiptNumber });
  if (payment) {
    return next(
      new ErrorResponse("This receipt has already been processed", 400),
    );
  }

  const unprocessed = await UnprocessedPayment.findOne({
    receiptNumber,
    status: "new",
  });
  if (!unprocessed) {
    return next(
      new ErrorResponse("Receipt not found or already resolved", 404),
    );
  }

  const CustomerModel = customerType === "pppoe" ? Customer : HotspotUser;
  const customer = await CustomerModel.findById(customerId);
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  let packageId;
  if (customerType === "pppoe") {
    packageId = customer.subscription?.packageId;
  } else {
    packageId = customer.activeSession?.packageId;
  }
  if (!packageId)
    return next(new ErrorResponse("Customer has no package", 400));
  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) return next(new ErrorResponse("Package not found", 404));

  payment = await Payment.create({
    stkID: `MANUAL-${receiptNumber}`,
    checkoutRequestId: receiptNumber,
    customerType,
    customerId: customer._id,
    accountId: customer.accountId || customer._id.toString(),
    regionCode: customer.regionCode,
    siteId: customer.siteId,
    amount: unprocessed.amount,
    packageId,
    status: "completed",
    stkPush: {
      phoneNumber: unprocessed.phoneNumber,
      initiatedAt: unprocessed.transactionDate || new Date(),
    },
    mpesaReceiptNumber: receiptNumber,
    callbackReceived: true,
    callbackData: unprocessed.rawData,
    source: "manual",
    resolutionStatus: "processed",
  });

  await processManualPayment(payment, {
    amount: unprocessed.amount,
    phoneNumber: unprocessed.phoneNumber,
    transactionDate: unprocessed.transactionDate,
  });

  unprocessed.status = "matched";
  unprocessed.matchedWith = {
    type: "Customer",
    id: customer._id,
  };
  await unprocessed.save();

  res.json({
    success: true,
    message: "Payment resolved and processed",
    data: payment,
  });
});

/**
 * @desc    Move/Transfer payment from one customer to another
 * @route   POST /api/payments/:paymentId/move
 * @access  Private (Admin only)
 */
exports.movePayment = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;
  const { targetCustomerId, reason } = req.body;

  if (!targetCustomerId)
    return next(new ErrorResponse("Target customer ID is required", 400));
  if (!reason)
    return next(
      new ErrorResponse("Reason for payment transfer is required", 400),
    );

  const payment = await Payment.findById(paymentId);
  if (!payment) return next(new ErrorResponse("Payment not found", 404));
  if (payment.status === "failed")
    return next(new ErrorResponse("Cannot move failed payments", 400));

  const sourceCustomer = await Customer.findById(payment.customerId).populate(
    "subscription.packageId",
  );
  if (!sourceCustomer)
    return next(new ErrorResponse("Source customer not found", 404));

  const targetCustomer = await Customer.findById(targetCustomerId).populate(
    "subscription.packageId",
  );
  if (!targetCustomer)
    return next(new ErrorResponse("Target customer not found", 404));

  if (sourceCustomer._id.toString() === targetCustomer._id.toString()) {
    return next(new ErrorResponse("Cannot move payment to same customer", 400));
  }

  const site = await Site.findById(sourceCustomer.siteId).select(
    "+router.password",
  );
  const now = new Date();

  console.log(`\n💸 Moving payment ${payment.mpesaReceiptNumber || paymentId}`);
  console.log(
    `   From: ${sourceCustomer.accountId} (${sourceCustomer.firstName} ${sourceCustomer.lastName})`,
  );
  console.log(
    `   To: ${targetCustomer.accountId} (${targetCustomer.firstName} ${targetCustomer.lastName})`,
  );
  console.log(`   Amount: KES ${payment.amount}`);
  console.log(`   Reason: ${reason}`);

  // Find linked transactions
  const mpesaTxn = await Transaction.findOne({
    "mpesa.transactionId": payment.mpesaReceiptNumber,
    type: "MPESA",
  });
  if (!mpesaTxn) {
    return next(new ErrorResponse("MPESA transaction not found", 400));
  }

  const secondaryTxn = await Transaction.findOne({
    relatedTransactionId: mpesaTxn._id,
    type: { $in: ["SUBSCRIPTION", "WALLET"] },
  });
  if (!secondaryTxn) {
    return next(new ErrorResponse("Secondary transaction not found", 400));
  }

  // Reverse source customer's financial impact
  let reversalResult = { suspended: false, balanceAdjusted: false };
  const wasSubscription = secondaryTxn.type === "SUBSCRIPTION";
  const wasWallet = secondaryTxn.type === "WALLET";

  if (wasSubscription) {
    const activationTime = sourceCustomer.subscription.activatedAt;
    const paymentTime = payment.stkPush?.initiatedAt || payment.createdAt;
    const timeDiff = Math.abs(activationTime - paymentTime);
    const isActivation = timeDiff < 1000 * 60 * 60;

    if (isActivation) {
      sourceCustomer.subscription.status = "expired";
      sourceCustomer.subscription.expiresAt = now;
      await sourceCustomer.save();
      reversalResult.suspended = true;

      try {
        const radiusService = require("../services/radiusService");
        await radiusService.disableAccount(sourceCustomer.pppoe.username);
        console.log(`   ✅ Disabled in RADIUS`);
      } catch (err) {
        console.error(`   ⚠️ RADIUS disable failed: ${err.message}`);
      }
    } else {
      sourceCustomer.billing.balance += payment.amount;
      await sourceCustomer.save();
      reversalResult.balanceAdjusted = true;
      console.log(
        `   📊 Payment was a renewal, added ${payment.amount} back to balance. New balance: ${sourceCustomer.billing.balance}`,
      );
    }
  } else if (wasWallet) {
    sourceCustomer.billing.balance -= payment.amount;
    await sourceCustomer.save();
    reversalResult.balanceAdjusted = true;
    console.log(
      `   📊 Payment was wallet top-up, subtracted ${payment.amount} from balance. New balance: ${sourceCustomer.billing.balance}`,
    );
  }

  // Update transactions to target customer
  const targetFields = {
    customerId: targetCustomer._id,
    accountId: targetCustomer.accountId,
    firstName: targetCustomer.firstName,
    lastName: targetCustomer.lastName,
    regionCode: targetCustomer.regionCode,
    siteId: targetCustomer.siteId,
  };

  mpesaTxn.set(targetFields);
  mpesaTxn.description = `M-Pesa payment transferred from ${sourceCustomer.accountId}`;
  mpesaTxn.notes =
    (mpesaTxn.notes || "") +
    `\nTransferred to ${targetCustomer.accountId} on ${now.toISOString()}. Reason: ${reason}`;
  await mpesaTxn.save();

  const targetPackage = targetCustomer.subscription?.packageId;
  if (!targetPackage) {
    return next(
      new ErrorResponse("Target customer has no package assigned", 400),
    );
  }

  const targetWasExpired = targetCustomer.subscription.status === "expired";
  let newSecondaryType, newAmount, newDescription;

  if (targetWasExpired) {
    newSecondaryType = "SUBSCRIPTION";
    newAmount = -targetPackage.price;
    newDescription = `Subscription activation (payment transferred from ${sourceCustomer.accountId})`;
  } else {
    newSecondaryType = "WALLET";
    newAmount = payment.amount;
    newDescription = `Wallet credit (payment transferred from ${sourceCustomer.accountId})`;
  }

  secondaryTxn.set(targetFields);
  secondaryTxn.type = newSecondaryType;
  secondaryTxn.amount = -Math.abs(newAmount);
  secondaryTxn.description = newDescription;
  secondaryTxn.notes =
    (secondaryTxn.notes || "") +
    `\nTransferred to ${targetCustomer.accountId} on ${now.toISOString()}. Reason: ${reason}`;
  if (newSecondaryType === "SUBSCRIPTION") {
    secondaryTxn.packageId = targetPackage._id;
  } else {
    secondaryTxn.packageId = undefined;
  }
  await secondaryTxn.save();

  // Update payment record
  payment.metadata = payment.metadata || {};
  payment.metadata.transferHistory = payment.metadata.transferHistory || [];
  payment.metadata.transferHistory.push({
    fromCustomerId: sourceCustomer._id,
    fromAccountId: sourceCustomer.accountId,
    toCustomerId: targetCustomer._id,
    toAccountId: targetCustomer.accountId,
    transferredAt: now,
    transferredBy: req.session.userId,
    reason,
    originalSecondaryType: wasSubscription ? "SUBSCRIPTION" : "WALLET",
    newSecondaryType,
  });

  payment.customerId = targetCustomer._id;
  payment.accountId = targetCustomer.accountId;
  payment.regionCode = targetCustomer.regionCode;
  payment.siteId = targetCustomer.siteId;
  payment.transactionId = secondaryTxn._id;
  await payment.save();

  // Apply effect to target customer
  if (newSecondaryType === "SUBSCRIPTION") {
    let periodEnd = calculatePeriodEnd(
      now,
      targetPackage.period,
      targetPackage.periodUnit,
    );
    if (targetCustomer.freeExtensionDays && targetCustomer.freeExtensionDays > 0) {
      periodEnd = new Date(periodEnd);
      periodEnd.setDate(periodEnd.getDate() - targetCustomer.freeExtensionDays);
      if (periodEnd < now) periodEnd = now;
      targetCustomer.freeExtensionDays = 0;
    }
    const paymentDate = payment.stkPush?.initiatedAt || payment.createdAt;
    const paymentAgeDays = Math.floor(
      (now - paymentDate) / (1000 * 60 * 60 * 24),
    );
    if (paymentAgeDays > 3) {
      periodEnd = new Date(periodEnd);
      periodEnd.setDate(periodEnd.getDate() - paymentAgeDays);
      console.log(
        `   ⏳ Adjusted expiry by ${paymentAgeDays} days due to payment age.`,
      );
    }

    targetCustomer.subscription.status = "active";
    targetCustomer.subscription.activatedAt =
      targetCustomer.subscription.activatedAt || now;
    targetCustomer.subscription.expiresAt = periodEnd;
    console.log(
      `   ✅ Target activated, new expiry: ${periodEnd.toISOString()}`,
    );

    if (site) {
      try {
        const radiusService = require("../services/radiusService");
        const packageName = targetPackage.packageName
          .replace(/\s+/g, "_")
          .toUpperCase();
        await radiusService.enableAccount(
          targetCustomer.pppoe.username,
          packageName,
        );
        console.log(`   ✅ Activated in RADIUS`);
      } catch (err) {
        console.error(`   ⚠️ RADIUS activation failed: ${err.message}`);
      }
    }
  } else {
    targetCustomer.billing.balance += payment.amount;
    console.log(
      `   ✅ Wallet top-up, added ${payment.amount} to balance. New balance: ${targetCustomer.billing.balance}`,
    );
  }

  targetCustomer.billing.lastPaymentDate = now;
  await targetCustomer.save();

  await SystemLog.create({
    eventType: "payment_transferred",
    severity: "warning",
    regionCode: targetCustomer.regionCode,
    entityType: "payment",
    entityId: payment._id,
    message: `Payment KES ${payment.amount} transferred from ${sourceCustomer.accountId} to ${targetCustomer.accountId}`,
    details: {
      paymentId: payment._id,
      mpesaCode: payment.mpesaReceiptNumber,
      amount: payment.amount,
      fromCustomer: {
        id: sourceCustomer._id,
        accountId: sourceCustomer.accountId,
        name: `${sourceCustomer.firstName} ${sourceCustomer.lastName}`,
      },
      toCustomer: {
        id: targetCustomer._id,
        accountId: targetCustomer.accountId,
        name: `${targetCustomer.firstName} ${targetCustomer.lastName}`,
      },
      reason,
      originalSecondaryType: wasSubscription ? "SUBSCRIPTION" : "WALLET",
      newSecondaryType,
      reversal: reversalResult,
    },
    triggeredBy: req.session.userId,
    success: true,
  });

  console.log(`\n✅ Payment transfer complete!`);
  res.status(200).json({
    success: true,
    message: `Payment transferred successfully from ${sourceCustomer.accountId} to ${targetCustomer.accountId}`,
    data: {
      payment: {
        id: payment._id,
        amount: payment.amount,
        mpesaCode: payment.mpesaReceiptNumber,
      },
      source: {
        customerId: sourceCustomer._id,
        accountId: sourceCustomer.accountId,
        name: `${sourceCustomer.firstName} ${sourceCustomer.lastName}`,
        status: sourceCustomer.subscription.status,
        reversed: reversalResult,
      },
      target: {
        customerId: targetCustomer._id,
        accountId: targetCustomer.accountId,
        name: `${targetCustomer.firstName} ${targetCustomer.lastName}`,
        status: targetCustomer.subscription.status,
        expiresAt: targetCustomer.subscription.expiresAt,
        balance: targetCustomer.billing.balance,
      },
    },
  });
});

/**
 * @desc    Move payment from child to parent account
 * @route   POST /api/payments/:paymentId/move-to-parent
 * @access  Private
 */
exports.movePaymentToParent = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await Payment.findById(paymentId);
  if (!payment) {
    return next(new ErrorResponse("Payment not found", 404));
  }

  const childCustomer = await Customer.findById(payment.customerId);
  if (!childCustomer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  if (!childCustomer.isChild || !childCustomer.parentAccount) {
    return next(new ErrorResponse("This is not a child account", 400));
  }

  const parentCustomer = await Customer.findById(childCustomer.parentAccount);
  if (!parentCustomer) {
    return next(new ErrorResponse("Parent account not found", 404));
  }

  console.log(`\n👨‍👦 Moving child payment to parent`);
  console.log(`   Child: ${childCustomer.accountId}`);
  console.log(`   Parent: ${parentCustomer.accountId}`);

  req.body.targetCustomerId = parentCustomer._id.toString();
  req.body.reason = `Automatic transfer from child account ${childCustomer.accountId} to parent ${parentCustomer.accountId}`;

  return exports.movePayment(req, res, next);
});

/**
 * @desc    Get payment transfer history
 * @route   GET /api/payments/:paymentId/transfer-history
 * @access  Private
 */
exports.getPaymentTransferHistory = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await Payment.findById(paymentId);
  if (!payment) {
    return next(new ErrorResponse("Payment not found", 404));
  }

  const transferHistory = payment.metadata?.transferHistory || [];

  const enrichedHistory = await Promise.all(
    transferHistory.map(async (transfer) => {
      const fromCustomer = await Customer.findById(
        transfer.fromCustomerId,
      ).select("accountId firstName lastName");
      const toCustomer = await Customer.findById(transfer.toCustomerId).select(
        "accountId firstName lastName",
      );

      return {
        ...transfer.toObject(),
        fromCustomer: fromCustomer
          ? {
              accountId: fromCustomer.accountId,
              name: `${fromCustomer.firstName} ${fromCustomer.lastName}`,
            }
          : null,
        toCustomer: toCustomer
          ? {
              accountId: toCustomer.accountId,
              name: `${toCustomer.firstName} ${toCustomer.lastName}`,
            }
          : null,
      };
    }),
  );

  res.status(200).json({
    success: true,
    data: {
      paymentId: payment._id,
      mpesaCode: payment.mpesaReceiptNumber,
      currentCustomer: {
        id: payment.customerId,
        accountId: payment.accountId,
      },
      transferCount: enrichedHistory.length,
      transfers: enrichedHistory,
    },
  });
});

// ============================================
// HELPER: Process manual payment (used by resolvePayment)
// ============================================

async function processManualPayment(payment, mpesaData) {
  console.log("⚙️ [processManualPayment] Starting for payment:", payment._id);
  try {
    const customer = await (
      payment.customerType === "pppoe" ? Customer : HotspotUser
    ).findById(payment.customerId);
    const packageDoc = await Package.findById(payment.packageId);

    if (!customer || !packageDoc) {
      throw new Error("Customer or Package not found");
    }

    const now = new Date();
    const currentBalance = customer.billing?.balance || 0;
    const totalAvailable = currentBalance + payment.amount;
    const packagePrice = packageDoc.price;
    const isActive = customer.subscription?.status !== "expired";

    let transactionType;
    let transactionDescription;
    let shouldActivate = false;
    let newBalance = currentBalance;
    let smsMessage;

    if (isActive) {
      transactionType = "WALLET";
      transactionDescription = "Funds added to wallet - Manual resolution";
      newBalance = totalAvailable;
      shouldActivate = false;
      smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your payment of KES ${payment.amount} was successfully received. The amount has been added to your wallet balance and will be used to renew once your subscription expires. Your new skylink wallet balance is KES ${totalAvailable}. Thank you!`;
    } else {
      if (totalAvailable >= packagePrice) {
        transactionType = "SUBSCRIPTION";
        transactionDescription = `Subscription activated via manual resolution - ${packageDoc.packageName}`;
        newBalance = totalAvailable - packagePrice;
        shouldActivate = true;
        smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your payment of KES ${payment.amount} was successfully received. The amount has been used to renew your subscription. Your new skylink wallet balance is KES ${newBalance}. Thank you!`;
      } else {
        transactionType = "WALLET";
        transactionDescription =
          "Insufficient balance - funds added to wallet (manual resolution)";
        newBalance = totalAvailable;
        shouldActivate = false;
        smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your payment of KES ${payment.amount} was successfully received. The amount has been added to your wallet balance since it is not enough to renew your current subscription. Incase you want to change your subcsription, please contact 0111053184. Your new balance is KES ${totalAvailable}. Thank you!`;
      }
    }

    const mpesaTransaction = await Transaction.create({
      type: "MPESA",
      customerType: payment.customerType,
      customerId: customer._id,
      accountId: payment.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: payment.amount,
      description: "M-Pesa direct payment (manual resolution)",
      paymentMethod: "mpesa",
      mpesa: {
        transactionId: payment.mpesaReceiptNumber,
        phoneNumber: mpesaData.phoneNumber,
        accountReference: payment.stkID,
        transactionDate: parseMpesaDate(mpesaData.transactionDate),
      },
      status: "completed",
    });

    const secondTransaction = await Transaction.create({
      type: transactionType,
      customerType: payment.customerType,
      customerId: customer._id,
      accountId: payment.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount:
        transactionType === "SUBSCRIPTION" ? -packagePrice : -payment.amount,
      description: transactionDescription,
      paymentMethod: "mpesa",
      packageId:
        transactionType === "SUBSCRIPTION" ? packageDoc._id : undefined,
      relatedTransactionId: mpesaTransaction._id,
      status: "completed",
    });

    mpesaTransaction.relatedTransactionId = secondTransaction._id;
    await mpesaTransaction.save();

    customer.billing.balance = newBalance;
    customer.billing.lastPaymentDate = now;

    if (shouldActivate && customer.pppoe && customer.pppoe.username) {
      const currentExpiry = customer.subscription.expiresAt;
const baseDate = isActive && currentExpiry > now ? currentExpiry : now;
let newExpiry = calculatePeriodEnd(baseDate, packageDoc.period, packageDoc.periodUnit);

if (customer.freeExtensionDays && customer.freeExtensionDays > 0) {
  const extensionDays = customer.freeExtensionDays;
  newExpiry = new Date(newExpiry);
  newExpiry.setDate(newExpiry.getDate() - extensionDays);
  if (newExpiry < now) newExpiry = now;
  customer.freeExtensionDays = 0;
}
customer.subscription.expiresAt = newExpiry;
      customer.subscription.status = "active";
      customer.subscription.activatedAt = now;
      customer.renewals.push({
        dateRenewed: now,
        method: "manual",
      });

      await customer.save();
      const site = await Site.findById(payment.siteId);
      if (site) {
        try {
          await activateAccount(customer, packageDoc);
          console.log("✅ RADIUS account activated");
        } catch (err) {
          console.error("⚠️ RADIUS activation failed:", err.message);
        }
      }
    } else if (shouldActivate && payment.customerType === "hotspot") {
      customer.activeSession = {
        packageId: packageDoc._id,
        startedAt: now,
        expiresAt: calculatePeriodEnd(
          now,
          packageDoc.period,
          packageDoc.periodUnit,
        ),
        dataLimit: packageDoc.dataLimit,
        dataUsed: 0,
        isActive: true,
      };
      customer.purchaseHistory.push({
        packageId: packageDoc._id,
        purchasedAt: now,
        amount: payment.amount,
        transactionId: mpesaTransaction._id,
      });
      await customer.save();
    } else {
      await customer.save();
    }

  // 5. Send SMS (optional – you already have mobileSasaService)
  const smsTemplateService = require("../services/smsTemplateService")
if(shouldActivate){
  
  await smsTemplateService.sendUsingTemplate(
    'payment_renewal',
    customer.phoneNumber,
    {
      customerName: `${customer.firstName} ${customer.lastName}`,
      amount: payment.amount,
      expiryDate: newExpiry.toLocaleDateString(),
    },
    { customerId: customer._id, accountId: customer.accountId, type: 'subscription_renewal', regionCode: payment.regionCode }
  );
}else{
  const smsTemplateService = require('../services/smsTemplateService');
// After computing newBalance and before the SMS log
try {
  await smsTemplateService.sendUsingTemplate(
    'payment_wallet',
    customer.phoneNumber,
    {
      customerName: `${customer.firstName} ${customer.lastName}`,
      amount: payment.amount,
      newBalance: newBalance,
    },
    { customerId: customer._id, accountId: customer.accountId, type: 'payment_confirmation', regionCode: payment.regionCode }
  );
} catch (err) {
  console.error('Wallet SMS failed:', err.message);
}
}

    await SystemLog.create({
      eventType: shouldActivate ? "subscription_renewal" : "payment_received",
      severity: "info",
      regionCode: payment.regionCode,
      entityType:
        payment.customerType === "pppoe" ? "customer" : "hotspot_user",
      entityId: customer._id,
      accountId: payment.accountId,
      message: shouldActivate
        ? `Subscription activated via manual resolution for ${payment.accountId}`
        : `Manual resolution payment added to wallet for ${payment.accountId}`,
      details: {
        amount: payment.amount,
        mpesaReceipt: payment.mpesaReceiptNumber,
        transactionType,
        newBalance,
        activated: shouldActivate,
      },
      success: true,
      relatedTransactionId: mpesaTransaction._id,
      relatedPaymentId: payment._id,
    });

    console.log("✅ [processManualPayment] Completed successfully");
  } catch (error) {
    console.error("🔥 [processManualPayment] Error:", error);
    throw error;
  }
}



/**
 * @desc    Manual cash deposit (follows same logic as M-Pesa payment)
 * @route   POST /api/payments/deposit
 * @access  Private (Admin only)
 */
exports.depositCash = asyncHandler(async (req, res, next) => {
  const { customerId, amount, notes, reason } = req.body;

  if (!customerId || !amount || amount <= 0) {
    return next(new ErrorResponse("Customer ID and positive amount are required", 400));
  }

  const customer = await Customer.findById(customerId).populate("subscription.packageId");
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  // Region access check
  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  const packageDoc = customer.subscription.packageId;
  if (!packageDoc) {
    return next(new ErrorResponse("Customer has no package assigned", 400));
  }

  // Create payment record (completed immediately)
  const payment = await Payment.create({
    customerId: customer._id,
    accountId: customer.accountId,
    customerType: customer.pppoe ? "pppoe" : "hotspot",
    regionCode: customer.regionCode,
    siteId: customer.siteId,
    amount,
    paymentMethod: "cash",
    status: "completed",
    completedAt: new Date(),
    source: "manual_deposit",
    metadata: {
      reason: reason || "Manual cash deposit",
      notes: notes || null,
      depositedBy: req.session.userId,
      depositedAt: new Date(),
    },
    packageId: packageDoc._id,
  });

  // Now process the payment using the same logic as manual resolution (but without MPESA data)
  await processCashPayment(payment, customer, packageDoc, { notes, reason, adminId: req.session.userId });

  res.status(200).json({
    success: true,
    message: `KES ${amount} deposited to ${customer.accountId} and processed`,
    data: {
      paymentId: payment._id,
      newBalance: customer.billing?.balance,
    },
  });
});

/**
 * Process a cash payment (identical logic to processManualPayment but for cash)
 * @param {Object} payment - Payment document
 * @param {Object} customer - Customer document
 * @param {Object} packageDoc - Package document
 * @param {Object} extra - { notes, reason, adminId }
 */
async function processCashPayment(payment, customer, packageDoc, extra) {
  console.log(`💰 Processing cash payment for ${customer.accountId}, amount ${payment.amount}`);
  
  const now = new Date();
  const currentBalance = customer.billing?.balance || 0;
  const totalAvailable = currentBalance + payment.amount;
  const packagePrice = packageDoc.price;
  const isActive = customer.subscription?.status === "active";

  let transactionType;
  let transactionDescription;
  let shouldActivate = false;
  let newBalance = currentBalance;
  let smsMessage;

  if (isActive) {
    // Active customer: always add to wallet (no immediate renewal)
    transactionType = "WALLET";
    transactionDescription = "Funds added to wallet (cash deposit)";
    newBalance = totalAvailable;
    shouldActivate = false;
    smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your cash deposit of KES ${payment.amount} was received. The amount has been added to your wallet balance. Your new balance is KES ${totalAvailable}. Thank you!`;
  } else {
    // Inactive (expired or suspended)
    if (totalAvailable >= packagePrice) {
      transactionType = "SUBSCRIPTION";
      transactionDescription = `Subscription renewal via cash deposit - ${packageDoc.packageName}`;
      newBalance = totalAvailable - packagePrice;
      shouldActivate = true;
      smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your cash deposit of KES ${payment.amount} has been used to renew your subscription. Your new wallet balance is KES ${newBalance}. Thank you!`;
    } else {
      transactionType = "WALLET";
      transactionDescription = "Insufficient balance - funds added to wallet (cash deposit)";
      newBalance = totalAvailable;
      shouldActivate = false;
      smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your cash deposit of KES ${payment.amount} was received but is not enough to renew your subscription. The amount has been added to your wallet. Your new balance is KES ${totalAvailable}. Thank you!`;
    }
  }

  // 1. Create the cash receipt transaction (positive)
  const cashTransaction = await Transaction.create({
    type: "CASH_DEPOSIT",
    customerType: "pppoe", // extend to hotspot if needed
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: payment.amount,
    description: `Cash deposit: ${extra.reason || "Manual deposit"}`,
    paymentMethod: "cash",
    status: "completed",
    relatedPaymentId: payment._id,
    metadata: {
      depositedBy: extra.adminId,
      notes: extra.notes,
    },
  });

  // 2. Create the second transaction (debit for wallet or subscription)
  const secondAmount = transactionType === "SUBSCRIPTION" ? -packagePrice : -payment.amount;
  const secondTransaction = await Transaction.create({
    type: transactionType,
    customerType: "pppoe",
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: secondAmount,
    description: transactionDescription,
    paymentMethod: "cash",
    packageId: transactionType === "SUBSCRIPTION" ? packageDoc._id : undefined,
    relatedTransactionId: cashTransaction._id,
    status: "completed",
    relatedPaymentId: payment._id,
  });

  cashTransaction.relatedTransactionId = secondTransaction._id;
  await cashTransaction.save();

  // 3. Update customer balance and billing
  customer.billing = customer.billing || {};
  customer.billing.balance = newBalance;
  customer.billing.lastPaymentDate = now;
  
  // Add a note
  customer.notes.push({
    note: `Cash deposit KES ${payment.amount}. ${extra.reason || "No reason"}. Balance: ${currentBalance} → ${newBalance}`,
    addedBy: extra.adminId,
    addedAt: now,
  });

  // 4. Handle activation if subscription renewal
  if (shouldActivate && customer.pppoe && customer.pppoe.username) {
    const currentExpiry = customer.subscription.expiresAt;
    const baseDate = (isActive && currentExpiry > now) ? currentExpiry : now;
    let newExpiry = calculatePeriodEnd(baseDate, packageDoc.period, packageDoc.periodUnit);
    
    if (customer.freeExtensionDays && customer.freeExtensionDays > 0) {
      const extensionDays = customer.freeExtensionDays;
      newExpiry = new Date(newExpiry);
      newExpiry.setDate(newExpiry.getDate() - extensionDays);
      if (newExpiry < now) newExpiry = now;
      customer.freeExtensionDays = 0;
    }
    
    customer.subscription.expiresAt = newExpiry;
    customer.subscription.status = "active";
    // Optionally set activatedAt if not set
    if (!customer.subscription.activatedAt) customer.subscription.activatedAt = now;
    customer.subscription.packageId = packageDoc._id;
    
    // Renewals array (optional)
    if (!customer.renewals) customer.renewals = [];
    customer.renewals.push({
      dateRenewed: now,
      method: "cash",
      amount: payment.amount,
    });
    
    await customer.save();
    
    // Activate in RADIUS
    const site = await Site.findById(payment.siteId);
    if (site) {
      try {
        const radiusService = require("../services/radiusService");
        const groupName = packageDoc.packageName.replace(/\s+/g, "_").toUpperCase();
        const radiusResult = await radiusService.enableAccount(customer.pppoe.username, groupName);
        if (!radiusResult.success) {
          console.error("RADIUS activation failed:", radiusResult.error);
        } else {
          console.log("RADIUS activated for cash renewal");
        }
      } catch (err) {
        console.error("RADIUS activation error:", err.message);
      }
    }
  } else if (shouldActivate && payment.customerType === "hotspot") {
    // Hotspot activation (if you ever use cash for hotspot)
    customer.activeSession = {
      packageId: packageDoc._id,
      startedAt: now,
      expiresAt: calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit),
      dataLimit: packageDoc.dataLimit,
      dataUsed: 0,
      isActive: true,
    };
    customer.purchaseHistory.push({
      packageId: packageDoc._id,
      purchasedAt: now,
      amount: payment.amount,
      transactionId: cashTransaction._id,
    });
    await customer.save();
  } else {
    // Just save balance update
    await customer.save();
  }

  // 5. Send SMS (optional – you already have mobileSasaService)
  const smsTemplateService = require("../services/smsTemplateService")
if(shouldActivate){
  
  await smsTemplateService.sendUsingTemplate(
    'payment_renewal',
    customer.phoneNumber,
    {
      customerName: `${customer.firstName} ${customer.lastName}`,
      amount: payment.amount,
      expiryDate: newExpiry.toLocaleDateString(),
    },
    { customerId: customer._id, accountId: customer.accountId, type: 'subscription_renewal', regionCode: payment.regionCode }
  );
}else{
  const smsTemplateService = require('../services/smsTemplateService');
// After computing newBalance and before the SMS log
try {
  await smsTemplateService.sendUsingTemplate(
    'payment_wallet',
    customer.phoneNumber,
    {
      customerName: `${customer.firstName} ${customer.lastName}`,
      amount: payment.amount,
      newBalance: newBalance,
    },
    { customerId: customer._id, accountId: customer.accountId, type: 'payment_confirmation', regionCode: payment.regionCode }
  );
} catch (err) {
  console.error('Wallet SMS failed:', err.message);
}
}

  // 6. System log
  await SystemLog.create({
    eventType: shouldActivate ? "subscription_renewal" : "payment_received",
    severity: "info",
    regionCode: payment.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: shouldActivate
      ? `Subscription renewed via cash deposit for ${customer.accountId}`
      : `Cash deposit added to wallet for ${customer.accountId}`,
    details: {
      amount: payment.amount,
      oldBalance: currentBalance,
      newBalance,
      transactionType,
      activated: shouldActivate,
      reason: extra.reason,
    },
    triggeredBy: extra.adminId,
    success: true,
    relatedTransactionId: cashTransaction._id,
    relatedPaymentId: payment._id,
  });

  console.log(`✅ Cash payment processed for ${customer.accountId}`);
}

module.exports = exports;
