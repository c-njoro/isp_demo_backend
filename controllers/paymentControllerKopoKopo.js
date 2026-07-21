const asyncHandler = require("../middleware/asyncHandler");
const { ErrorResponse } = require("../middleware/errorHandler");
const {generateAndSendVouchers} = require("../services/voucherGenerationService");
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
// paymentControllerKopoKopo.js

const crypto = require('crypto');


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
    new Date()
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
  const { customerId, packageId, phoneNumber, channel, amount: customAmount, redirectUrl } = req.body;
  // fetch customer and site
  const customer = await Customer.findById(customerId);
  if (!customer) return next(new ErrorResponse('Customer not found', 404));
  const site = await Site.findById(customer.siteId);
  console.log("Site: ", site)
  const preferredGateway = site?.preferredPaymentGateway || 'kopokopo';

  console.log("Prefered gateway: ", preferredGateway)
  // then call the appropriate function
  if (preferredGateway === 'daraja') {
    // call initiateMpesaPayment with same params
    return initiateMpesaPayment(req, res, next);
  } else {
    // call initiateKopokopoPayment
    return initiateKopokopoPayment(req, res, next);
  }
});


const initiateKopokopoPayment= asyncHandler(async (req, res, next) => {
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

  const preferredGateway = site?.preferredPaymentGateway || 'kopokopo';
  


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
      source: "stk",
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

// ── New M‑Pesa initiation ──────────────────────────────────────
const initiateMpesaPayment = asyncHandler(async (req, res, next) => {
  const {
    customerId,
    packageId,
    phoneNumber,
    amount: customAmount,
  } = req.body;

  console.log("\n💰 [initiateMpesaPayment] Starting M‑Pesa payment...");
  console.log(`   Customer ID: ${customerId}`);
  console.log(`   Package ID: ${packageId}`);
  console.log(`   Phone: ${phoneNumber}`);

  // 1. Validate required fields
  if (!customerId || !packageId || !phoneNumber) {
    return next(new ErrorResponse("Missing required fields (customerId, packageId, phoneNumber)", 400));
  }

  // 2. Fetch customer, site, package
  const customer = await Customer.findById(customerId)
    .populate("subscription.packageId")
    .populate("siteId");
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  const site = customer.siteId;
  if (!site) return next(new ErrorResponse("Site configuration not found", 404));

  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) return next(new ErrorResponse("Package not found", 404));

  const amount = customAmount || packageDoc.price;

  // 3. Validate M‑Pesa credentials on site
  const mpesaConfig = site.payment?.mpesa || {};
  if (!mpesaConfig.consumerKey || !mpesaConfig.consumerSecret || !mpesaConfig.passkey || !mpesaConfig.shortcode) {
    return next(new ErrorResponse("M‑Pesa credentials not configured for this site", 400));
  }

  // 4. Inject credentials into mpesaService singleton
  const mpesaService = require('../services/mpesaService');
  mpesaService.consumerKey = mpesaConfig.consumerKey;
  mpesaService.consumerSecret = mpesaConfig.consumerSecret;
  mpesaService.passkey = mpesaConfig.passkey;
  mpesaService.shortcode = mpesaConfig.shortcode;
  mpesaService.environment = mpesaConfig.environment || 'sandbox';

  // 5. Build callback URL
  const callbackUrl = `${process.env.BASE_URL}/api/payments/mpesa/webhook`;

  try {
    // 6. Initiate STK push
    const result = await mpesaService.initiateSTKPush({
      phoneNumber,
      amount,
      accountReference: customer.accountId,
      callbackUrl,
      transactionDesc: `${packageDoc.packageName} subscription`,
    });

    if (!result.success) {
      return next(new ErrorResponse(result.error || 'M‑Pesa STK push failed', 500));
    }

    console.log("✅ M‑Pesa STK push sent");

    // 7. Create pending payment record
    const payment = await Payment.create({
      customerId: customer._id,
      accountId: customer.accountId,
      customerType: customer.pppoe ? "pppoe" : "hotspot",
      regionCode: customer.regionCode,
      siteId: customer.siteId,
      source: "stk",
      amount,
      paymentMethod: "mpesa",
      status: "pending",
      packageId: packageDoc._id,
      paymentChannel: "mpesa",
      stkID: result.checkoutRequestId,               // primary identifier
      checkoutRequestId: result.checkoutRequestId,
      stkPush: {
        phoneNumber: phoneNumber,
        checkoutRequestId: result.checkoutRequestId,
        merchantRequestId: result.merchantRequestId || null,
        initiatedAt: new Date(),
      },
      metadata: {
        packageId: packageDoc._id,
        packageName: packageDoc.packageName,
        phoneNumber,
        initiatedAt: new Date(),
        gateway: "daraja",
        rawInitResponse: {
          checkoutRequestId: result.checkoutRequestId,
          merchantRequestId: result.merchantRequestId,
          responseCode: result.responseCode,
          responseDescription: result.responseDescription,
          customerMessage: result.customerMessage,
        },
      },
    });

    // 8. System log
    await SystemLog.create({
      eventType: "payment_initiated",
      severity: "info",
      regionCode: customer.regionCode,
      entityType: "payment",
      entityId: payment._id,
      accountId: customer.accountId,
      message: `M‑Pesa STK push of KES ${amount} initiated for ${customer.accountId} (Daraja)`,
      details: {
        amount,
        channel: "mpesa",
        paymentId: payment._id,
        checkoutRequestId: result.checkoutRequestId,
      },
      success: true,
    });

    // 9. Response
    res.status(200).json({
      success: true,
      message: "M‑Pesa STK push sent. Please check your phone.",
      data: {
        paymentId: payment._id,
        amount,
        channel: "mpesa",
        status: "pending",
        checkoutRequestId: result.checkoutRequestId,
      },
    });

  } catch (error) {
    console.error("❌ M‑Pesa initiation error:", error);
    return next(new ErrorResponse("M‑Pesa initiation failed", 500));
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
          let customer = await Customer.findById(payment.customerId);

          if(customer && customer.isChild && customer.shared.expiryWithParent){
            customer = await Customer.findById(customer.parentAccount);
            console.log("It was for a child that shared due date with parent so we keep it in parent");

            payment.customerId = customer._id;
            await payment.save();
          }

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

      if(customer.isChild && customer.shared.expiryWithParent){
        customer = await Customer.findById(customer.parentAccount);
      }


      if (!customer) {
        console.log(`Initial found customer was a child shared account and we could not find the parent account.`);
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
        source: "till",
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


/**
 * @desc    Handle M‑Pesa (Daraja) webhooks (STK push & C2B)
 * @route   POST /api/payments/mpesa/webhook
 * @access  Public
 */
exports.mpesaWebhook = asyncHandler(async (req, res, next) => {
  console.log('📡 [MpesaWebhook] Received body:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200); // Acknowledge immediately

  setImmediate(async () => {
    try {
      const payload = req.body;
      const { Body } = payload;

      // ─── STK Push callback ──────────────────────────────────────────
      if (Body && Body.stkCallback) {
        const stkCallback = Body.stkCallback;
        const resultCode = stkCallback.ResultCode;
        const resultDesc = stkCallback.ResultDesc;
        const checkoutRequestId = stkCallback.CheckoutRequestID;

        // Try to find pending payment by stkID
        const payment = await Payment.findOne({
          stkID: checkoutRequestId,
          status: 'pending'
        });

        // Extract metadata
        const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
        const getItem = (name) => callbackMetadata.find(item => item.Name === name)?.Value;
        const mpesaReceipt = getItem('MpesaReceiptNumber');
        const phone = getItem('PhoneNumber'); // Plain text
        const amount = getItem('Amount');
        const transTime = getItem('TransactionDate');

        // If no pending payment, store as unprocessed
        if (!payment) {
          console.log(`⚠️ No pending payment for CheckoutRequestID: ${checkoutRequestId}`);
          await UnprocessedPayment.create({
            receiptNumber: mpesaReceipt || checkoutRequestId,
            phoneNumber: phone || null,
            amount: amount || null,
            transactionDate: transTime ? new Date(transTime) : new Date(),
            rawData: payload,
            status: 'new',
            tillNumber: null, // STK push doesn't have till number
            accountReference: stkCallback.MerchantRequestID || null,
          });
          return;
        }

        // Update payment with callback data
        payment.callbackReceived = true;
        payment.callbackData = payload;

        if (resultCode === 0) {
          // Success
          payment.status = 'completed';
          payment.mpesaReceiptNumber = mpesaReceipt;
          payment.completedAt = new Date();
          if (phone) payment.stkPush.phoneNumber = phone;
          await payment.save();

          // Process using shared logic
          if (payment.customerType === 'hotspot') {
            await activateHotspotAfterPayment(payment, {
              receiptNumber: mpesaReceipt,
              transactionDate: new Date(),
              phoneNumber: phone,
            });
          } else {
            let customer = await Customer.findById(payment.customerId);

            if (customer && customer.isChild && customer.shared.expiryWithParent) {
              customer = await Customer.findById(customer.parentAccount);
              console.log("Child shares expiry with parent – updating parent.");
              payment.customerId = customer._id;
              await payment.save();
            }

            if (customer) {
              await processSuccessfulPayment(payment, customer, {
                receiptNumber: mpesaReceipt,
                transactionDate: new Date(),
                phoneNumber: phone || payment.metadata?.phoneNumber,
              });
            }
          }
        } else {
          // Failure
          payment.status = 'failed';
          payment.error = { code: resultCode, message: resultDesc };
          await payment.save();
        }
        return;
      }

      // ─── C2B callback (direct till payment) ──────────────────────────
      if (Body && Body.TransID) {
        const transId = Body.TransID;
        const transAmount = parseFloat(Body.TransAmount);
        const transTime = Body.TransTime;
        const msisdn = Body.MSISDN; // hashed phone
        const billRef = Body.BillRefNumber; // account reference
        const businessShortCode = Body.BusinessShortCode; // till / paybill number

        // 1. Check for duplicate
        const alreadyProcessed = await Payment.findOne({ mpesaReceiptNumber: transId });
        if (alreadyProcessed) {
          console.log(`ℹ️ Duplicate C2B receipt ${transId}, ignoring.`);
          return;
        }

        // 2. Find site by till number (BusinessShortCode)
        if (!businessShortCode) {
          console.log(`❌ No BusinessShortCode in C2B webhook, storing as unprocessed.`);
          await UnprocessedPayment.create({
            receiptNumber: transId,
            phoneNumber: msisdn || null,
            amount: transAmount,
            transactionDate: new Date(transTime),
            rawData: payload,
            status: 'new',
            tillNumber: null,
            accountReference: billRef || null,
          });
          return;
        }

        const projectedSite = await Site.findOne({
          $or: [
            { "payment.tillNumber": businessShortCode },
            { "payment.mpesa.shortcode": businessShortCode },
            { "payment.kopokopo.tillNumber": businessShortCode } // fallback if using kopokopo till
          ]
        });

        if (!projectedSite) {
          console.log(`❌ No site found for BusinessShortCode: ${businessShortCode}, storing as unprocessed.`);
          await UnprocessedPayment.create({
            receiptNumber: transId,
            phoneNumber: msisdn || null,
            amount: transAmount,
            transactionDate: new Date(transTime),
            rawData: payload,
            status: 'new',
            tillNumber: businessShortCode,
            accountReference: billRef || null,
          });
          return;
        }

        // 3. Use the hashed phone (MSISDN) to find customer within the site's region
        const hashedPhone = msisdn; // Daraja sends hashed MSISDN for C2B
        let customer = await Customer.findOne({
          hashedPhone: hashedPhone,
          regionCode: projectedSite.regionCode
        });

        if (!customer) {
          customer = await Customer.findOne({
            hashedAlternatePhone: hashedPhone,
            regionCode: projectedSite.regionCode
          });
        }

        if (!customer) {
          console.log(`❌ No customer found for hashed phone in region ${projectedSite.regionCode}, storing as unprocessed.`);
          await UnprocessedPayment.create({
            receiptNumber: transId,
            phoneNumber: hashedPhone,
            amount: transAmount,
            transactionDate: new Date(transTime),
            rawData: payload,
            status: 'new',
            tillNumber: businessShortCode,
            accountReference: billRef || null,
          });
          return;
        }

        // 4. Handle child sharing expiry
        if (customer.isChild && customer.shared.expiryWithParent) {
          customer = await Customer.findById(customer.parentAccount);
          if (!customer) {
            console.log(`❌ Parent not found for child, storing as unprocessed.`);
            await UnprocessedPayment.create({
              receiptNumber: transId,
              phoneNumber: hashedPhone,
              amount: transAmount,
              transactionDate: new Date(transTime),
              rawData: payload,
              status: 'new',
              tillNumber: businessShortCode,
              accountReference: billRef || null,
            });
            return;
          }
        }

        // 5. Check customer has a package
        const packageId = customer.subscription?.packageId;
        if (!packageId) {
          console.error(`❌ Customer ${customer.accountId} has no package assigned.`);
          await UnprocessedPayment.create({
            receiptNumber: transId,
            phoneNumber: null,
            amount: transAmount,
            transactionDate: new Date(transTime),
            rawData: payload,
            status: 'new',
            tillNumber: businessShortCode,
            accountReference: billRef || null,
          });
          return;
        }

        // 6. Create a completed payment record (C2B is final)
        const newPayment = await Payment.create({
          customerId: customer._id,
          accountId: customer.accountId,
          regionCode: customer.regionCode,
          siteId: customer.siteId,
          amount: transAmount,
          paymentMethod: 'mpesa',
          status: 'completed',
          mpesaReceiptNumber: transId,
          customerType: 'pppoe',
          source: 'till',
          packageId,
          stkID: `C2B-${transId}`,
          checkoutRequestId: transId,
          completedAt: new Date(),
          stkPush: {
            phoneNumber: null, // we don't have plain text phone
            initiatedAt: new Date(transTime),
          },
          metadata: {
            packageId,
            phoneNumber: null,
            source: 'c2b_daraja',
            receivedAt: new Date(),
            rawWebhook: payload,
            hashedMsisdn: hashedPhone,
            billRefNumber: billRef,
          },
        });

        // 7. Process the payment
        await processSuccessfulPayment(newPayment, customer, {
          receiptNumber: transId,
          transactionDate: new Date(transTime),
          phoneNumber: hashedPhone
        });

        return;
      }

      console.log('⚠️ Unknown webhook type, ignoring');
    } catch (error) {
      console.error('🔥 [MpesaWebhook] Async error:', error);
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

  // 2. Get package
  const packageId = payment.metadata?.packageId || customer.subscription?.packageId;
  if (!packageId) throw new Error(`No package for ${customer.accountId}`);
  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) throw new Error(`Package ${packageId} not found`);

  // 3. Create MPESA transaction (always)
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

  // 4. Calculate new wallet balance (tentative)
  const currentBalance = customer.billing?.balance || 0;
  const newBalance = currentBalance + payment.amount;

  // 5. Decision logic
  const isActive = customer.subscription?.status === "active" || customer.subscription?.status === "suspended";
  const packagePrice = packageDoc.price;
  let shouldActivateNow = false;
  let waitingFlag = false;

  const radiusService = require("../services/radiusService");

  if (!isActive) {
    const hasActiveSession = await radiusService.hasActiveSession(customer.pppoe.username);
    if (hasActiveSession && newBalance >= packagePrice) {
      shouldActivateNow = true;
      waitingFlag = false;
    } else if (!hasActiveSession && newBalance >= packagePrice) {
      shouldActivateNow = false;
      waitingFlag = true;
    } else {
      shouldActivateNow = false;
      waitingFlag = false;
    }
  }

  // 6. Wallet transaction (always)
  const walletTransaction = await Transaction.create({
    type: "WALLET",
    customerType: "pppoe",
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: payment.amount,
    description: `Funds added to wallet (payment), initial balance: ${currentBalance}, newBalance: ${newBalance}`,
    paymentMethod: payment.paymentMethod || "mpesa",
    relatedTransactionId: mpesaTransaction._id,
    status: "completed",
    relatedPaymentId: payment._id,
  });

  mpesaTransaction.relatedTransactionId = walletTransaction._id;
  await mpesaTransaction.save();

  // ============================================
  // DATABASE UPDATE (direct, to avoid Mongoose issues)
  // ============================================
  const now = new Date();
  let finalBalance = newBalance;
  let subscriptionUpdate = {};

  if (shouldActivateNow) {
    // Deduct package price from balance
    const afterDeduction = newBalance - packagePrice;
    finalBalance = afterDeduction;
    const period = packageDoc.period > 0 ? packageDoc.period : 30;

    let newExpiry = calculatePeriodEnd(now, period, packageDoc.periodUnit);
    if (customer.freeExtensionDays && customer.freeExtensionDays > 0) {
      newExpiry = new Date(newExpiry);
      newExpiry.setDate(newExpiry.getDate() - customer.freeExtensionDays);
      if (newExpiry < now) newExpiry = now;
      // We'll also clear freeExtensionDays in the update
    }

    subscriptionUpdate = {
      'subscription.status': 'active',
      'subscription.activatedAt': now,
      'subscription.expiresAt': newExpiry,
      'subscription.packageId': packageDoc._id,
      'billing.balance': afterDeduction,
      'billing.lastPaymentDate': now,
      waitingForSession: false,
      freeExtensionDays: 0, // reset if we had any
    };

    // Create SUBSCRIPTION transaction
    const subscriptionTransaction = await Transaction.create({
      type: "SUBSCRIPTION",
      customerType: "pppoe",
      customerId: customer._id,
      accountId: customer.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: -packagePrice,
      description: `Subscription activation via payment (immediate)`,
      paymentMethod: payment.paymentMethod || "mpesa",
      packageId: packageDoc._id,
      relatedTransactionId: mpesaTransaction._id,
      status: "completed",
      relatedPaymentId: payment._id,
    });

    await Transaction.findByIdAndDelete(walletTransaction._id);

    mpesaTransaction.relatedTransactionId = subscriptionTransaction._id;
    await mpesaTransaction.save();

    // Enable RADIUS
    const groupName = packageDoc.packageName.replace(/\s+/g, "_").toUpperCase();
    await radiusService.enableAccount(customer.pppoe.username, groupName);
    await radiusService.setBillingCycleStart(customer.pppoe.username, new Date());

    // After enabling RADIUS for parent:
if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
  // Propagate to children that share expiry
  const children = await Customer.find({ _id: { $in: customer.sharedExpiry } }).populate('subscription.packageId');
  for (const child of children) {
    child.subscription.expiresAt = newExpiry; // newExpiry is the parent's new expiry
    child.subscription.status = 'active';
    if (!child.subscription.activatedAt) child.subscription.activatedAt = now;
    await child.save();
    const childGroupName = child.subscription.packageId.packageName.replace(/\s+/g, '_').toUpperCase();
    await radiusService.enableAccount(child.pppoe.username, childGroupName);
    await radiusService.setBillingCycleStart(child.pppoe.username, new Date());
    // Log child activation (optional)
  }
}

const voucherData = {
  customerId: customer._id,
  packageId: '6a311253de22d46f9b16b375',
  voucherAmount: 3,
  createdBy: null,
  regionCode: customer.regionCode,
  rollbackOnSmsFailure: true,
};

try{
await generateAndSendVouchers(voucherData);
}catch(error){
console.log("Could not generate bonus vouchers for customer", error);
}

    console.log(`✅ RADIUS enabled for ${customer.pppoe.username}`);
  } else {
    // No activation – only update balance and waiting flag
    subscriptionUpdate = {
      'billing.balance': newBalance,
      'billing.lastPaymentDate': now,
      waitingForSession: waitingFlag,
    };
  }

  // Apply updates directly to the database
  await Customer.updateOne(
    { _id: customer._id },
    { $set: subscriptionUpdate }
  );

  // Also update the in-memory object for subsequent code (e.g., SMS)
  if (shouldActivateNow) {
    customer.subscription.status = 'active';
    customer.subscription.expiresAt = subscriptionUpdate['subscription.expiresAt'];
    customer.billing.balance = subscriptionUpdate['billing.balance'];
    customer.waitingForSession = false;
    await radiusService.removePendingActivation(customer.pppoe.username); 
  } else {
    customer.billing.balance = subscriptionUpdate['billing.balance'];
    customer.waitingForSession = waitingFlag;
    await radiusService.addPendingActivation(customer.pppoe.username); 
  }
  customer.billing.lastPaymentDate = now;

  // 7. System log
  if (shouldActivateNow) {
    await SystemLog.create({
      eventType: "subscription_renewal",
      severity: "info",
      regionCode: payment.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Subscription activated immediately for ${customer.accountId} (active session)`,
      details: { amount: payment.amount, packagePrice, newBalance: finalBalance, newExpiry: subscriptionUpdate['subscription.expiresAt'] },
      success: true,
    });
  } else {
    await SystemLog.create({
      eventType: "payment_received",
      severity: "info",
      regionCode: payment.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Payment of KES ${payment.amount} added to wallet for ${customer.accountId}${waitingFlag ? ' (waiting for session)' : ''}`,
      details: { amount: payment.amount, newBalance: subscriptionUpdate['billing.balance'], waitingFlag },
      success: true,
    });
  }

  // 8. SMS notification (fire and forget, catch errors)
  const smsTemplateService = require("../services/smsTemplateService");
  try {
    if (shouldActivateNow) {
      await smsTemplateService.sendUsingTemplate(
        'payment_renewal',
        customer.phoneNumber,
        { customerName: `${customer.firstName} ${customer.lastName}`, amount: payment.amount, expiryDate: subscriptionUpdate['subscription.expiresAt']?.toLocaleDateString() || 'N/A' },
        { customerId: customer._id, accountId: customer.accountId, type: 'subscription_renewal', regionCode: payment.regionCode }
      );
    } else {
      await smsTemplateService.sendUsingTemplate(
        'payment_wallet',
        customer.phoneNumber,
        { customerName: `${customer.firstName} ${customer.lastName}`, amount: payment.amount, newBalance: subscriptionUpdate['billing.balance'] },
        { customerId: customer._id, accountId: customer.accountId, type: 'payment_confirmation', regionCode: payment.regionCode }
      );
    }
  } catch (err) {
    console.error('Payment SMS failed:', err.message);
  }

  console.log(`✅ Payment processing completed for ${customer.accountId}`);
}

/**
 * Activate a hotspot user after successful payment
 * @param {Object} payment - Payment document (will be updated to completed)
 * @param {Object} webhookData - { receiptNumber, transactionDate, phoneNumber }
 */
/**
 * Activate a hotspot user after successful payment
 * Handles BOTH new devices (no HotspotUser record yet) and returning/expired users
 *
 * @param {Object} payment     - Payment document (will be updated to completed)
 * @param {Object} webhookData - { receiptNumber, transactionDate, phoneNumber }
 */
async function activateHotspotAfterPayment(payment, webhookData) {
  console.log(`\n🔓 Activating hotspot user after payment: ${payment._id}`);
  const { receiptNumber, transactionDate, phoneNumber } = webhookData;

  // ─── 1. Mark payment completed ───────────────────────────────────────────────
  payment.status       = "completed";
  payment.mpesaReceiptNumber = receiptNumber;
  payment.completedAt  = new Date();
  if (phoneNumber) payment.stkPush = { phoneNumber, completedAt: new Date() };
  await payment.save();

  // ─── 2. Fetch or CREATE HotspotUser ──────────────────────────────────────────
  // For brand-new devices payment.customerId is null (set that way during initiation
  // because the user didn't exist yet). We create the Mongo record here on first pay.
  let hotspotUser = payment.customerId
    ? await HotspotUser.findById(payment.customerId)
    : null;

  if (!hotspotUser) {
    const macAddress = payment.metadata?.macAddress;
    if (!macAddress) throw new Error("No MAC address in payment metadata — cannot create HotspotUser");

    console.log(`🆕 New device — creating HotspotUser for MAC: ${macAddress}`);

    hotspotUser = await HotspotUser.create({
      macAddress:    macAddress.toUpperCase(),
      phoneNumber:   phoneNumber || null,
      regionCode:    payment.regionCode,
      siteId:        payment.siteId,
      isOnline:      false,
      activeSession: { isActive: false },
    });

    // Link the payment back to the new user so future lookups work
    payment.customerId = hotspotUser._id;
    await payment.save();

    console.log(`   ✅ HotspotUser created: ${hotspotUser._id}`);
  }

  // ─── 3. Fetch package ────────────────────────────────────────────────────────
  const packageId  = payment.metadata?.packageId || payment.packageId;
  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) throw new Error(`Package ${packageId} not found`);

  // ─── 4. Create MPESA transaction (credit) ────────────────────────────────────
  const mpesaTransaction = await Transaction.create({
    type:          "MPESA",
    customerType:  "hotspot",
    customerId:    hotspotUser._id,
    accountId:     hotspotUser.macAddress,
    firstName:     "Hotspot",
    lastName:      "User",
    regionCode:    payment.regionCode,
    siteId:        payment.siteId,
    amount:        payment.amount,
    description:   `Hotspot payment via ${payment.paymentMethod || "KopoKopo"}`,
    paymentMethod: payment.paymentMethod || "mpesa",
    mpesa: {
      transactionId:    receiptNumber,
      phoneNumber:      phoneNumber || payment.metadata?.phoneNumber,
      accountReference: payment.kopokopoPaymentId,
      transactionDate:  transactionDate || new Date(),
    },
    status:          "completed",
    relatedPaymentId: payment._id,
  });

  // ─── 5. Calculate expiry ─────────────────────────────────────────────────────
  const now    = new Date();
  const expiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);

  // ─── 6. Update HotspotUser in MongoDB ────────────────────────────────────────
  hotspotUser.activeSession = {
    packageId: packageDoc._id,
    startedAt: now,
    expiresAt: expiry,
    isActive:  true,
    dataLimit: packageDoc.dataLimit || null,
    dataUsed:  0,
  };
  hotspotUser.phoneNumber    = phoneNumber || hotspotUser.phoneNumber;
  hotspotUser.paymentCounter = (hotspotUser.paymentCounter || 0) + 1;
  hotspotUser.purchaseHistory.push({
    packageId:     packageDoc._id,
    purchasedAt:   now,
    amount:        payment.amount,
    transactionId: mpesaTransaction._id,
  });
  // Keep purchase history to last 20 entries
  if (hotspotUser.purchaseHistory.length > 20) {
    hotspotUser.purchaseHistory = hotspotUser.purchaseHistory.slice(-20);
  }

  hotspotUser.kickedAt = null;
  await hotspotUser.save();

  // ─── 7. RADIUS: create or enable account ─────────────────────────────────────
  const radiusService = require("../services/radiusService");
  const groupName     = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
  const username      = `hs_${hotspotUser.macAddress.replace(/[:-]/g, '')}`;

  try{
    const conn   = await radiusService.getConnection();
    await conn.query('DELETE FROM radcheck WHERE username = ?', [username]);
    await conn.query('DELETE FROM radusergroup WHERE username = ?', [username]);
    await conn.query('DELETE FROM radreply WHERE username = ?', [username]);
    await conn.query('DELETE FROM user_billing_cycle WHERE username = ?', [username]);
    await conn.query('DELETE FROM radacct WHERE username = ? AND acctstoptime IS NOT NULL', [username]);
    conn.release();
  }catch{
    console.error("⚠️ RADIUS deletion error:", e.message);
  }


  

  let radiusResult;
 
    // Brand-new device — full account creation
    const dataLimitMB = packageDoc.dataLimit ||
      (packageDoc.fup?.enabled ? (packageDoc.fup.dataThresholdGB * 1024) : null);

    radiusResult = await radiusService.createHotspotAccount(
      hotspotUser.macAddress,
      groupName,
      dataLimitMB,
      expiry
    );
    if (!radiusResult.success) {
      console.error("❌ RADIUS creation failed:", radiusResult.error);
      throw new Error("RADIUS account creation failed");
    }
    console.log(`   ✅ RADIUS account created: ${username}`);
  

try{
  const mac = hotspotUser.macAddress;
  let nasIp = payment.metadata?.nasIp;
  const router = await Router.findOne({ ip: nasIp });
  if(!router){
    console.error("Could not find the router to kick out customer.");
    return;
  }
  const mikroticService = require("../services/mikroticService")
await mikroticService.kickHotspotUser({ router }, mac);
}catch{
console.error("Could not kick session out")
}


  // ─── 10. Subscription transaction (debit) ────────────────────────────────────
  const secondaryTransaction = await Transaction.create({
    type:               "SUBSCRIPTION",
    customerType:       "hotspot",
    customerId:         hotspotUser._id,
    accountId:          hotspotUser.macAddress,
    firstName:          "Hotspot",
    lastName:           "User",
    regionCode:         payment.regionCode,
    siteId:             payment.siteId,
    amount:             -packageDoc.price,
    description:        `Hotspot activation — ${packageDoc.packageName}`,
    paymentMethod:      payment.paymentMethod || "mpesa",
    packageId:          packageDoc._id,
    relatedTransactionId: mpesaTransaction._id,
    status:             "completed",
    relatedPaymentId:   payment._id,
  });

  mpesaTransaction.relatedTransactionId = secondaryTransaction._id;
  await mpesaTransaction.save();

  // ─── 12. System log ──────────────────────────────────────────────────────────
  await SystemLog.create({
    eventType:  "hotspot_activation",
    severity:   "info",
    regionCode: payment.regionCode,
    entityType: "hotspot_user",
    entityId:   hotspotUser._id,
    accountId:  hotspotUser.macAddress,
    message:    `Hotspot ${hotspotUser.macAddress} activated — ${packageDoc.packageName} until ${expiry.toISOString()}`,
    details: {
      amount:      payment.amount,
      receipt:     receiptNumber,
      packageName: packageDoc.packageName,
      expiresAt:   expiry,
      username,
      isNewUser:   !payment.customerId, // was it a brand-new device?
      activatedFrom: "payment_webhook",
    },
    success:              true,
    relatedTransactionId: mpesaTransaction._id,
    relatedPaymentId:     payment._id,
  });

  console.log(`   ✅ Hotspot user fully activated: ${username} until ${expiry.toISOString()}`);
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

  const transactions = await Transaction.find({ customerId: customerId, type: { $nin: ['MPESA', 'MOVED_PAYMENT', 'CASH_DEPOSIT'] } })
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
    const unprocessedConfirm = await UnprocessedPayment.findOne({
      receiptNumber
    });

    if(unprocessedConfirm.status === 'new'){
      unprocessedConfirm.status = "matched";
      unprocessedConfirm.matchedWith = {
        type: payment.customerType === 'pppoe' ? "Customer" : "Lead",
        id: payment.customerType === 'pppoe' ? payment.customerId : payment.leadId,
      };
    }

    await unprocessedConfirm.save();
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

  if(customer.isChild && customer.shared.expiryWithParent){
    return next(new ErrorResponse("Customer is a child who shares expiry with parent, resolve to parent instead.", 404));
  }

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

  unprocessed.status = "matched";
  unprocessed.matchedWith = {
    type: "Customer",
    id: customer._id,
  };
  
  await unprocessed.save();

  await processManualPayment(payment, {
    amount: unprocessed.amount,
    phoneNumber: unprocessed.phoneNumber,
    transactionDate: unprocessed.transactionDate,
  });



  res.json({
    success: true,
    message: "Payment resolved and processed",
    data: payment,
  });
});

async function processManualPayment(payment, mpesaData) {
  console.log("⚙️ [processManualPayment] Starting for payment:", payment._id);
  const customer = await Customer.findById(payment.customerId).populate("subscription.packageId");
  const packageDoc = await Package.findById(payment.packageId);
  if (!customer || !packageDoc) throw new Error("Customer or Package not found");

  const currentBalance = customer.billing?.balance || 0;
  const newBalance = currentBalance + payment.amount;
  const now = new Date();
  const isActive = customer.subscription?.status === "active" || customer.subscription?.status === "suspended";
  const packagePrice = packageDoc.price;
  let shouldActivateNow = false;
  let waitingFlag = false;

  const radiusService = require("../services/radiusService");

  if (!isActive) {
    const hasActiveSession = await radiusService.hasActiveSession(customer.pppoe.username);
    if (hasActiveSession && newBalance >= packagePrice) {
      shouldActivateNow = true;
      waitingFlag = false;
    } else if (!hasActiveSession && newBalance >= packagePrice) {
      shouldActivateNow = false;
      waitingFlag = true;
    }
  }

  // Create MPESA transaction (for audit)
  const mpesaTransaction = await Transaction.create({
    type: "MPESA",
    customerType: "pppoe",
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
    relatedPaymentId: payment._id,
  });

  // Wallet transaction (always)
  const walletTransaction = await Transaction.create({
    type: "WALLET",
    customerType: "pppoe",
    customerId: customer._id,
    accountId: payment.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: payment.amount,
    description: `Funds added to wallet (manual resolution), initialBalance: ${currentBalance}, newBalance: ${newBalance}`,
    paymentMethod: "mpesa",
    relatedTransactionId: mpesaTransaction._id,
    status: "completed",
    relatedPaymentId: payment._id,
  });
  mpesaTransaction.relatedTransactionId = walletTransaction._id;
  await mpesaTransaction.save();

  // Prepare database update
  let subscriptionUpdate = {};
  if (shouldActivateNow) {
    const afterDeduction = newBalance - packagePrice;
    let newExpiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);
    if (customer.freeExtensionDays && customer.freeExtensionDays > 0) {
      newExpiry = new Date(newExpiry);
      newExpiry.setDate(newExpiry.getDate() - customer.freeExtensionDays);
      if (newExpiry < now) newExpiry = now;
    }
    subscriptionUpdate = {
      'subscription.status': 'active',
      'subscription.activatedAt': now,
      'subscription.expiresAt': newExpiry,
      'subscription.packageId': packageDoc._id,
      'billing.balance': afterDeduction,
      'billing.lastPaymentDate': now,
      waitingForSession: false,
      freeExtensionDays: 0,
    };
    if (!customer.renewals) customer.renewals = [];
    // We'll push renewal later after update (or we can push via direct update, but simpler to do after)
  } else {
    subscriptionUpdate = {
      'billing.balance': newBalance,
      'billing.lastPaymentDate': now,
      waitingForSession: waitingFlag,
    };
  }

  // Apply direct update to database
  await Customer.updateOne({ _id: customer._id }, { $set: subscriptionUpdate });

  // Update in-memory customer for further use (logs, SMS)
  if (shouldActivateNow) {
    customer.subscription.status = 'active';
    customer.subscription.expiresAt = subscriptionUpdate['subscription.expiresAt'];
    customer.billing.balance = subscriptionUpdate['billing.balance'];
    customer.waitingForSession = false;
    await radiusService.removePendingActivation(customer.pppoe.username); 
    // Add renewal record
    if (!customer.renewals) customer.renewals = [];
    customer.renewals.push({ dateRenewed: now, method: "manual", amount: payment.amount });
    // Create SUBSCRIPTION transaction
    const subscriptionTransaction = await Transaction.create({
      type: "SUBSCRIPTION",
      customerType: "pppoe",
      customerId: customer._id,
      accountId: payment.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: -packagePrice,
      description: `Subscription activated via manual resolution (immediate)`,
      paymentMethod: "mpesa",
      packageId: packageDoc._id,
      relatedTransactionId: mpesaTransaction._id,
      status: "completed",
      relatedPaymentId: payment._id,
    });

    await Transaction.findByIdAndDelete(walletTransaction._id);
    mpesaTransaction.relatedTransactionId = subscriptionTransaction._id;
    await mpesaTransaction.save();


    // Enable RADIUS
    const groupName = packageDoc.packageName.replace(/\s+/g, "_").toUpperCase();
    await radiusService.enableAccount(customer.pppoe.username, groupName);
    await radiusService.setBillingCycleStart(customer.pppoe.username, new Date());

    if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
      // Propagate to children that share expiry
      const children = await Customer.find({ _id: { $in: customer.sharedExpiry } }).populate('subscription.packageId');
      for (const child of children) {
        child.subscription.expiresAt = newExpiry; // newExpiry is the parent's new expiry
        child.subscription.status = 'active';
        if (!child.subscription.activatedAt) child.subscription.activatedAt = now;
        await child.save();
        const childGroupName = child.subscription.packageId.packageName.replace(/\s+/g, '_').toUpperCase();
        await radiusService.enableAccount(child.pppoe.username, childGroupName);
        await radiusService.setBillingCycleStart(child.pppoe.username, new Date());
        // Log child activation (optional)
      }
    }


    const voucherData = {
      customerId: customer._id,
      packageId: '6a311253de22d46f9b16b375',
      voucherAmount: 3,
      createdBy: null,
      regionCode: customer.regionCode,
      rollbackOnSmsFailure: true,
    };

    try{
await generateAndSendVouchers(voucherData);
}catch(error){
console.log("Could not generate bonus vouchers for customer", error);
}
  } else {
    customer.billing.balance = subscriptionUpdate['billing.balance'];
    customer.waitingForSession = waitingFlag;
    await radiusService.addPendingActivation(customer.pppoe.username); 
  }
  customer.billing.lastPaymentDate = now;

  // System log
  if (shouldActivateNow) {
    await SystemLog.create({
      eventType: "subscription_renewal",
      severity: "info",
      regionCode: payment.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: payment.accountId,
      message: `Subscription activated via manual resolution (active session)`,
      details: { amount: payment.amount, packagePrice, newBalance: customer.billing.balance, newExpiry: subscriptionUpdate['subscription.expiresAt'] },
      success: true,
    });
  } else {
    await SystemLog.create({
      eventType: "payment_received",
      severity: "info",
      regionCode: payment.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: payment.accountId,
      message: `Manual resolution payment added to wallet for ${payment.accountId}${waitingFlag ? ' (waiting for session)' : ''}`,
      details: { amount: payment.amount, newBalance: subscriptionUpdate['billing.balance'], waitingFlag },
      success: true,
    });
  }

  // SMS (fire and forget)
  const smsTemplateService = require("../services/smsTemplateService");
  try {
    if (shouldActivateNow) {
      await smsTemplateService.sendUsingTemplate(
        'payment_renewal',
        customer.phoneNumber,
        { customerName: `${customer.firstName} ${customer.lastName}`, amount: payment.amount, expiryDate: customer.subscription.expiresAt.toLocaleDateString() },
        { customerId: customer._id, accountId: customer.accountId, type: 'subscription_renewal', regionCode: payment.regionCode }
      );
    } else {
      await smsTemplateService.sendUsingTemplate(
        'payment_wallet',
        customer.phoneNumber,
        { customerName: `${customer.firstName} ${customer.lastName}`, amount: payment.amount, newBalance: customer.billing.balance },
        { customerId: customer._id, accountId: customer.accountId, type: 'payment_confirmation', regionCode: payment.regionCode }
      );
    }
  } catch (err) {
    console.log("SMS not sent:", err.message);
  }
}


/**
 * @desc    Move/Transfer payment from one customer to another
 * @route   POST /api/payments/:paymentId/move
 * @access  Private (Admin only)
 *
 * 1. Deduct the payment amount from the source customer's balance.
 * 2. If the source was using that payment to stay active, recalc their status.
 * 3. Create a new payment for the target and process it.
 * 4. Delete the original payment and its associated transactions.
 */
exports.movePayment = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;
  const { targetCustomerId, reason } = req.body;

  if (!targetCustomerId) return next(new ErrorResponse("Target customer ID required", 400));
  if (!reason) return next(new ErrorResponse("Reason required", 400));

  const originalPayment = await Payment.findById(paymentId);
  if (!originalPayment) return next(new ErrorResponse("Payment not found", 404));
  if (originalPayment.status !== "completed")
    return next(new ErrorResponse("Only completed payments can be moved", 400));

  const sourceCustomer = await Customer.findById(originalPayment.customerId).populate("subscription.packageId");
  const targetCustomer = await Customer.findById(targetCustomerId).populate("subscription.packageId");
  if (!sourceCustomer || !targetCustomer)
    return next(new ErrorResponse("Customer not found", 404));


  if(targetCustomer.isChild && targetCustomer.shared.expiryWithParent){
    return next(new ErrorResponse("This child shares due date with parent, deposit to parent instead.", 400));
  }

  if (sourceCustomer._id.toString() === targetCustomer._id.toString())
    return next(new ErrorResponse("Cannot move to same customer", 400));

  // ---- 1. Find original MPESA transaction and secondary transaction ----
  const mpesaTxn = await Transaction.findOne({
    $or: [
      { "mpesa.transactionId": originalPayment.mpesaReceiptNumber, type: { $in: ["MPESA", "CASH_DEPOSIT"] } },
      { type: "MOVED_PAYMENT", relatedPaymentId: originalPayment._id }
    ]
  });
  let secondaryTxn;
  let wasSubscription = false;
  let sourcePackagePrice = 0;
  if (mpesaTxn) {
    secondaryTxn = await Transaction.findOne({ relatedTransactionId: mpesaTxn._id, type: { $in: ["SUBSCRIPTION", "WALLET"] } });
    if (secondaryTxn) {
      wasSubscription = secondaryTxn.type === "SUBSCRIPTION";
      if (wasSubscription && secondaryTxn.packageId) {
        const pkg = await Package.findById(secondaryTxn.packageId);
        if (pkg) sourcePackagePrice = pkg.price;
      }
    }
  }

  const paymentAmount = originalPayment.amount;
  const now = new Date();

  // ---- 2. Reverse the effect on the source customer ----
  if (wasSubscription) {
    // Payment was used to activate/renew – revert to expired
    const remainder = paymentAmount - sourcePackagePrice;
    sourceCustomer.subscription.status = "expired";
    sourceCustomer.subscription.expiresAt = now; // immediate expiry
    if (remainder > 0) {
      sourceCustomer.billing.balance -= remainder;
      if (sourceCustomer.billing.balance < 0) sourceCustomer.billing.balance = 0;
    }
    await sourceCustomer.save();

    // Disable RADIUS
    try {
      const radiusService = require("../services/radiusService");
      await radiusService.disableAccount(sourceCustomer.pppoe.username);
    } catch (err) {
      console.error("RADIUS disable failed:", err.message);
    }
  } else {
    // Wallet top‑up – subtract the full amount
    sourceCustomer.billing.balance -= paymentAmount;
    if (sourceCustomer.billing.balance < 0) sourceCustomer.billing.balance = 0;
    await sourceCustomer.save();
  }

  // ---- 3. Delete the original payment's linked transactions ----

  if(secondaryTxn && secondaryTxn._id){
    await Transaction.findByIdAndDelete(secondaryTxn._id)
  }
  if (mpesaTxn) {
    await Transaction.findByIdAndDelete(mpesaTxn._id)
  }

  // ---- 4. Create a new payment for the target (but do NOT delete original yet) ----
  const newPaymentData = {
    customerId: targetCustomer._id,
    accountId: targetCustomer.accountId,
    amount: paymentAmount,
    paymentMethod: originalPayment.paymentMethod,
    status: "completed",
    completedAt: new Date(),
    source: "payment_transfer",
    mpesaReceiptNumber: originalPayment.mpesaReceiptNumber,
    stkID: `TRANSFER-${Date.now()}`,
    checkoutRequestId: `TRANSFER-${Date.now()}`,
    customerType: "pppoe",
    regionCode: targetCustomer.regionCode,
    siteId: targetCustomer.siteId,
    packageId: targetCustomer.subscription?.packageId,
    metadata: {
      transferredFrom: {
        customerId: sourceCustomer._id,
        accountId: sourceCustomer.accountId,
        originalPaymentId: originalPayment._id,
      },
      reason,
    },
  };

  const newPayment = await Payment.create(newPaymentData);

  // ---- 5. Apply the payment to the target (wallet + possible activation) ----
  await processSuccessfulPaymentForTransfer(newPayment, targetCustomer, {
    receiptNumber: originalPayment.mpesaReceiptNumber,
    transactionDate: new Date(),
    phoneNumber: originalPayment.stkPush?.phoneNumber || targetCustomer.phoneNumber,
  });

  // ---- 6. NOW delete the original payment (after success) ----
  await originalPayment.deleteOne();

  // ---- 7. Log the transfer ----
  await SystemLog.create({
    eventType: "payment_transferred",
    severity: "info",
    regionCode: targetCustomer.regionCode,
    entityType: "payment",
    entityId: newPayment._id,
    message: `Payment KES ${paymentAmount} moved from ${sourceCustomer.accountId} to ${targetCustomer.accountId}. Source ${wasSubscription ? "expired" : "balance reduced"}.`,
    details: {
      originalPaymentId: originalPayment._id,
      newPaymentId: newPayment._id,
      amount: paymentAmount,
      fromCustomer: sourceCustomer.accountId,
      toCustomer: targetCustomer.accountId,
      reason,
      sourceNewBalance: sourceCustomer.billing.balance,
      sourceStatus: sourceCustomer.subscription.status,
    },
    triggeredBy: req.user?.id || req.session?.userId,
    success: true,
  });

  sourceCustomer.notes.push({
    note: `Payment ${newPaymentData.mpesaReceiptNumber ? `${newPaymentData.mpesaReceiptNumber}` : "RECEIPT_N/A" } moved from this account to ${targetCustomer.accountId}`,
    addedBy: req.session.userId,
    addedAt: new Date(),
  });

  targetCustomer.notes.push({
    note: `Payment: ${newPaymentData.mpesaReceiptNumber ? `${newPaymentData.mpesaReceiptNumber}` : "RECEIPT_N/A" } received by moving from ${sourceCustomer.accountId}`,
    addedBy: req.session.userId,
    addedAt: new Date(),
  });

  await sourceCustomer.save();
  await targetCustomer.save();

  res.json({
    success: true,
    message: `Payment of KES ${paymentAmount} moved to ${targetCustomer.accountId}`,
    data: {
      source: {
        customerId: sourceCustomer._id,
        accountId: sourceCustomer.accountId,
        newBalance: sourceCustomer.billing.balance,
        status: sourceCustomer.subscription.status,
      },
      target: {
        customerId: targetCustomer._id,
        accountId: targetCustomer.accountId,
        newPaymentId: newPayment._id,
      },
    },
  });
});

/**
 * Helper: Apply a completed payment to a customer
 * (same logic as processSuccessfulPayment without creating extra MPESA tx)
 */
async function processSuccessfulPaymentForTransfer(payment, customer, webhookData) {
  const { receiptNumber, transactionDate, phoneNumber } = webhookData;

  const packageDoc = await Package.findById(customer.subscription.packageId);
  if (!packageDoc) throw new Error("Customer has no package");

  const currentBalance = customer.billing?.balance || 0;
  const newBalance = currentBalance + payment.amount;
  const now = new Date();
  const isActive = customer.subscription?.status === "active" || customer.subscription?.status === "suspended";
  const packagePrice = packageDoc.price;
  let shouldActivateNow = false;
  let waitingFlag = false;

  const radiusService = require("../services/radiusService");

  if (!isActive) {
    const hasActiveSession = await radiusService.hasActiveSession(customer.pppoe.username);
    if (hasActiveSession && newBalance >= packagePrice) {
      shouldActivateNow = true;
      waitingFlag = false;
    } else if (!hasActiveSession && newBalance >= packagePrice) {
      shouldActivateNow = false;
      waitingFlag = true;
    }
  }

  // Create MPESA transaction (record of transferred payment)
  const mpesaTransaction = await Transaction.create({
    type: "MOVED_PAYMENT",
    customerType: "pppoe",
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: payment.amount,
    description: `Payment transferred - ${receiptNumber}`,
    paymentMethod: "mpesa",
    mpesa: {
      transactionId: receiptNumber,
      phoneNumber: phoneNumber || customer.phoneNumber,
      accountReference: payment.stkID,
      transactionDate: transactionDate || now,
    },
    status: "completed",
    relatedPaymentId: payment._id,
  });

  // Wallet transaction
  const walletTransaction = await Transaction.create({
    type: "WALLET",
    customerType: "pppoe",
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: payment.amount,
    description: `Funds added to wallet (payment transfer), initialBalance: ${currentBalance}, newBalance: ${newBalance}`,
    paymentMethod: "mpesa",
    relatedTransactionId: mpesaTransaction._id,
    status: "completed",
    relatedPaymentId: payment._id,
  });
  mpesaTransaction.relatedTransactionId = walletTransaction._id;
  await mpesaTransaction.save();

  // Prepare database update
  let subscriptionUpdate = {};
  if (shouldActivateNow) {
    const afterDeduction = newBalance - packagePrice;
    let newExpiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);
    if (customer.freeExtensionDays && customer.freeExtensionDays > 0) {
      newExpiry = new Date(newExpiry);
      newExpiry.setDate(newExpiry.getDate() - customer.freeExtensionDays);
      if (newExpiry < now) newExpiry = now;
    }
    subscriptionUpdate = {
      'subscription.status': 'active',
      'subscription.activatedAt': now,
      'subscription.expiresAt': newExpiry,
      'subscription.packageId': packageDoc._id,
      'billing.balance': afterDeduction,
      'billing.lastPaymentDate': now,
      waitingForSession: false,
      freeExtensionDays: 0,
    };
  } else {
    subscriptionUpdate = {
      'billing.balance': newBalance,
      'billing.lastPaymentDate': now,
      waitingForSession: waitingFlag,
    };
  }

  // Apply direct update
  await Customer.updateOne({ _id: customer._id }, { $set: subscriptionUpdate });

  // Update in-memory object
  if (shouldActivateNow) {
    customer.subscription.status = 'active';
    customer.subscription.expiresAt = subscriptionUpdate['subscription.expiresAt'];
    customer.billing.balance = subscriptionUpdate['billing.balance'];
    customer.waitingForSession = false;
    await radiusService.removePendingActivation(customer.pppoe.username); 
    if (!customer.renewals) customer.renewals = [];
    customer.renewals.push({ dateRenewed: now, method: "transfer", amount: payment.amount });
    // Create SUBSCRIPTION transaction
    const subscriptionTransaction = await Transaction.create({
      type: "SUBSCRIPTION",
      customerType: "pppoe",
      customerId: customer._id,
      accountId: customer.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: -packagePrice,
      description: `Subscription activation via payment transfer (immediate)`,
      paymentMethod: "mpesa",
      packageId: packageDoc._id,
      relatedTransactionId: mpesaTransaction._id,
      status: "completed",
      relatedPaymentId: payment._id,
    });

    await Transaction.findByIdAndDelete(walletTransaction._id);

    mpesaTransaction.relatedTransactionId = subscriptionTransaction._id;
    await mpesaTransaction.save();

    // Enable RADIUS
    const groupName = packageDoc.packageName.replace(/\s+/g, "_").toUpperCase();
    await radiusService.enableAccount(customer.pppoe.username, groupName);
    await radiusService.setBillingCycleStart(customer.pppoe.username, new Date());

    if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
      // Propagate to children that share expiry
      const children = await Customer.find({ _id: { $in: customer.sharedExpiry } }).populate('subscription.packageId');
      for (const child of children) {
        child.subscription.expiresAt = newExpiry; // newExpiry is the parent's new expiry
        child.subscription.status = 'active';
        if (!child.subscription.activatedAt) child.subscription.activatedAt = now;
        await child.save();
        const childGroupName = child.subscription.packageId.packageName.replace(/\s+/g, '_').toUpperCase();
        await radiusService.enableAccount(child.pppoe.username, childGroupName);
        await radiusService.setBillingCycleStart(child.pppoe.username, new Date());
        // Log child activation (optional)
      }
    }

    const voucherData = {
      customerId: customer._id,
      packageId: '6a311253de22d46f9b16b375',
      voucherAmount: 3,
      createdBy: null,
      regionCode: customer.regionCode,
      rollbackOnSmsFailure: true,
    };

    try{
await generateAndSendVouchers(voucherData);
}catch(error){
console.log("Could not generate bonus vouchers for customer", error);
}
  } else {
    customer.billing.balance = subscriptionUpdate['billing.balance'];
    customer.waitingForSession = waitingFlag;
    await radiusService.addPendingActivation(customer.pppoe.username); 
  }
  customer.billing.lastPaymentDate = now;

  // System log
  if (shouldActivateNow) {
    await SystemLog.create({
      eventType: "subscription_renewal",
      severity: "info",
      regionCode: payment.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Subscription activated via payment transfer (active session)`,
      details: { amount: payment.amount, packagePrice, newBalance: customer.billing.balance, newExpiry: subscriptionUpdate['subscription.expiresAt'] },
      success: true,
    });
  } else {
    await SystemLog.create({
      eventType: "payment_received",
      severity: "info",
      regionCode: payment.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Payment transfer added to wallet for ${customer.accountId}${waitingFlag ? ' (waiting for session)' : ''}`,
      details: { amount: payment.amount, newBalance: customer.billing.balance, waitingFlag },
      success: true,
    });
  }

  // SMS (commented out as in original)
  // ...
}

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





/**
 * @desc    Manual cash deposit (follows same logic as M-Pesa payment)
 * @route   POST /api/payments/deposit
 * @access  Private (Admin only)
 */
exports.depositCash = asyncHandler(async (req, res, next) => {
  const { customerId, amount, notes, reason, receipt, paymentMethod } = req.body;

  if (!customerId || !amount || amount <= 0 || !paymentMethod) {
    return next(new ErrorResponse("Customer ID and positive amount are required", 400));
  }


  
  if(receipt){
    const normalizedReceipt = receipt.trim().toUpperCase();
    const alreadyDeposited = await Payment.findOne({mpesaReceiptNumber: normalizedReceipt});
    if(alreadyDeposited){
      return next(new ErrorResponse("This mpesa code already exists.", 400));
    }
  }

  const customer = await Customer.findById(customerId).populate("subscription.packageId");
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  if(customer.isChild && customer.shared.expiryWithParent){
    return next(new ErrorResponse("This child shares due date with parent, deposit to parent instead.", 400));
  }

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
    stkID: `${customer._id}-${Date.now()}`,
    checkoutRequestId: `${customer._id}-${Date.now()}`,
    amount,
    paymentMethod: paymentMethod,
    mpesaReceiptNumber: receipt || null,
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
  const newBalance = currentBalance + payment.amount;
  const isActive = customer.subscription?.status === "active" || customer.subscription?.status === "suspended";
  const packagePrice = packageDoc.price;
  let shouldActivateNow = false;
  let waitingFlag = false;

  const radiusService = require("../services/radiusService");

  if (!isActive) {
    const hasActiveSession = await radiusService.hasActiveSession(customer.pppoe.username);
    if (hasActiveSession && newBalance >= packagePrice) {
      shouldActivateNow = true;
      waitingFlag = false;
    } else if (!hasActiveSession && newBalance >= packagePrice) {
      shouldActivateNow = false;
      waitingFlag = true;
    }
  }

  // Cash deposit transaction
  const cashTransaction = await Transaction.create({
    type: "CASH_DEPOSIT",
    customerType: "pppoe",
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
    metadata: { depositedBy: extra.adminId, notes: extra.notes },
  });

  // Wallet transaction
  const walletTransaction = await Transaction.create({
    type: "WALLET",
    customerType: "pppoe",
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: payment.regionCode,
    siteId: payment.siteId,
    amount: payment.amount,
    description: `Funds added to wallet (cash deposit), initialBalance: ${currentBalance}, newBalance: ${newBalance}`,
    paymentMethod: "cash",
    relatedTransactionId: cashTransaction._id,
    status: "completed",
    relatedPaymentId: payment._id,
  });
  cashTransaction.relatedTransactionId = walletTransaction._id;
  await cashTransaction.save();

  // Prepare database update
  let subscriptionUpdate = {};
  if (shouldActivateNow) {
    const afterDeduction = newBalance - packagePrice;
    let newExpiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);
    if (customer.freeExtensionDays && customer.freeExtensionDays > 0) {
      newExpiry = new Date(newExpiry);
      newExpiry.setDate(newExpiry.getDate() - customer.freeExtensionDays);
      if (newExpiry < now) newExpiry = now;
    }
    subscriptionUpdate = {
      'subscription.status': 'active',
      'subscription.activatedAt': now,
      'subscription.expiresAt': newExpiry,
      'subscription.packageId': packageDoc._id,
      'billing.balance': afterDeduction,
      'billing.lastPaymentDate': now,
      waitingForSession: false,
      freeExtensionDays: 0,
    };
  } else {
    subscriptionUpdate = {
      'billing.balance': newBalance,
      'billing.lastPaymentDate': now,
      waitingForSession: waitingFlag,
    };
  }

  // Apply direct update
  await Customer.updateOne({ _id: customer._id }, { $set: subscriptionUpdate });

  // Update in-memory object for logs/SMS
  if (shouldActivateNow) {
    customer.subscription.status = 'active';
    customer.subscription.expiresAt = subscriptionUpdate['subscription.expiresAt'];
    customer.billing.balance = subscriptionUpdate['billing.balance'];
    customer.waitingForSession = false;
    await radiusService.removePendingActivation(customer.pppoe.username); 
    if (!customer.renewals) customer.renewals = [];
    customer.renewals.push({ dateRenewed: now, method: "cash", amount: payment.amount });
    // Create SUBSCRIPTION transaction
    const subscriptionTransaction = await Transaction.create({
      type: "SUBSCRIPTION",
      customerType: "pppoe",
      customerId: customer._id,
      accountId: customer.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: -packagePrice,
      description: `Subscription renewal via cash deposit (immediate)`,
      paymentMethod: "cash",
      packageId: packageDoc._id,
      relatedTransactionId: cashTransaction._id,
      status: "completed",
      relatedPaymentId: payment._id,
    });

    await Transaction.findByIdAndDelete(walletTransaction._id);

    cashTransaction.relatedTransactionId = subscriptionTransaction._id;
    await cashTransaction.save();


    // Enable RADIUS
    const groupName = packageDoc.packageName.replace(/\s+/g, "_").toUpperCase();
    await radiusService.enableAccount(customer.pppoe.username, groupName);
    await radiusService.setBillingCycleStart(customer.pppoe.username, new Date());
    

    if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
      // Propagate to children that share expiry
      const children = await Customer.find({ _id: { $in: customer.sharedExpiry } }).populate('subscription.packageId');
      for (const child of children) {
        child.subscription.expiresAt = newExpiry; // newExpiry is the parent's new expiry
        child.subscription.status = 'active';
        if (!child.subscription.activatedAt) child.subscription.activatedAt = now;
        await child.save();
        const childGroupName = child.subscription.packageId.packageName.replace(/\s+/g, '_').toUpperCase();
        await radiusService.enableAccount(child.pppoe.username, childGroupName);
        await radiusService.setBillingCycleStart(child.pppoe.username, new Date());
        // Log child activation (optional)
      }
    }

    const voucherData = {
      customerId: customer._id,
      packageId: '6a311253de22d46f9b16b375',
      voucherAmount: 3,
      createdBy: null,
      regionCode: customer.regionCode,
      rollbackOnSmsFailure: true,
    };

    try{
await generateAndSendVouchers(voucherData);
}catch(error){
console.log("Could not generate bonus vouchers for customer", error);
}

   
  } else {
    customer.billing.balance = subscriptionUpdate['billing.balance'];
    customer.waitingForSession = waitingFlag;
    await radiusService.addPendingActivation(customer.pppoe.username); 
    // Add a note for cash deposit
    customer.notes.push({
      note: `Cash deposit KES ${payment.amount}. ${extra.reason || "No reason"}. Balance: ${currentBalance} → ${newBalance}`,
      addedBy: extra.adminId,
      addedAt: now,
    });
  }
  customer.billing.lastPaymentDate = now;

  // System log
  if (shouldActivateNow) {
    await SystemLog.create({
      eventType: "subscription_renewal",
      severity: "info",
      regionCode: payment.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Subscription renewed via cash deposit (active session)`,
      details: { amount: payment.amount, packagePrice, newBalance: customer.billing.balance, newExpiry: subscriptionUpdate['subscription.expiresAt'] },
      success: true,
    });
  } else {
    await SystemLog.create({
      eventType: "payment_received",
      severity: "info",
      regionCode: payment.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Cash deposit added to wallet for ${customer.accountId}${waitingFlag ? ' (waiting for session)' : ''}`,
      details: { amount: payment.amount, newBalance: customer.billing.balance, waitingFlag },
      success: true,
    });
  }

  // SMS
  const smsTemplateService = require("../services/smsTemplateService");
  try {
    if (shouldActivateNow) {
      await smsTemplateService.sendUsingTemplate(
        'payment_renewal',
        customer.phoneNumber,
        { customerName: `${customer.firstName} ${customer.lastName}`, amount: payment.amount, expiryDate: customer.subscription.expiresAt.toLocaleDateString() },
        { customerId: customer._id, accountId: customer.accountId, type: 'subscription_renewal', regionCode: payment.regionCode }
      );
    } else {
      await smsTemplateService.sendUsingTemplate(
        'payment_wallet',
        customer.phoneNumber,
        { customerName: `${customer.firstName} ${customer.lastName}`, amount: payment.amount, newBalance: customer.billing.balance },
        { customerId: customer._id, accountId: customer.accountId, type: 'payment_confirmation', regionCode: payment.regionCode }
      );
    }
  } catch (err) {
    console.log("SMS not sent:", err.message);
  }
}

module.exports = exports;
