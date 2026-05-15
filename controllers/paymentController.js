const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const Customer = require('../models/Customer');
const HotspotUser = require('../models/HotspotUser');
const Package = require('../models/Package');
const Site = require('../models/Site');
const Invoice = require('../models/Invoice');
const UnprocessedPayment = require('../models/UnprocessedPayment')
const SystemLog = require('../models/SystemLog');
const mpesaService = require('../services/mpesaService');
const { calculatePeriodEnd } = require('../utils/invoiceHelpers');
const { formatPhoneNumber } = require('../utils/phoneHelpers');



function parseMpesaDate(transactionDate) {
  if (!transactionDate) return null;
  const dateStr = transactionDate.toString();
  if (dateStr.length !== 14) return null;
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6) - 1; // months are 0-indexed
  const day = dateStr.substring(6, 8);
  const hour = dateStr.substring(8, 10);
  const minute = dateStr.substring(10, 12);
  const second = dateStr.substring(12, 14);
  // Use UTC to avoid timezone ambiguity
  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

/**
 * Activate account in Mikrotik and RADIUS
 * @param {Object} customer - Customer document
 * @param {Object} site - Site document
 * @param {Object} packageDoc - Package document
 * @returns {Object} { success, mikrotikResult, radiusResult }
 */
async function activateAccount(customer, packageDoc) {
  console.log('⚙️ [activateAccount] Activating account:', customer.accountId);
  const radiusService = require('../services/radiusService');
  const packageName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
  console.log(`   Group name: ${packageName}`);
  const radiusResult = await radiusService.enableAccount(customer.pppoe.username, packageName);
  const cycleResult = await radiusService.setBillingCycleStart(customer.pppoe.username, Date.now())
  if (!radiusResult.success) {
    console.error('⚠️ RADIUS enable failed:', radiusResult.error);
    throw new Error(`RADIUS enable failed: ${radiusResult.error}`);
  }
  console.log('✅ RADIUS enabled');

  if (customer.fupEnabled && packageDoc.fup?.enabled && packageDoc.fup.resetPeriod === 'billingCycle') {
    customer.billingCycle = { startDate: Date.now() };
    await customer.save();
  }

  if (customer.fupEnabled && packageDoc.fup?.enabled) {
    const quotaBytes = packageDoc.fup.dataThresholdGB * 1024 * 1024 * 1024;
    await radiusService.enableFUPForCustomer(customer.pppoe.username, quotaBytes);
  }
  return { success: true, radiusResult };
}

// @desc    Lookup customer by phone number (for payment portal)
// @route   POST /api/payments/lookup
// @access  Public
exports.lookupCustomer = asyncHandler(async (req, res, next) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return next(new ErrorResponse('Phone number is required', 400));
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);

  const customers = await Customer.find({
    phoneNumber: formattedPhone,
    isActive: true
  })
    .populate('subscription.packageId', 'packageName price')
    .populate('siteId', 'siteName regionCode')
    .select('accountId firstName lastName phoneNumber subscription siteId regionCode');

  if (customers.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'No active account found with this phone number',
      data: null
    });
  }

  const customerData = customers.map(customer => ({
    customerId: customer._id,
    packageId: customer.subscription.packageId?._id,
    customerType: 'pppoe',
    name: `${customer.firstName} ${customer.lastName}`,
    accountId: customer.accountId,
    packageName: customer.subscription.packageId?.packageName,
    packagePrice: customer.subscription.packageId?.price,
    location: customer.siteId?.siteName,
    status: customer.subscription.status,
    expiresAt: customer.subscription.expiresAt,
    regionCode: customer.regionCode,
    siteId: customer.siteId?._id
  }));

  res.status(200).json({
    success: true,
    message: 'Customer accounts found',
    data: {
      phoneNumber: formattedPhone,
      accounts: customerData
    }
  });
});

// @desc    Initiate payment (STK Push)
// @route   POST /api/payments/initiate
// @access  Public
exports.initiatePayment = asyncHandler(async (req, res, next) => {
  const {
    customerId,
    customerType,
    phoneNumber,         // customer's registered phone (for lookup)
    amount,
    packageId,
    regionCode,
    siteId,
    phoneToPay           // phone number to charge
  } = req.body;

  if (!customerId || !customerType || !phoneNumber || !amount || !packageId || !phoneToPay) {
    return next(new ErrorResponse('Missing required fields', 400));
  }
  if (!['pppoe', 'hotspot'].includes(customerType)) {
    return next(new ErrorResponse('Invalid customer type', 400));
  }

  // Fetch customer and package
  let customer;
  let identifier; // used in stkID
  if (customerType === 'pppoe') {
    customer = await Customer.findById(customerId);
    identifier = customer?.accountId;
  } else {
    customer = await HotspotUser.findById(customerId);
    identifier = customer?._id.toString();
  }

  if (!customer) {
    return next(new ErrorResponse('Customer not found', 404));
  }

  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) {
    return next(new ErrorResponse('Package not found', 404));
  }
  if (amount !== packageDoc.price) {
    return next(new ErrorResponse('Amount does not match package price', 400));
  }

  // Atomically increment payment counter
  let updatedCustomer;
  if (customerType === 'pppoe') {
    updatedCustomer = await Customer.findByIdAndUpdate(
      customerId,
      { $inc: { paymentCounter: 1 } },
      { new: true }
    );
  } else {
    updatedCustomer = await HotspotUser.findByIdAndUpdate(
      customerId,
      { $inc: { paymentCounter: 1 } },
      { new: true }
    );
  }
  const counter = updatedCustomer.paymentCounter;

  // Generate unique stkID (for frontend tracking)
  const stkID = `${customerType.toUpperCase()}-${identifier}-${String(counter).padStart(3, '0')}`;

  // Initiate STK Push
  const callbackUrl = `${process.env.API_URL}/api/payments/callback`;
  const stkResult = await mpesaService.initiateSTKPush({
    phoneNumber: phoneToPay,
    amount,
    accountReference: stkID,
    callbackUrl,
    transactionDesc: `Payment for ${packageDoc.packageName}`
  });

  if (!stkResult.success) {
    return res.status(400).json({
      success: false,
      message: 'Failed to initiate payment',
      data: {
        error: stkResult.error,
        stkID
      }
    });
  }

  // --- Create pending payment record (only after successful STK initiation) ---
  const payment = await Payment.create({
    stkID,
    checkoutRequestId: stkResult.checkoutRequestId, // ← crucial for callback
    customerType,
    customerId: customer._id,
    accountId: customer.accountId || customer._id.toString(),
    regionCode: customer.regionCode,
    siteId: customer.siteId,
    amount,
    packageId,
    status: 'pending',
    stkPush: {
      checkoutRequestId: stkResult.checkoutRequestId,
      phoneNumber: phoneToPay,
      initiatedAt: new Date()
    },
    // metadata from request
    metadata: {
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    }
  });

  console.log(`✅ Pending payment created: ${payment._id} (stkID: ${stkID})`);

  res.status(200).json({
    success: true,
    message: 'STK push sent successfully. Please enter your M-Pesa PIN',
    data: {
      stkID,
      checkoutRequestId: stkResult.checkoutRequestId,
      customerMessage: stkResult.customerMessage
    }
  });
});

// @desc    M-Pesa callback handler
// @route   POST /api/payments/callback
// @access  Public (M-Pesa calls this)
exports.mpesaCallback = asyncHandler(async (req, res, next) => {
  console.log('📞 [mpesaCallback] Received callback at:', new Date().toISOString());
  console.log('📞 [mpesaCallback] Request body preview:', JSON.stringify(req.body).substring(0, 500) + '...');

  try {
    const callbackData = mpesaService.parseCallback(req.body);
    console.log('📞 [mpesaCallback] Parsed callbackData:', callbackData);

    const {
      checkoutRequestId,
      resultCode,
      resultDesc,
      amount,
      mpesaReceiptNumber,
      transactionDate,
      phoneNumber: mpesaPhone
    } = callbackData;

    if (!checkoutRequestId) {
      console.error('❌ [mpesaCallback] checkoutRequestId missing in callback');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    // Find the pending payment by checkoutRequestId
    const payment = await Payment.findOne({ checkoutRequestId });
    if (!payment) {
      console.error('❌ [mpesaCallback] No payment found for checkoutRequestId:', checkoutRequestId);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    console.log('📞 [mpesaCallback] Found payment:', payment._id, 'current status:', payment.status);

    // Update payment with callback data
    payment.status = resultCode === 0 ? 'completed' : 'failed';
    payment.stkPush.resultCode = resultCode.toString();
    payment.stkPush.resultDesc = resultDesc;
    if (resultCode === 0) {
      payment.mpesaReceiptNumber = mpesaReceiptNumber;
      // You can also store transactionDate if needed
    } else {
      payment.error = {
        code: resultCode.toString(),
        message: mpesaService.getResultCodeDescription(resultCode)
      };
    }
    payment.callbackReceived = true;
    payment.callbackData = req.body;
    await payment.save();

    console.log('✅ [mpesaCallback] Payment updated to status:', payment.status);

    if (resultCode === 0) {
      // Populate customer and package before processing success
      await payment.populate([
        { path: 'customerId' },
        { path: 'packageId' }
      ]);
      await processSuccessfulPayment(payment, callbackData);
    } else {
      // Log failed payment
      await SystemLog.create({
        eventType: 'payment_processing',
        severity: 'warning',
        regionCode: payment.regionCode,
        entityType: payment.customerType === 'pppoe' ? 'customer' : 'hotspot_user',
        entityId: payment.customerId,
        accountId: payment.accountId,
        message: `Payment failed for ${payment.accountId}`,
        details: { resultCode, resultDesc },
        success: false,
        relatedPaymentId: payment._id
      });
    }

    // Always return success to M-Pesa
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('🔥 [mpesaCallback] Unhandled error:', error);
    console.error('Stack:', error.stack);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

// Helper: process successful payment (transactions, subscription update, etc.)
async function processSuccessfulPayment(payment, callbackData) {
  console.log('⚙️ [processSuccessfulPayment] Starting for payment:', payment._id);
  try {
    // Payment is already populated with customerId and packageId
    const customer = await Customer.findById(payment.customerId);
    const packageDoc = await Package.findById(payment.packageId);

    if (!customer || !packageDoc) {
      throw new Error('Customer or Package not populated in payment');
    }

    console.log('👤 Customer:', customer.accountId, 'Status:', customer.subscription?.status);
    console.log('💰 Amount paid:', payment.amount, 'Current balance:', customer.billing?.balance || 0);
    console.log('📦 Package price:', packageDoc.price);

    // 1. Create MPESA transaction (credit - money IN)
    console.log('⚙️ Creating MPESA transaction...');
    const mpesaTransaction = await Transaction.create({
      type: 'MPESA',
      customerType: payment.customerType,
      customerId: customer._id,
      accountId: payment.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: payment.amount,
      description: 'M-Pesa payment received',
      paymentMethod: 'stk_push',
      mpesa: {
        transactionId: payment.mpesaReceiptNumber,
        phoneNumber: payment.stkPush.phoneNumber,
        accountReference: payment.stkID,
        transactionDate: parseMpesaDate(callbackData.transactionDate)
      },
      status: 'completed'
    });
    console.log('✅ MPESA transaction created:', mpesaTransaction._id);

    // 2. Determine transaction type and handle balance/activation
    const now = new Date();
    const currentBalance = customer.billing?.balance || 0;
    const totalAvailable = currentBalance + payment.amount;
    const packagePrice = packageDoc.price;
    const isActive = customer.subscription?.status !== 'expired';
    
    let transactionType;
    let transactionDescription;
    let shouldActivate = false;
    let newBalance = currentBalance;
    

    console.log('📊 Decision logic:');
    console.log('  - Is Active:', isActive);
    console.log('  - Total Available:', totalAvailable);
    console.log('  - Package Price:', packagePrice);
    console.log('  - Can Afford:', totalAvailable >= packagePrice);

    if (customer.subscription?.status !== 'expired') {
      // Customer is ACTIVE - add to wallet
      console.log('✅ Customer is ACTIVE - adding to wallet');
      transactionType = 'WALLET';
      transactionDescription = 'Funds added to wallet';
      newBalance = totalAvailable; // old balance + new payment
      shouldActivate = false;
    
    } else {
      // Customer is INACTIVE - check if can afford activation
      if (totalAvailable >= packagePrice) {
        // Can afford - activate and keep remainder
        console.log('✅ Customer INACTIVE but can afford - activating');
        transactionType = 'SUBSCRIPTION';
        transactionDescription = `Subscription activated - ${packageDoc.packageName}`;
        newBalance = totalAvailable - packagePrice; // remainder after activation
        shouldActivate = true;
        customer.renewals.push({
          dateRenewed: now,
          method: 'stk'
        });
  

      } else {
        // Cannot afford - add to wallet
        console.log('⚠️ Customer INACTIVE and cannot afford - adding to wallet');
        transactionType = 'WALLET';
        transactionDescription = 'Insufficient balance - funds added to wallet';
        newBalance = totalAvailable; // old balance + new payment
        shouldActivate = false;
      }
    }

    console.log('📝 Transaction type:', transactionType);
    console.log('💵 New balance will be:', newBalance);
    console.log('🔌 Should activate:', shouldActivate);

    // 3. Create second transaction (WALLET or SUBSCRIPTION)
    console.log(`⚙️ Creating ${transactionType} transaction...`);
    const secondTransaction = await Transaction.create({
      type: transactionType,
      customerType: payment.customerType,
      customerId: customer._id,
      accountId: payment.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: transactionType === 'SUBSCRIPTION' ? -packagePrice : -payment.amount,
      description: transactionDescription,
      paymentMethod: 'stk_push',
      packageId: transactionType === 'SUBSCRIPTION' ? packageDoc._id : undefined,
      relatedTransactionId: mpesaTransaction._id,
      status: 'completed'
    });
    console.log(`✅ ${transactionType} transaction created:`, secondTransaction._id);

    // Link transactions
    mpesaTransaction.relatedTransactionId = secondTransaction._id;
    await mpesaTransaction.save();

    // 4. Update customer balance
    customer.billing.balance = newBalance;
    customer.billing.lastPaymentDate = now;
    console.log('✅ Customer balance updated to:', newBalance);

    // 5. Handle activation if needed
    if (shouldActivate && payment.customerType === 'pppoe') {
      console.log('⚙️ Activating PPPoE customer...');
      
      // Calculate new expiry date
      const currentExpiry = customer.subscription.expiresAt;
      const baseDate = customer.subscription.status === 'active' && currentExpiry > now
        ? currentExpiry
        : now;

      customer.subscription.expiresAt = calculatePeriodEnd(
        baseDate,
        packageDoc.period,
        packageDoc.periodUnit
      );
      customer.subscription.status = 'active';
      customer.subscription.activatedAt = now;
      
      console.log('✅ Subscription updated, expires:', customer.subscription.expiresAt);

      // Save customer before activating services
      await customer.save();

      // Enable in Mikrotik and RADIUS
      const site = await Site.findById(payment.siteId);
      if (site) {
        const activationResult = await activateAccount(customer, packageDoc);
        if (!activationResult.success) {
          console.error('⚠️ Account activation had issues, but subscription is updated');
        }
      } else {
        console.error('⚠️ Site not found, cannot enable Mikrotik/RADIUS');
      }

    } else if (shouldActivate && payment.customerType === 'hotspot') {
      console.log('⚙️ Activating hotspot customer...');
      
      customer.activeSession = {
        packageId: packageDoc._id,
        startedAt: now,
        expiresAt: calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit),
        dataLimit: packageDoc.dataLimit,
        dataUsed: 0,
        isActive: true
      };

      customer.purchaseHistory.push({
        packageId: packageDoc._id,
        purchasedAt: now,
        amount: packagePrice,
        transactionId: mpesaTransaction._id
      });

      console.log('✅ Hotspot session created, expires:', customer.activeSession.expiresAt);
      await customer.save();

    } else {
      // Just save the balance update
      await customer.save();
      console.log('✅ Customer saved with updated balance');
    }

    // 6. Log system event
    await SystemLog.create({
      eventType: shouldActivate ? 'subscription_renewal' : 'payment_received',
      severity: 'info',
      regionCode: payment.regionCode,
      entityType: payment.customerType === 'pppoe' ? 'customer' : 'hotspot_user',
      entityId: customer._id,
      accountId: payment.accountId,
      message: shouldActivate 
        ? `Subscription activated for ${payment.accountId}`
        : `Payment received and added to wallet for ${payment.accountId}`,
      details: {
        amount: payment.amount,
        mpesaReceipt: payment.mpesaReceiptNumber,
        transactionType,
        newBalance,
        activated: shouldActivate
      },
      success: true,
      relatedTransactionId: mpesaTransaction._id,
      relatedPaymentId: payment._id
    });

    console.log('✅ [processSuccessfulPayment] Completed successfully');
    console.log('📊 Summary:');
    console.log('  - Transaction Type:', transactionType);
    console.log('  - Account Activated:', shouldActivate);
    console.log('  - New Balance:', newBalance);
    console.log('  - Status:', customer.subscription?.status || 'N/A');

  } catch (error) {
    console.error('🔥 [processSuccessfulPayment] Error:', error);
    console.error('Stack:', error.stack);

    // Log error
    await SystemLog.create({
      eventType: 'payment_processing',
      severity: 'error',
      regionCode: payment.regionCode,
      entityType: payment.customerType === 'pppoe' ? 'customer' : 'hotspot_user',
      entityId: payment.customerId,
      accountId: payment.accountId,
      message: `Payment processing failed for ${payment.accountId}`,
      details: { error: error.message, stack: error.stack },
      success: false,
      relatedPaymentId: payment._id
    });

    throw error;
  }
}

// @desc    Check payment status by stkID
// @route   GET /api/payments/status/:stkID
// @access  Public
exports.checkPaymentStatus = asyncHandler(async (req, res, next) => {
  const { stkID } = req.params;
  const payment = await Payment.findOne({ stkID })
    .select('status mpesaReceiptNumber error stkPush.resultDesc');
  if (!payment) {
    return next(new ErrorResponse('Payment not found', 404));
  }
  res.status(200).json({
    success: true,
    message: 'Payment status retrieved',
    data: {
      status: payment.status,
      mpesaReceiptNumber: payment.mpesaReceiptNumber,
      resultDesc: payment.stkPush?.resultDesc,
      error: payment.error
    }
  });
});

// @desc    Get payment history for a customer
// @route   GET /api/payments/history/:customerId
// @access  Private
exports.getPaymentHistory = asyncHandler(async (req, res, next) => {
  const { customerId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const payments = await Payment.find({ customerId })
    .populate('packageId', 'packageName')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Payment.countDocuments({ customerId });

  res.status(200).json({
    success: true,
    message: 'Payment history retrieved',
    data: {
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get transactions history for a customer
// @route   GET /api/payments/transactions-history/:customerId
// @access  Private
exports.getTransactionsHistory = asyncHandler(async (req, res, next) => {
  const { customerId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const transactions = await Transaction.find({ customerId })
    .populate('packageId', 'packageName')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Payment.countDocuments({ customerId });

  res.status(200).json({
    success: true,
    message: 'Payment history retrieved',
    data: {
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
})



// DEALING WITH PAYMENTS THAT ARE PAID DIRECTLY TO TILL NO CALLBACK  //




// FOR DIRECT PAYMENTS THAT ARE PAID TO TILL NO CALLBACK, MPESA CALLS THIS FUNCTION TO ADD THEM TO UNPROCESSED PAYMENTS COLLECTION

// @desc    C2B confirmation URL (called by M-Pesa for direct payments)
// @route   POST /api/payments/c2b-callback
// @access  Public
exports.c2bCallback = asyncHandler(async (req, res, next) => {
  console.log('📞 [c2bCallback] Received:', req.body);

  const {
    TransactionType,
    TransID,          // receipt number
    TransTime,        // YYYYMMDDHHMMSS
    TransAmount,
    BusinessShortCode,
    BillRefNumber,    // optional account reference
    MSISDN,           // customer phone
    FirstName,
    MiddleName,
    LastName
  } = req.body;

  // Always acknowledge receipt to M-Pesa
  if (!TransID) {
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  try {
    // 1. Check if already processed (in Payment)
    const existingPayment = await Payment.findOne({ mpesaReceiptNumber: TransID });
    if (existingPayment) {
      console.log('✅ Already processed as payment');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    // 2. Check if already in UnprocessedPayment queue
    const existingUnprocessed = await UnprocessedPayment.findOne({ receiptNumber: TransID });
    if (existingUnprocessed) {
      console.log('✅ Already in unprocessed queue');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    // 3. Format phone number
    const phone = formatPhoneNumber(MSISDN);

    // 4. Try to find customer by phone number
    let customer = await Customer.findOne({ phoneNumber: phone });
    let customerType = 'pppoe';
    if (!customer) {
      customer = await HotspotUser.findOne({ phoneNumber: phone });
      customerType = 'hotspot';
    }

    // 5. If customer found, attempt to auto-process
    if (customer) {
      console.log(`✅ Found customer ${customer.accountId || customer._id} for phone ${phone}`);

      // Determine current package
      let packageId;
      if (customerType === 'pppoe') {
        packageId = customer.subscription?.packageId;
      } else {
        packageId = customer.activeSession?.packageId;
      }

      if (packageId) {
        const packageDoc = await Package.findById(packageId);
        if (packageDoc) {
          // Create payment record (source = 'till')
          const payment = await Payment.create({
            stkID: `TILL-${TransID}`,
            checkoutRequestId: TransID, // placeholder
            customerType,
            customerId: customer._id,
            accountId: customer.accountId || customer._id.toString(),
            regionCode: customer.regionCode,
            siteId: customer.siteId,
            amount: TransAmount,
            packageId,
            status: 'completed',
            stkPush: {
              phoneNumber: phone,
              initiatedAt: new Date()
            },
            mpesaReceiptNumber: TransID,
            callbackReceived: true,
            callbackData: req.body,
            source: 'till',
            resolutionStatus: 'processed'
          });

          console.log(`✅ Payment record created: ${payment._id}`);

          // Process via direct payment helper (creates transactions, updates balance, activates if needed)
          await processDirectPayment(payment, {
            amount: TransAmount,
            phoneNumber: phone,
            transactionDate: parseMpesaDate(TransTime)
          });

          console.log(`🎉 Auto‑processed payment for ${customer.accountId || customer._id}`);
          return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
        } else {
          console.log(`⚠️ Customer has packageId ${packageId} but package not found – storing as unprocessed`);
        }
      } else {
        console.log(`⚠️ Customer has no active package – storing as unprocessed`);
      }
    } else {
      console.log(`ℹ️ No customer found for phone ${phone} – storing as unprocessed`);
    }

    // 6. If we reach here, store in UnprocessedPayment for manual resolution
    await UnprocessedPayment.create({
      receiptNumber: TransID,
      phoneNumber: phone,
      amount: TransAmount,
      transactionDate: parseMpesaDate(TransTime),
      rawData: req.body,
      status: 'new'
    });

    console.log(`✅ Unprocessed payment stored: ${TransID} from ${phone}`);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  } catch (error) {
    console.error('🔥 [c2bCallback] Error:', error);
    // Always return success to M-Pesa
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

async function processDirectPayment(payment, mpesaData) {
  console.log('⚙️ [processDirectPayment] Starting for payment:', payment._id);
  try {
    const customer = await (payment.customerType === 'pppoe' ? Customer : HotspotUser).findById(payment.customerId);
    const packageDoc = await Package.findById(payment.packageId);

    if (!customer || !packageDoc) {
      throw new Error('Customer or Package not found');
    }

    // Same decision logic as in processSuccessfulPayment
    const now = new Date();
    const currentBalance = customer.billing?.balance || 0;
    const totalAvailable = currentBalance + payment.amount;
    const packagePrice = packageDoc.price;
    const isActive = customer.subscription?.status === 'active';

    let transactionType;
    let transactionDescription;
    let shouldActivate = false;
    let newBalance = currentBalance;

    if (isActive) {
      transactionType = 'WALLET';
      transactionDescription = 'Funds added to wallet (direct payment)';
      newBalance = totalAvailable;
      shouldActivate = false;
    } else {
      if (totalAvailable >= packagePrice) {
        transactionType = 'SUBSCRIPTION';
        transactionDescription = `Subscription activated via direct payment - ${packageDoc.packageName}`;
        newBalance = totalAvailable - packagePrice;
        shouldActivate = true;
      } else {
        transactionType = 'WALLET';
        transactionDescription = 'Insufficient balance - funds added to wallet (direct payment)';
        newBalance = totalAvailable;
        shouldActivate = false;
      }
    }

    // Create MPESA transaction (credit)
    const mpesaTransaction = await Transaction.create({
      type: 'MPESA',
      customerType: payment.customerType,
      customerId: customer._id,
      accountId: payment.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: payment.amount,
      description: 'M-Pesa direct payment',
      paymentMethod: 'till', // differentiate from STK
      mpesa: {
        transactionId: payment.mpesaReceiptNumber,
        phoneNumber: mpesaData.phoneNumber,
        accountReference: payment.stkID,
        transactionDate: parseMpesaDate(mpesaData.transactionDate)
      },
      status: 'completed'
    });

    // Create second transaction
    const secondTransaction = await Transaction.create({
      type: transactionType,
      customerType: payment.customerType,
      customerId: customer._id,
      accountId: payment.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: transactionType === 'SUBSCRIPTION' ? -packagePrice : -payment.amount,
      description: transactionDescription,
      paymentMethod: 'till',
      packageId: transactionType === 'SUBSCRIPTION' ? packageDoc._id : undefined,
      relatedTransactionId: mpesaTransaction._id,
      status: 'completed'
    });

    // Link transactions
    mpesaTransaction.relatedTransactionId = secondTransaction._id;
    await mpesaTransaction.save();

    // Update customer balance
    customer.billing.balance = newBalance;
    customer.billing.lastPaymentDate = now;

    // Handle activation if needed
    if (shouldActivate && payment.customerType === 'pppoe') {
      const currentExpiry = customer.subscription.expiresAt;
      const baseDate = isActive && currentExpiry > now ? currentExpiry : now;
      customer.subscription.expiresAt = calculatePeriodEnd(
        baseDate,
        packageDoc.period,
        packageDoc.periodUnit
      );
      customer.subscription.status = 'active';
      customer.subscription.activatedAt = now;
      customer.renewals.push({
        dateRenewed: now,
        method: 'direct'
      });


      await customer.save();

      const site = await Site.findById(payment.siteId);
      if (site) {
        await activateAccount(customer, site, packageDoc);
      }
    } else if (shouldActivate && payment.customerType === 'hotspot') {
      customer.activeSession = {
        packageId: packageDoc._id,
        startedAt: now,
        expiresAt: calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit),
        dataLimit: packageDoc.dataLimit,
        dataUsed: 0,
        isActive: true
      };
      customer.purchaseHistory.push({
        packageId: packageDoc._id,
        purchasedAt: now,
        amount: payment.amount,
        transactionId: mpesaTransaction._id
      });
      await customer.save();
    } else {
      // Just save balance update
      await customer.save();
    }

    // Log system event
    await SystemLog.create({
      eventType: shouldActivate ? 'subscription_renewal' : 'payment_received',
      severity: 'info',
      regionCode: payment.regionCode,
      entityType: payment.customerType === 'pppoe' ? 'customer' : 'hotspot_user',
      entityId: customer._id,
      accountId: payment.accountId,
      message: shouldActivate
        ? `Subscription activated via direct payment for ${payment.accountId}`
        : `Direct payment added to wallet for ${payment.accountId}`,
      details: {
        amount: payment.amount,
        mpesaReceipt: payment.mpesaReceiptNumber,
        transactionType,
        newBalance,
        activated: shouldActivate
      },
      success: true,
      relatedTransactionId: mpesaTransaction._id,
      relatedPaymentId: payment._id
    });

    console.log('✅ [processDirectPayment] Completed successfully');
  } catch (error) {
    console.error('🔥 [processDirectPayment] Error:', error);
    throw error;
  }
}












//FOR MANUALLY RESOLVING A PAYMENT


// @desc    Manually resolve an unmatched payment
// @route   POST /api/payments/resolve
// @access  Private
exports.resolvePayment = asyncHandler(async (req, res, next) => {
  const { receiptNumber, customerId, customerType } = req.body;

  if (!receiptNumber || !customerId || !customerType) {
    return next(new ErrorResponse('Receipt, customer ID and type required', 400));
  }
  if (!['pppoe', 'hotspot'].includes(customerType)) {
    return next(new ErrorResponse('Invalid customer type', 400));
  }

  // Check if already processed as payment
  let payment = await Payment.findOne({ mpesaReceiptNumber: receiptNumber });
  if (payment) {
    return next(new ErrorResponse('This receipt has already been processed', 400));
  }

  // Find the unprocessed record
  const unprocessed = await UnprocessedPayment.findOne({ receiptNumber, status: 'new' });
  if (!unprocessed) {
    return next(new ErrorResponse('Receipt not found or already resolved', 404));
  }

  // Fetch customer
  const CustomerModel = customerType === 'pppoe' ? Customer : HotspotUser;
  const customer = await CustomerModel.findById(customerId);
  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  // Determine package
  let packageId;
  if (customerType === 'pppoe') {
    packageId = customer.subscription?.packageId;
  } else {
    packageId = customer.activeSession?.packageId;
  }
  if (!packageId) return next(new ErrorResponse('Customer has no package', 400));
  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) return next(new ErrorResponse('Package not found', 404));

  // Create payment record
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
    status: 'completed',
    stkPush: {
      phoneNumber: unprocessed.phoneNumber,
      initiatedAt: unprocessed.transactionDate || new Date()
    },
    mpesaReceiptNumber: receiptNumber,
    callbackReceived: true,
    callbackData: unprocessed.rawData,
    source: 'manual',
    resolutionStatus: 'processed'
  });

  // Process payment
  await processManualPayment(payment, {
    amount: unprocessed.amount,
    phoneNumber: unprocessed.phoneNumber,
    transactionDate: unprocessed.transactionDate
  });

  // Remove from unprocessed
  unprocessed.status = 'matched';
  unprocessed.matchedWith = {
    type: 'Customer',
    id: customer._id,
  };
  await unprocessed.save();

  res.json({
    success: true,
    message: 'Payment resolved and processed',
    data: payment
  });
});


exports.searchUnprocessed = asyncHandler(async (req, res, next) => {
  const { receiptNumber } = req.body;

  if (!receiptNumber) {
    return next(new ErrorResponse('Receipt number is required', 400));
  }

  // Search in UnprocessedPayment collection
  const payment = await UnprocessedPayment.findOne({ receiptNumber });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: 'No unprocessed payment found with that receipt number',
      data: null
    });
  }

  // Return relevant fields (avoid sending entire rawData if too large)
  res.status(200).json({
    success: true,
    message: 'Unprocessed payment found',
    data: {
      receiptNumber: payment.receiptNumber,
      phoneNumber: payment.phoneNumber,
      amount: payment.amount,
      transactionDate: payment.transactionDate,
      status: payment.status,
      createdAt: payment.createdAt
    }
  });
});

exports.getAnUnprocessedPayment = asyncHandler(async (req, res, next) => {
  const { receipt } = req.params;

  if (!receipt) {
    return next(new ErrorResponse('Receipt number is required', 400));
  }

  const unprocessedPayment = await UnprocessedPayment.findOne({ 
    receiptNumber: receipt 
  });

  if (!unprocessedPayment) {
    return next(new ErrorResponse('Unprocessed payment not found', 404));
  }

  res.status(200).json({
    success: true,
    message: 'Unprocessed payment retrieved successfully',
    data: unprocessedPayment
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

  // ============================================
  // 1. VALIDATION
  // ============================================
  if (!targetCustomerId) return next(new ErrorResponse('Target customer ID is required', 400));
  if (!reason) return next(new ErrorResponse('Reason for payment transfer is required', 400));

  const payment = await Payment.findById(paymentId);
  if (!payment) return next(new ErrorResponse('Payment not found', 404));
  if (payment.status === 'failed') return next(new ErrorResponse('Cannot move failed payments', 400));

  const sourceCustomer = await Customer.findById(payment.customerId).populate('subscription.packageId');
  if (!sourceCustomer) return next(new ErrorResponse('Source customer not found', 404));

  const targetCustomer = await Customer.findById(targetCustomerId).populate('subscription.packageId');
  if (!targetCustomer) return next(new ErrorResponse('Target customer not found', 404));

  if (sourceCustomer._id.toString() === targetCustomer._id.toString()) {
    return next(new ErrorResponse('Cannot move payment to same customer', 400));
  }

  const site = await Site.findById(sourceCustomer.siteId).select('+router.password');
  const now = new Date();

  console.log(`\n💸 Moving payment ${payment.mpesaReceiptNumber || paymentId}`);
  console.log(`   From: ${sourceCustomer.accountId} (${sourceCustomer.firstName} ${sourceCustomer.lastName})`);
  console.log(`   To: ${targetCustomer.accountId} (${targetCustomer.firstName} ${targetCustomer.lastName})`);
  console.log(`   Amount: KES ${payment.amount}`);
  console.log(`   Reason: ${reason}`);

  // ============================================
  // 2. FIND THE TWO TRANSACTIONS LINKED TO PAYMENT
  // ============================================
 // 1. Find MPESA transaction
const mpesaTxn = await Transaction.findOne({
  'mpesa.transactionId': payment.mpesaReceiptNumber,
  type: 'MPESA'
});
console.log(mpesaTxn)
if (!mpesaTxn) {
  return next(new ErrorResponse('MPESA transaction not found', 400));
}

// 2. Find secondary transaction linked to MPESA transaction
const secondaryTxn = await Transaction.findOne({
  relatedTransactionId: mpesaTxn._id,
  type: { $in: ['SUBSCRIPTION', 'WALLET'] }
});

if (!secondaryTxn) {
  return next(new ErrorResponse('Secondary transaction not found', 400));
}

  // ============================================
  // 3. REVERSE SOURCE CUSTOMER'S FINANCIAL IMPACT
  // ============================================
  console.log(`\n🔄 Reversing source customer impact...`);
  let reversalResult = { suspended: false, balanceAdjusted: false };

  const wasSubscription = secondaryTxn.type === 'SUBSCRIPTION';
  const wasWallet = secondaryTxn.type === 'WALLET';

  if (wasSubscription) {
    const activationTime = sourceCustomer.subscription.activatedAt;
    const paymentTime = payment.stkPush?.initiatedAt || payment.createdAt;
    const timeDiff = Math.abs(activationTime - paymentTime);
    const isActivation = timeDiff < 1000 * 60 * 60; // within 1 hour
  
    if (isActivation) {
      // Suspend source account
      console.log(`   🔒 This payment activated the subscription. Suspending account.`);
      sourceCustomer.subscription.status = 'expired';
      sourceCustomer.subscription.expiresAt = now;
      await sourceCustomer.save();
      reversalResult.suspended = true;
  
      // ✅ Disable in RADIUS
      try {
        const radiusService = require('../services/radiusService');
        await radiusService.disableAccount(sourceCustomer.pppoe.username);
        console.log(`   ✅ Disabled in RADIUS`);

    //         //restart their session
    // const mikroticService = require('../services/mikroticService');
    // if(site){
    //   const mikroticResult = await mikroticService.endSession(site, sourceCustomer.pppoe.username);
    //   if(!mikroticResult.success){
    //     console.log("Failed to restart the session, customer still using previous session.")
       
    //   }else{
    //     console.log("Restarted source customer session.")
    //   }
    // }
      } catch (err) {
        console.error(`   ⚠️  RADIUS disable failed: ${err.message}`);
      }
    } else {
      // Payment was a renewal – add amount back to source balance
      sourceCustomer.billing.balance += payment.amount;
      await sourceCustomer.save();
      reversalResult.balanceAdjusted = true;
      console.log(`   📊 Payment was a renewal, added ${payment.amount} back to balance. New balance: ${sourceCustomer.billing.balance}`);
    }
  } else if (wasWallet) {
    // Payment was wallet top-up – subtract from source balance
    sourceCustomer.billing.balance -= payment.amount;
    await sourceCustomer.save();
    reversalResult.balanceAdjusted = true;
    console.log(`   📊 Payment was wallet top-up, subtracted ${payment.amount} from balance. New balance: ${sourceCustomer.billing.balance}`);
  }

  // ============================================
  // 4. UPDATE BOTH TRANSACTIONS TO TARGET CUSTOMER
  // ============================================
  console.log(`\n📝 Updating transactions to target customer...`);

  // Common fields to update
  const targetFields = {
    customerId: targetCustomer._id,
    accountId: targetCustomer.accountId,
    firstName: targetCustomer.firstName,
    lastName: targetCustomer.lastName,
    regionCode: targetCustomer.regionCode,
    siteId: targetCustomer.siteId
  };

  // Update MPESA transaction
  mpesaTxn.set(targetFields);
  mpesaTxn.description = `M-Pesa payment transferred from ${sourceCustomer.accountId}`;
  mpesaTxn.notes = (mpesaTxn.notes || '') + `\nTransferred to ${targetCustomer.accountId} on ${now.toISOString()}. Reason: ${reason}`;
  await mpesaTxn.save();

  // Determine what the secondary transaction should be for the target
  const targetPackage = targetCustomer.subscription?.packageId;
  if (!targetPackage) {
    return next(new ErrorResponse('Target customer has no package assigned', 400));
  }

  const targetWasExpired = targetCustomer.subscription.status === 'expired';
  let newSecondaryType, newAmount, newDescription;

  if (targetWasExpired) {
    // Target is expired – we will activate with this payment (SUBSCRIPTION transaction)
    newSecondaryType = 'SUBSCRIPTION';
    newAmount = -targetPackage.price; // negative because it's a deduction
    newDescription = `Subscription activation (payment transferred from ${sourceCustomer.accountId})`;
  } else {
    // Target is active – add to wallet (WALLET transaction)
    newSecondaryType = 'WALLET';
    newAmount = payment.amount; // positive because it's a credit to wallet
    newDescription = `Wallet credit (payment transferred from ${sourceCustomer.accountId})`;
  }

  // Update secondary transaction
  secondaryTxn.set(targetFields);
  secondaryTxn.type = newSecondaryType;
  secondaryTxn.amount = -Math.abs(newAmount);
  secondaryTxn.description = newDescription;
  secondaryTxn.notes = (secondaryTxn.notes || '') + `\nTransferred to ${targetCustomer.accountId} on ${now.toISOString()}. Reason: ${reason}`;
  if (newSecondaryType === 'SUBSCRIPTION') {
    secondaryTxn.packageId = targetPackage._id;
  } else {
    secondaryTxn.packageId = undefined; // clear package reference if not used
  }
  await secondaryTxn.save();

  console.log(`   ✅ Updated MPESA transaction: now belongs to ${targetCustomer.accountId}`);
  console.log(`   ✅ Updated secondary transaction: type changed to ${newSecondaryType}, amount = ${newAmount}`);

  // ============================================
  // 5. UPDATE PAYMENT RECORD
  // ============================================
  console.log(`\n💰 Updating payment record...`);
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
    originalSecondaryType: wasSubscription ? 'SUBSCRIPTION' : 'WALLET',
    newSecondaryType
  });

  payment.customerId = targetCustomer._id;
  payment.accountId = targetCustomer.accountId;
  payment.regionCode = targetCustomer.regionCode;
  payment.siteId = targetCustomer.siteId;
  payment.transactionId = secondaryTxn._id; // optional: point to the current secondary
  await payment.save();
  console.log(`   ✅ Payment record updated.`);

  // ============================================
  // 6. APPLY EFFECT TO TARGET CUSTOMER
  // ============================================
  console.log(`\n🎯 Applying payment to target...`);

  if (newSecondaryType === 'SUBSCRIPTION') {
    // Activate subscription
    let periodEnd = calculatePeriodEnd(now, targetPackage.period, targetPackage.periodUnit);
    // Optionally deduct days if payment was old
    const paymentDate = payment.stkPush?.initiatedAt || payment.createdAt;
    const paymentAgeDays = Math.floor((now - paymentDate) / (1000 * 60 * 60 * 24));
    if (paymentAgeDays > 3) {
      periodEnd = new Date(periodEnd);
      periodEnd.setDate(periodEnd.getDate() - paymentAgeDays);
      console.log(`   ⏳ Adjusted expiry by ${paymentAgeDays} days due to payment age.`);
    }

    targetCustomer.subscription.status = 'active';
    targetCustomer.subscription.activatedAt = targetCustomer.subscription.activatedAt || now;
    targetCustomer.subscription.expiresAt = periodEnd;
    console.log(`   ✅ Target activated, new expiry: ${periodEnd.toISOString()}`);

    // Activate in RADIUS
    if (site) {
      try {
        const radiusService = require('../services/radiusService');
        const packageName = targetPackage.packageName.replace(/\s+/g, '_').toUpperCase();
        await radiusService.enableAccount(targetCustomer.pppoe.username, packageName);

        // const mikroticService = require("../services/mikroticService");
        // const mikroticResult = await mikroticService.endSession(site, targetCustomer.pppoe.username)
        console.log(`   ✅ Activated in RADIUS`);
      } catch (err) {
        console.error(`   ⚠️  RADIUS activation failed: ${err.message}`);
      }
    }
  } else {
    // Wallet top-up
    targetCustomer.billing.balance += payment.amount;
    console.log(`   ✅ Wallet top-up, added ${payment.amount} to balance. New balance: ${targetCustomer.billing.balance}`);
  }

  targetCustomer.billing.lastPaymentDate = now;
  await targetCustomer.save();

  // ============================================
  // 7. SYSTEM LOG
  // ============================================
  await SystemLog.create({
    eventType: 'payment_transferred',
    severity: 'warning',
    regionCode: targetCustomer.regionCode,
    entityType: 'payment',
    entityId: payment._id,
    message: `Payment KES ${payment.amount} transferred from ${sourceCustomer.accountId} to ${targetCustomer.accountId}`,
    details: {
      paymentId: payment._id,
      mpesaCode: payment.mpesaReceiptNumber,
      amount: payment.amount,
      fromCustomer: {
        id: sourceCustomer._id,
        accountId: sourceCustomer.accountId,
        name: `${sourceCustomer.firstName} ${sourceCustomer.lastName}`
      },
      toCustomer: {
        id: targetCustomer._id,
        accountId: targetCustomer.accountId,
        name: `${targetCustomer.firstName} ${targetCustomer.lastName}`
      },
      reason,
      originalSecondaryType: wasSubscription ? 'SUBSCRIPTION' : 'WALLET',
      newSecondaryType,
      reversal: reversalResult
    },
    triggeredBy: req.session.userId,
    success: true
  });

  console.log(`\n✅ Payment transfer complete!`);

  // ============================================
  // 8. RESPONSE
  // ============================================
  res.status(200).json({
    success: true,
    message: `Payment transferred successfully from ${sourceCustomer.accountId} to ${targetCustomer.accountId}`,
    data: {
      payment: {
        id: payment._id,
        amount: payment.amount,
        mpesaCode: payment.mpesaReceiptNumber
      },
      source: {
        customerId: sourceCustomer._id,
        accountId: sourceCustomer.accountId,
        name: `${sourceCustomer.firstName} ${sourceCustomer.lastName}`,
        status: sourceCustomer.subscription.status,
        reversed: reversalResult
      },
      target: {
        customerId: targetCustomer._id,
        accountId: targetCustomer.accountId,
        name: `${targetCustomer.firstName} ${targetCustomer.lastName}`,
        status: targetCustomer.subscription.status,
        expiresAt: targetCustomer.subscription.expiresAt,
        balance: targetCustomer.billing.balance
      }
    }
  });
});


/**
 * @desc    Move payment from child to parent account
 * @route   POST /api/payments/:paymentId/move-to-parent
 * @access  Private
 * 
 * Simplified endpoint for moving child account payments to parent
 */
exports.movePaymentToParent = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;
 
  // Find payment
  const payment = await Payment.findById(paymentId);
  if (!payment) {
    return next(new ErrorResponse('Payment not found', 404));
  }
 
  // Get source customer (child)
  const childCustomer = await Customer.findById(payment.customerId);
  if (!childCustomer) {
    return next(new ErrorResponse('Customer not found', 404));
  }
 
  // Verify it's a child account
  if (!childCustomer.isChild || !childCustomer.parentAccount) {
    return next(new ErrorResponse('This is not a child account', 400));
  }
 
  // Get parent account
  const parentCustomer = await Customer.findById(childCustomer.parentAccount);
  if (!parentCustomer) {
    return next(new ErrorResponse('Parent account not found', 404));
  }
 
  console.log(`\n👨‍👦 Moving child payment to parent`);
  console.log(`   Child: ${childCustomer.accountId}`);
  console.log(`   Parent: ${parentCustomer.accountId}`);
 
  // Use the main move payment function
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
    return next(new ErrorResponse('Payment not found', 404));
  }
 
  const transferHistory = payment.metadata?.transferHistory || [];
 
  // Populate customer details
  const enrichedHistory = await Promise.all(
    transferHistory.map(async (transfer) => {
      const fromCustomer = await Customer.findById(transfer.fromCustomerId)
        .select('accountId firstName lastName');
      const toCustomer = await Customer.findById(transfer.toCustomerId)
        .select('accountId firstName lastName');
 
      return {
        ...transfer.toObject(),
        fromCustomer: fromCustomer ? {
          accountId: fromCustomer.accountId,
          name: `${fromCustomer.firstName} ${fromCustomer.lastName}`
        } : null,
        toCustomer: toCustomer ? {
          accountId: toCustomer.accountId,
          name: `${toCustomer.firstName} ${toCustomer.lastName}`
        } : null
      };
    })
  );
 
  res.status(200).json({
    success: true,
    data: {
      paymentId: payment._id,
      mpesaCode: payment.mpesaReceiptNumber,
      currentCustomer: {
        id: payment.customerId,
        accountId: payment.accountId
      },
      transferCount: enrichedHistory.length,
      transfers: enrichedHistory
    }
  });
});


async function processManualPayment(payment, mpesaData) {
  console.log('⚙️ [processDirectPayment] Starting for payment:', payment._id);
  try {
    const customer = await (payment.customerType === 'pppoe' ? Customer : HotspotUser).findById(payment.customerId);
    const packageDoc = await Package.findById(payment.packageId);

    if (!customer || !packageDoc) {
      throw new Error('Customer or Package not found');
    }

    // Same decision logic as in processSuccessfulPayment
    const now = new Date();
    const currentBalance = customer.billing?.balance || 0;
    const totalAvailable = currentBalance + payment.amount;
    const packagePrice = packageDoc.price;
    const isActive = customer.subscription?.status !== 'expired';

    let transactionType;
    let transactionDescription;
    let shouldActivate = false;
    let newBalance = currentBalance;

    if (isActive) {
      transactionType = 'WALLET';
      transactionDescription = 'Funds added to wallet - Manual resolution';
      newBalance = totalAvailable;
      shouldActivate = false;
    } else {
      if (totalAvailable >= packagePrice) {
        transactionType = 'SUBSCRIPTION';
        transactionDescription = `Subscription activated via manual resolution - ${packageDoc.packageName}`;
        newBalance = totalAvailable - packagePrice;
        shouldActivate = true;
      } else {
        transactionType = 'WALLET';
        transactionDescription = 'Insufficient balance - funds added to wallet (direct payment)';
        newBalance = totalAvailable;
        shouldActivate = false;
      }
    }

    // Create MPESA transaction (credit)
    const mpesaTransaction = await Transaction.create({
      type: 'MPESA',
      customerType: payment.customerType,
      customerId: customer._id,
      accountId: payment.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: payment.amount,
      description: 'M-Pesa direct payment',
      paymentMethod: 'till', // differentiate from STK
      mpesa: {
        transactionId: payment.mpesaReceiptNumber,
        phoneNumber: mpesaData.phoneNumber,
        accountReference: payment.stkID,
        transactionDate: parseMpesaDate(mpesaData.transactionDate)
      },
      status: 'completed'
    });

    // Create second transaction
    const secondTransaction = await Transaction.create({
      type: transactionType,
      customerType: payment.customerType,
      customerId: customer._id,
      accountId: payment.accountId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      regionCode: payment.regionCode,
      siteId: payment.siteId,
      amount: transactionType === 'SUBSCRIPTION' ? -packagePrice : -payment.amount,
      description: transactionDescription,
      paymentMethod: 'till',
      packageId: transactionType === 'SUBSCRIPTION' ? packageDoc._id : undefined,
      relatedTransactionId: mpesaTransaction._id,
      status: 'completed'
    });

    // Link transactions
    mpesaTransaction.relatedTransactionId = secondTransaction._id;
    await mpesaTransaction.save();

    // Update customer balance
    customer.billing.balance = newBalance;
    customer.billing.lastPaymentDate = now;

    // Handle activation if needed
    if (shouldActivate && payment.customerType === 'pppoe') {
      const currentExpiry = customer.subscription.expiresAt;
      const baseDate = isActive && currentExpiry > now ? currentExpiry : now;
      customer.subscription.expiresAt = calculatePeriodEnd(
        baseDate,
        packageDoc.period,
        packageDoc.periodUnit
      );
      customer.subscription.status = 'active';
      customer.subscription.activatedAt = now;
      customer.renewals.push({
        dateRenewed: now,
        method: 'manual'
      });

     


       await customer.save();
        const site = await Site.findById(payment.siteId);
        if (site) {
          try {
            await activateAccount(customer, packageDoc);
            console.log('✅ RADIUS account activated');
          } catch (err) {
            console.error('⚠️ RADIUS activation failed:', err.message);
            // Optionally add a system log entry
          }
        }
    } else if (shouldActivate && payment.customerType === 'hotspot') {
      customer.activeSession = {
        packageId: packageDoc._id,
        startedAt: now,
        expiresAt: calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit),
        dataLimit: packageDoc.dataLimit,
        dataUsed: 0,
        isActive: true
      };
      customer.purchaseHistory.push({
        packageId: packageDoc._id,
        purchasedAt: now,
        amount: payment.amount,
        transactionId: mpesaTransaction._id
      });
      await customer.save();
    } else {
      // Just save balance update
      await customer.save();
    }

    // Log system event
    await SystemLog.create({
      eventType: shouldActivate ? 'subscription_renewal' : 'payment_received',
      severity: 'info',
      regionCode: payment.regionCode,
      entityType: payment.customerType === 'pppoe' ? 'customer' : 'hotspot_user',
      entityId: customer._id,
      accountId: payment.accountId,
      message: shouldActivate
        ? `Subscription activated via direct payment for ${payment.accountId}`
        : `Direct payment added to wallet for ${payment.accountId}`,
      details: {
        amount: payment.amount,
        mpesaReceipt: payment.mpesaReceiptNumber,
        transactionType,
        newBalance,
        activated: shouldActivate
      },
      success: true,
      relatedTransactionId: mpesaTransaction._id,
      relatedPaymentId: payment._id
    });

    console.log('✅ [processDirectPayment] Completed successfully');
  } catch (error) {
    console.error('🔥 [processDirectPayment] Error:', error);
    throw error;
  }
}


