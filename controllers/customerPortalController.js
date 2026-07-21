const asyncHandler = require("../middleware/asyncHandler");
const { ErrorResponse } = require("../middleware/errorHandler");
const Customer = require("../models/Customer");
const Payment = require("../models/Payment");
const Transaction = require("../models/Transaction");
const Package = require("../models/Package");
const Site = require("../models/Site");
const ONU = require("../models/ONU");
const OLT = require("../models/OLT");
const SmsLog = require("../models/SmsLog");
const SystemLog = require("../models/SystemLog");
const { formatPhoneNumber } = require("../utils/phoneHelpers");
const { calculatePeriodEnd } = require("../utils/invoiceHelpers");
const mpesaService = require("../services/mpesaService");
const radiusService = require("../services/radiusService");
const jwt = require("jsonwebtoken");

// ============================================
// HELPERS
// ============================================

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


function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(customerId) {
  return jwt.sign(
    { id: customerId, type: "customer" },
    process.env.JWT_SECRET || "your-secret-key",
    { expiresIn: "7d" }
  );
}



async function resolveAccessibleCustomer(loggedInCustomer, accountId) {
  if (!accountId) return loggedInCustomer;

  const target = await Customer.findById(accountId)
    .populate("siteId")
    .populate("subscription.packageId");

  if (!target) throw new Error("Target account not found");

  const isSelf = target._id.toString() === loggedInCustomer._id.toString();
  const isChild =
    target.parentAccount &&
    target.parentAccount.toString() === loggedInCustomer._id.toString();

  if (!isSelf && !isChild) throw new Error("Unauthorized access to target account");

  return target;
}


// Helper to get last session end time from RADIUS
const getLastSessionEndTime = async (username) => {
  let conn;
  try {
    conn = await radiusService.getConnection();
    const [rows] = await conn.query(
      `SELECT acctstoptime FROM radacct 
       WHERE username = ? AND acctstoptime IS NOT NULL 
       ORDER BY acctstoptime DESC LIMIT 1`,
      [username]
    );
    if (rows.length > 0 && rows[0].acctstoptime) {
      return new Date(rows[0].acctstoptime);
    }
    return null;
  } catch (err) {
    console.error('Error fetching last session end time:', err);
    return null;
  } finally {
    if (conn) conn.release();
  }
};

const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '0s';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
};

const fetchConnectionStatusFromRadius = async (customer) => {
  if (!customer.pppoe?.username) {
    return {
      accountId: customer.accountId,
      customerName: `${customer.firstName} ${customer.lastName}`,
      status: 'offline',
      reason: 'No PPPoE credentials',
      lastSeen: customer.createdAt.toISOString(),
      offlineDuration: formatDuration(Math.floor((Date.now() - new Date(customer.createdAt).getTime()) / 1000)),
    };
  }

  const radiusService = require('../services/radiusService');
  const expectedNasIp = customer.siteId?.router?.ip || null;
  const statusResult = await radiusService.getUserConnectionStatus(customer.pppoe.username, expectedNasIp);

  // Determine status from IP
  const getStatusFromIp = (ipAddress) => {
    if (!ipAddress) return 'offline';
    const parts = ipAddress.split('.').map(Number);
    if (parts.length !== 4) return 'offline';
    if (parts[0] === 10 && parts[1] === 10 && parts[2] >= 0 && parts[2] <= 255 && parts[3] >= 2 && parts[3] <= 254) return 'online';
    if (parts[0] === 10 && parts[1] === 254 && parts[2] === 254 && parts[3] >= 2 && parts[3] <= 254) return 'expired';
    if (parts[0] === 20 && parts[1] === 20 && parts[2] === 0 && parts[3] >= 2 && parts[3] <= 254) return 'wrong-password';
    if (parts[0] === 30 && parts[1] === 30 && parts[2] === 0 && parts[3] >= 2 && parts[3] <= 254) return 'non-existent';
    if (parts[0] === 40 && parts[1] === 40 && parts[2] === 0 && parts[3] >= 2 && parts[3] <= 254) return 'mac-mismatch';
    return 'offline';
  };

  const statusType = getStatusFromIp(statusResult.ipAddress);

  const now = new Date();

  if (statusType === 'online') {
    return {
      accountId: customer.accountId,
      customerName: `${customer.firstName} ${customer.lastName}`,
      status: 'online',
      ipAddress: statusResult.ipAddress,
      uptime: formatDuration(statusResult.sessionTime),
      onlineSince: statusResult.startTime?.toISOString() || now.toISOString(),
      lastSeen: now.toISOString(),
    };
  }

  // online but limited (expired, wrong password, etc.)
  if (['expired', 'wrong-password', 'non-existent', 'mac-mismatch'].includes(statusType)) {
    let reason = '';
    if (statusType === 'expired') reason = 'Account disabled';
    else if (statusType === 'wrong-password') reason = 'Wrong password';
    else if (statusType === 'non-existent') reason = 'User does not exist';
    else if (statusType === 'mac-mismatch') reason = 'MAC address mismatch';

    return {
      accountId: customer.accountId,
      customerName: `${customer.firstName} ${customer.lastName}`,
      status: 'online-no-internet',
      ipAddress: statusResult.ipAddress,
      uptime: formatDuration(statusResult.sessionTime),
      onlineSince: statusResult.startTime?.toISOString() || now.toISOString(),
      lastSeen: now.toISOString(),
      reason,
    };
  }

  // Offline – use RADIUS history for last seen
  const lastEndTime = await getLastSessionEndTime(customer.pppoe.username);
  const lastSeen = lastEndTime || customer.createdAt;
  const offlineMs = Date.now() - new Date(lastSeen).getTime();
  const offlineDuration = formatDuration(Math.floor(offlineMs / 1000));

  return {
    accountId: customer.accountId,
    customerName: `${customer.firstName} ${customer.lastName}`,
    status: 'offline',
    lastSeen: lastSeen.toISOString(),
    offlineDuration,
    offlineSince: lastSeen.toISOString(),
    reason: statusResult.authFailure ? 'Authentication failed' : 'No active session',
  };
};

// ============================================
// AUTHENTICATION (unchanged)
// ============================================

exports.requestOTP = asyncHandler(async (req, res, next) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) return next(new ErrorResponse("Phone number is required", 400));

  const formattedPhone = formatPhoneNumber(phoneNumber);
  const customer = await Customer.findOne({ phoneNumber: formattedPhone, isActive: true });
  if (!customer) return next(new ErrorResponse("No account found with this phone number", 404));

  const otp = generateOTP();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  customer.otp = { code: otp, expiresAt: otpExpiry, attempts: 0 };
  await customer.save();


  try{
    const mobileSasaService = require('../services/mobileSasaService');
    const smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your one time password is ${otp} and is valid until ${otpExpiry.toLocaleTimeString()}. If you did not equest it, please ignore this message.`
  
    const smsResult = await mobileSasaService.sendSingle(customer.phoneNumber, smsMessage);

    if(smsResult.success){
      await logSms(
        { phoneNumber: customer.phoneNumber, customerId: customer?._id, accountId: customer?.accountId },
        smsMessage,
        'otp',
        req.regionFilter?.regionCode || null,
        smsResult.response,
        'sent',
        smsResult.cost
      );
  
    }else{
      await logSms(
        { phoneNumber: customer.phoneNumber, customerId: customer?._id, accountId: customer?.accountId },
        smsMessage,
        'otp',
        req.regionFilter?.regionCode || null,
        null,
        'failed',
        null,
        { code: 'api_error'}
      );
   
    }
  }catch(err){
    console.error("Could not send sms: ", err);
  }





  await SystemLog.create({
    eventType: "customer_otp_requested",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `OTP requested for customer portal login: ${customer.accountId}`,
    success: true,
  });

  res.status(200).json({
    success: true,
    message: "OTP sent to your phone number",
    data: {
      phoneNumber: formattedPhone,
      expiresIn: 600,
      ...(process.env.NODE_ENV === "development" && { otp }),
    },
  });
});

exports.verifyOTP = asyncHandler(async (req, res, next) => {
  const { phoneNumber, otp } = req.body;
  if (!phoneNumber || !otp) return next(new ErrorResponse("Phone number and OTP are required", 400));

  const formattedPhone = formatPhoneNumber(phoneNumber);
  const customer = await Customer.findOne({ phoneNumber: formattedPhone, isActive: true })
    .populate("subscription.packageId")
    .populate("siteId")
    .select("+otp.code +otp.expiresAt +otp.attempts");

  if (!customer) return next(new ErrorResponse("Invalid phone number", 404));

  if (!customer.otp || !customer.otp.code) {
    return next(new ErrorResponse("No OTP found. Please request a new one.", 400));
  }

  if (new Date() > customer.otp.expiresAt) {
    customer.otp = undefined;
    await customer.save();
    return next(new ErrorResponse("OTP has expired. Please request a new one.", 400));
  }

  if (customer.otp.attempts >= 3) {
    customer.otp = undefined;
    await customer.save();
    return next(new ErrorResponse("Too many failed attempts. Please request a new OTP.", 400));
  }

  if (customer.otp.code !== otp) {
    customer.otp.attempts += 1;
    await customer.save();
    return next(new ErrorResponse(`Invalid OTP. ${3 - customer.otp.attempts} attempts remaining.`, 400));
  }

  customer.otp = undefined;
  customer.lastLogin = new Date();
  await customer.save();

  const token = generateToken(customer._id);

  await SystemLog.create({
    eventType: "customer_portal_login",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Customer logged in to portal: ${customer.accountId}`,
    success: true,
  });

  res.status(200).json({
    success: true,
    message: "Login successful",
    data: {
      token,
      customer: {
        id: customer._id,
        accountId: customer.accountId,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phoneNumber: customer.phoneNumber,
        email: customer.email,
        subscription: {
          status: customer.subscription.status,
          packageName: customer.subscription.packageId?.packageName,
          expiresAt: customer.subscription.expiresAt,
        },
        balance: customer.billing.balance,
      },
    },
  });
});

// ============================================
// PROFILE (unchanged)
// ============================================

exports.getProfile = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.customerId)
    .populate("subscription.packageId")
    .populate("siteId")
    .populate("parentAccount", "accountId firstName lastName")
    .select("-pppoe.password");

  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  let children = [];
  if (!customer.isChild) {
    children = await Customer.find({ parentAccount: customer._id })
      .populate("subscription.packageId")
      .select("-pppoe.password -cpe.wifiPassword");
  }

  res.status(200).json({ success: true, data: { customer, children } });
});

exports.updateProfile = asyncHandler(async (req, res, next) => {
  const { email, alternatePhoneNumber, location, phoneNumber, firstName, lastName, updateChildren = false } = req.body;

  const customer = await Customer.findById(req.customerId);
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  if (email) customer.email = email;
  if (alternatePhoneNumber) customer.alternatePhoneNumber = formatPhoneNumber(alternatePhoneNumber);
  if (location) customer.location = { ...customer.location, ...location };
  if (firstName) customer.firstName = firstName;
  if (lastName) customer.lastName = lastName;
  if (phoneNumber) customer.phoneNumber = formatPhoneNumber(phoneNumber);

  await customer.save();

  if (!customer.isChild && updateChildren) {
    const children = await Customer.find({ parentAccount: customer._id });
    const childUpdates = [];

    for (const child of children) {
      let updated = false;
      if (email) {
        child.email = email;
        updated = true;
      }
      if (alternatePhoneNumber) {
        child.alternatePhoneNumber = formatPhoneNumber(alternatePhoneNumber);
        updated = true;
      }
      if (location) {
        child.location = { ...child.location, ...location };
        updated = true;
      }
      if (firstName) {
        child.firstName = firstName;
        updated = true;
      }
      if (lastName) {
        child.lastName = lastName;
        updated = true;
      }
      if (phoneNumber) {
        child.phoneNumber = formatPhoneNumber(phoneNumber);
        updated = true;
      }
      if (updated) {
        await child.save();
        childUpdates.push(child.accountId);
      }
    }

    if (childUpdates.length) {
      await SystemLog.create({
        eventType: "parent_profile_updated",
        severity: "info",
        regionCode: customer.regionCode,
        entityType: "customer",
        entityId: customer._id,
        accountId: customer.accountId,
        message: `Parent updated profile; changes applied to children: ${childUpdates.join(", ")}`,
        details: { updatedFields: Object.keys(req.body).filter(k => k !== "updateChildren"), children: childUpdates },
        success: true,
      });
    }
  }

  res.status(200).json({ success: true, message: "Profile updated successfully", data: customer });
});

// ============================================
// SUBSCRIPTION & BILLING (unchanged)
// ============================================

exports.getSubscription = asyncHandler(async (req, res, next) => {
  const { accountId } = req.query;

  const loggedInCustomer = await Customer.findById(req.customerId)
    .populate("subscription.packageId")
    .populate("siteId");

  if (!loggedInCustomer) return next(new ErrorResponse("Customer not found", 404));

  const target = await resolveAccessibleCustomer(loggedInCustomer, accountId);

  let daysRemaining = 0;
  if (target.subscription.status === "active" && target.subscription.expiresAt) {
    const now = new Date();
    const expiresAt = new Date(target.subscription.expiresAt);
    daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
  }

  res.status(200).json({
    success: true,
    data: {
      subscription: {
        status: target.subscription.status,
        package: target.subscription.packageId,
        activatedAt: target.subscription.activatedAt,
        expiresAt: target.subscription.expiresAt,
        daysRemaining,
        autoRenew: target.subscription.autoRenew,
      },
      billing: {
        balance: target.billing.balance,
        totalPaid: target.billing.totalPaid,
        totalOwed: target.billing.totalOwed,
      },
    },
  });
});

exports.getPayments = asyncHandler(async (req, res, next) => {
  const { accountId, page = 1, limit = 20 } = req.query;
  const customerId = accountId ? accountId : req.customerId;

  const payments = await Payment.find({ customerId, status: { $ne: "failed" } })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Payment.countDocuments({ customerId, status: { $ne: "failed" } });

  res.status(200).json({
    success: true,
    data: { payments, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } },
  });
});

exports.getTransactions = asyncHandler(async (req, res, next) => {
  const { accountId, page = 1, limit = 20 } = req.query;
  const customerId = accountId ? accountId : req.customerId;

  const transactions = await Transaction.find({ customerId })
    .sort({ processedAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Transaction.countDocuments({ customerId });

  res.status(200).json({
    success: true,
    data: { transactions, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } },
  });
});

exports.getPaymentAccounts = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.customerId).populate("subscription.packageId").select("-pppoe.password");
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  const accounts = [
    {
      id: customer._id,
      accountId: customer.accountId,
      name: `${customer.firstName} ${customer.lastName}`,
      package: customer.subscription.packageId?.packageName,
      packagePrice: customer.subscription.packageId?.price,
      status: customer.subscription.status,
      expiresAt: customer.subscription.expiresAt,
      isOwn: true,
      isChild: false,
      customerType: customer.customerType,
    },
  ];

  if (!customer.isChild) {
    const children = await Customer.find({ parentAccount: customer._id })
      .populate("subscription.packageId")
      .select("-pppoe.password");

    children.forEach((child) =>
      accounts.push({
        id: child._id,
        accountId: child.accountId,
        name: `${child.firstName} ${child.lastName}`,
        package: child.subscription.packageId?.packageName,
        packagePrice: child.subscription.packageId?.price,
        status: child.subscription.status,
        expiresAt: child.subscription.expiresAt,
        isOwn: false,
        isChild: true,
        customerType: child.customerType,
      })
    );
  }

  res.status(200).json({ success: true, data: { accounts, totalAccounts: accounts.length } });
});

exports.initiatePayment = asyncHandler(async (req, res, next) => {
  const { accountId, phoneNumber } = req.body;
  if (!accountId || !phoneNumber) return next(new ErrorResponse("Account ID and phone number are required", 400));

  const payingCustomer = await Customer.findById(req.customerId);
  if (!payingCustomer) return next(new ErrorResponse("Customer not found", 404));

  const targetCustomer = await resolveAccessibleCustomer(payingCustomer, accountId);
  const packageDoc = targetCustomer.subscription.packageId;
  if (!packageDoc) return next(new ErrorResponse("No package assigned to this account", 400));

  const amount = packageDoc.price;
  const formattedPhone = formatPhoneNumber(phoneNumber);

  try {
    const stkResult = await mpesaService.initiateSTKPush(formattedPhone, amount, `Payment for ${targetCustomer.accountId}`, {
      customerId: targetCustomer._id,
      accountId: targetCustomer.accountId,
      packageId: packageDoc._id,
      initiatedBy: payingCustomer._id,
    });

    if (!stkResult.success) return next(new ErrorResponse(stkResult.error || "Failed to initiate payment", 500));

    await SystemLog.create({
      eventType: "customer_payment_initiated",
      severity: "info",
      regionCode: targetCustomer.regionCode,
      entityType: "customer",
      entityId: targetCustomer._id,
      accountId: targetCustomer.accountId,
      message: `Customer portal payment initiated by ${payingCustomer.accountId} for ${targetCustomer.accountId}`,
      details: { amount, phoneNumber: formattedPhone, checkoutRequestId: stkResult.CheckoutRequestID },
      success: true,
    });

    res.status(200).json({
      success: true,
      message: "Payment request sent. Please check your phone to complete the payment.",
      data: { checkoutRequestId: stkResult.CheckoutRequestID, merchantRequestId: stkResult.MerchantRequestID, amount, accountId: targetCustomer.accountId },
    });
  } catch (error) {
    console.error("❌ STK Push error:", error);
    next(new ErrorResponse("Failed to initiate payment", 500));
  }
});

// ============================================
// CONNECTION STATUS (UPDATED – RADIUS based)
// ============================================

exports.getConnectionStatus = asyncHandler(async (req, res, next) => {
  const { accountId } = req.query;

  const loggedInCustomer = await Customer.findById(req.customerId)
    .populate("siteId")
    .populate("subscription.packageId");
  if (!loggedInCustomer) return next(new ErrorResponse("Customer not found", 404));

  try {
    if (accountId) {
      const target = await resolveAccessibleCustomer(loggedInCustomer, accountId);
      const status = await fetchConnectionStatusFromRadius(target);
      return res.status(200).json({ success: true, data: status });
    }

    // No accountId – return all accessible accounts (self + children)
    const targets = [loggedInCustomer];
    if (!loggedInCustomer.isChild) {
      const children = await Customer.find({ parentAccount: loggedInCustomer._id })
        .populate("siteId")
        .populate("subscription.packageId");
      targets.push(...children);
    }

    const statuses = await Promise.all(targets.map(fetchConnectionStatusFromRadius));
    res.status(200).json({ success: true, data: statuses });
  } catch (error) {
    console.error("❌ Connection status error:", error);
    if (error.message === "Target account not found") return next(new ErrorResponse("Target account not found", 404));
    if (error.message === "Unauthorized access to target account") return next(new ErrorResponse("You can only view your own or child account status", 403));
    next(new ErrorResponse("Failed to get connection status", 500));
  }
});

// ============================================
// ONU MANAGEMENT (unchanged)
// ============================================

exports.getOnuStatus = asyncHandler(async (req, res, next) => {
  const { accountId } = req.query;
  const loggedInCustomer = await Customer.findById(req.customerId);
  if (!loggedInCustomer) return next(new ErrorResponse("Customer not found", 404));

  try {
    const customer = await resolveAccessibleCustomer(loggedInCustomer, accountId);
    const onu = await ONU.findOne({ customerId: customer._id, isActive: true }).populate("oltId");
    if (!onu) return next(new ErrorResponse("No ONU found for this account", 404));

    const olt = await OLT.findById(onu.oltId).select("+password");
    if (!olt) return next(new ErrorResponse("OLT not found", 404));

    const oltService = require("../services/olt");
    const detailsResult = await oltService.getOnuDetails(olt, onu.ponPort, onu.onuId);
    const powerResult = await oltService.getOnuOpticalPower(olt, onu.ponPort, onu.onuId);

    res.status(200).json({
      success: true,
      data: {
        onu: {
          serialNumber: onu.serialNumber,
          ponPort: onu.ponPort,
          onuId: onu.onuId,
          status: onu.status,
          brand: onu.brand,
          model: onu.model,
        },
        connection: detailsResult.success ? { status: detailsResult.data.status || "online", details: detailsResult.data } : { status: "unknown", error: detailsResult.error },
        opticalPower: powerResult.success ? { rxPower: powerResult.rxPower, txPower: powerResult.txPower, unit: "dBm" } : null,
        lastChecked: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("❌ ONU status error:", error);
    if (error.message === "Target account not found") return next(new ErrorResponse("Target account not found", 404));
    if (error.message === "Unauthorized access to target account") return next(new ErrorResponse("You can only view your own or child account ONU", 403));
    next(new ErrorResponse("Failed to get ONU status", 500));
  }
});

exports.getOnuDevices = asyncHandler(async (req, res, next) => {
  const loggedInCustomer = await Customer.findById(req.customerId);
  if (!loggedInCustomer) return next(new ErrorResponse("Customer not found", 404));
  res.status(200).json({
    success: true,
    message: "Device list feature coming soon",
    data: {
      cpe: loggedInCustomer.cpe || null,
      note: "This feature requires ONU management protocol integration (TR-069/SNMP)",
    },
  });
});

exports.updateWiFiCredentials = asyncHandler(async (req, res, next) => {
  const { wifiName, wifiPassword, accountId } = req.body;
  if (!wifiName && !wifiPassword) return next(new ErrorResponse("WiFi name or password is required", 400));

  const loggedInCustomer = await Customer.findById(req.customerId);
  if (!loggedInCustomer) return next(new ErrorResponse("Customer not found", 404));

  const customer = await resolveAccessibleCustomer(loggedInCustomer, accountId);
  if (wifiPassword && wifiPassword.length < 8) return next(new ErrorResponse("WiFi password must be at least 8 characters", 400));

  customer.cpe = customer.cpe || {};
  if (wifiName) customer.cpe.wifiName = wifiName;
  if (wifiPassword) customer.cpe.wifiPassword = wifiPassword;

  await customer.save();
  await SystemLog.create({
    eventType: "customer_wifi_updated",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Customer updated WiFi credentials via portal: ${customer.accountId}`,
    success: true,
  });

  res.status(200).json({
    success: true,
    message: "WiFi credentials updated successfully. Please reboot your router for changes to take effect.",
    data: { wifiName: customer.cpe.wifiName, note: "Reboot your router to apply new settings" },
  });
});

exports.rebootOnu = asyncHandler(async (req, res, next) => {
  const { accountId } = req.body;
  const loggedInCustomer = await Customer.findById(req.customerId);
  if (!loggedInCustomer) return next(new ErrorResponse("Customer not found", 404));

  const customer = await resolveAccessibleCustomer(loggedInCustomer, accountId);
  const onu = await ONU.findOne({ customerId: customer._id, isActive: true });
  if (!onu) return next(new ErrorResponse("No ONU found for this account", 404));

  const olt = await OLT.findById(onu.oltId).select("+password");
  if (!olt) return next(new ErrorResponse("OLT not found", 404));

  try {
    const oltService = require("../services/olt");
    const result = await oltService.rebootOnu(olt, onu.ponPort, onu.onuId);
    if (!result.success) throw new Error(result.error || "Reboot failed");

    await SystemLog.create({
      eventType: "customer_onu_reboot",
      severity: "info",
      regionCode: customer.regionCode,
      entityType: "onu",
      entityId: onu._id,
      message: `Customer initiated ONU reboot via portal: ${customer.accountId}`,
      success: true,
    });

    res.status(200).json({ success: true, message: "ONU reboot initiated successfully. Your connection will be back online in about 2-3 minutes." });
  } catch (error) {
    console.error("❌ ONU reboot error:", error);
    next(new ErrorResponse("Failed to reboot ONU", 500));
  }
});

exports.getSupportInfo = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.customerId).populate("siteId");
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  const site = customer.siteId;
  res.status(200).json({
    success: true,
    data: {
      site: {
        name: site?.siteName,
        contactPerson: site?.contactPerson,
        phone: site?.contactPerson?.phone,
        email: site?.contactPerson?.email,
      },
      general: {
        supportEmail: process.env.SUPPORT_EMAIL || "support@yourcompany.com",
        supportPhone: process.env.SUPPORT_PHONE || "+254700000000",
        workingHours: "8:00 AM - 6:00 PM, Monday to Saturday",
      },
    },
  });
});

// ============================================
// CHANGE PACKAGE (UPDATED – with FUP handling)
// ============================================

exports.changePackage = asyncHandler(async (req, res, next) => {
  const { accountId, packageId } = req.body;
  if (!accountId || !packageId) return next(new ErrorResponse("Account ID and Package ID are required", 400));

  const loggedInCustomer = await Customer.findById(req.customerId);
  if (!loggedInCustomer) return next(new ErrorResponse("Customer not found", 404));

  const targetCustomer = await resolveAccessibleCustomer(loggedInCustomer, accountId);
  if (!targetCustomer) return next(new ErrorResponse("Customer not found", 404));

  const newPackage = await Package.findById(packageId);
  if (!newPackage) return next(new ErrorResponse("Package not found", 404));

  if (newPackage.siteId.toString() !== targetCustomer.siteId._id.toString()) {
    return next(new ErrorResponse("Package does not belong to your site", 400));
  }
  if (newPackage.packageType !== 'ppp') {
    return next(new ErrorResponse("Invalid package type", 400));
  }

  if (targetCustomer.subscription.packageId?.toString() === packageId) {
    return next(new ErrorResponse("You are already on this package", 400));
  }

  const oldPackage = await Package.findById(targetCustomer.subscription.packageId);
  if (!oldPackage) return next(new ErrorResponse("Previous package not found", 404));

  const oldPrice = oldPackage.price;
  const newPrice = newPackage.price;
  const balance = targetCustomer.billing?.balance || 0;
  let willHaveConnection = false;

  // Upgrade / Downgrade logic
  if (newPrice > oldPrice) {
    if (targetCustomer.subscription.status === 'active') {
      const priceDiff = newPrice - oldPrice;
      if (balance < priceDiff) return next(new ErrorResponse("Insufficient balance to upgrade package", 400));
      targetCustomer.billing.balance = balance - priceDiff;
      willHaveConnection = true;
    }
  } else if (newPrice < oldPrice) {
    if (targetCustomer.subscription.status === 'active') {
      return next(new ErrorResponse("Cannot downgrade while your subscription is active", 400));
    }
    // Inactive – check if they can be reactivated
    if (balance >= newPrice) {
      targetCustomer.subscription.status = 'active';
      targetCustomer.billing.balance = balance - newPrice;
      targetCustomer.notes.push({
        note: `Reactivated due to downgrade to ${newPackage.packageName} (balance sufficient)`,
        addedBy: req.customerId,
        createdAt: new Date(),
      });
      willHaveConnection = true;
    }
  }
  // Equal price: no balance change, connection remains as is

  // Update subscription
  targetCustomer.subscription.packageId = newPackage._id;
  if (willHaveConnection || newPrice > oldPrice) {
    const now = new Date();
    const currentExpiry = targetCustomer.subscription.expiresAt;
    const baseDate = (targetCustomer.subscription.status === 'active' && currentExpiry > now) ? currentExpiry : now;
    targetCustomer.subscription.expiresAt = calculatePeriodEnd(baseDate, newPackage.period, newPackage.periodUnit);
  }

  // FUP handling
  if (targetCustomer.fupEnabled && newPackage.fup?.enabled) {
    // Update Max-Monthly-Traffic quota in radcheck
    const quotaBytes = newPackage.fup.dataThresholdGB * 1024 * 1024 * 1024;
    await radiusService.enableFUPForCustomer(targetCustomer.pppoe.username, quotaBytes);
    // Reset billing cycle if package uses billingCycle reset
    if (newPackage.fup.resetPeriod === 'billingCycle') {
    }
  } else if (targetCustomer.fupEnabled && !newPackage.fup?.enabled) {
    // Package doesn't support FUP – disable FUP for customer
    await radiusService.disableFUPForCustomer(targetCustomer.pppoe.username);
    targetCustomer.fupEnabled = false;
  } else if (!targetCustomer.fupEnabled && newPackage.fup?.enabled && req.body.enableFUP === true) {
    // Optionally allow enabling FUP during package change
    const quotaBytes = newPackage.fup.dataThresholdGB * 1024 * 1024 * 1024;
    await radiusService.enableFUPForCustomer(targetCustomer.pppoe.username, quotaBytes);
    targetCustomer.fupEnabled = true;
    
  }

  targetCustomer.notes.push({
    note: `Package changed from ${oldPackage.packageName} to ${newPackage.packageName}`,
    addedBy: req.customerId,
    createdAt: new Date(),
  });

  await targetCustomer.save();

  // Update RADIUS bandwidth
  const groupName = newPackage.packageName.replace(/\s+/g, '_').toUpperCase();
  await radiusService.updateBandwidth(targetCustomer.pppoe.username, newPackage.speed.upload, newPackage.speed.download, groupName);

  if (willHaveConnection) {
    await radiusService.enableAccount(targetCustomer.pppoe.username, groupName);
  }

  // Log
  await SystemLog.create({
    eventType: "customer_package_changed",
    severity: "info",
    regionCode: targetCustomer.regionCode,
    entityType: "customer",
    entityId: targetCustomer._id,
    accountId: targetCustomer.accountId,
    message: `Package changed via portal for ${targetCustomer.accountId}`,
    details: { oldPackage: oldPackage._id, newPackage: newPackage._id, willHaveConnection },
    triggeredBy: req.customerId,
    success: true,
  });

  res.status(200).json({
    success: true,
    message: "Package changed successfully",
    data: {
      accountId: targetCustomer.accountId,
      packageId: newPackage._id,
      newExpiry: targetCustomer.subscription.expiresAt,
      newBalance: targetCustomer.billing.balance,
    },
  });
});

exports.getAvailablePackages = asyncHandler(async (req, res, next) => {
  const { packageType = "ppp", isActive = "true" } = req.query;

  const customer = await Customer.findById(req.customerId).select("siteId regionCode isActive");
  if (!customer || !customer.isActive) return next(new ErrorResponse("Customer not found", 404));
  if (!customer.siteId) return next(new ErrorResponse("Customer site not found", 400));

  const query = {
    ...req.regionFilter,
    siteId: customer.siteId,
    isActive: isActive === "true",
  };
  if (packageType) query.packageType = packageType;

  const packages = await Package.find(query).populate("siteId", "siteName regionCode").sort({ priority: 1, price: 1 });

  res.status(200).json({
    success: true,
    message: "Available packages retrieved successfully",
    data: { packages },
  });
});


// ============================================
// MOVE EXPIRY DATE
// ============================================

/**
 * Helper: Calculate daily rate for a package (in KES per day)
 */
function calculateDailyRate(packageDoc) {
  let days = packageDoc.period;
  if (packageDoc.periodUnit === 'm') {
    days = packageDoc.period / (24 * 60); // minutes to days
  } else if (packageDoc.periodUnit === 'h') {
    days = packageDoc.period / 24; // hours to days
  }
  // For 'd', days = period (already days)
  if (days <= 0) days = 30; // fallback to 30 days if invalid
  return packageDoc.price / days;
}

/**
 * @desc    Calculate cost to move expiry date forward (customer portal)
 * @route   POST /api/customer-portal/calculate-expiry-move
 * @access  Private (Customer portal)
 */
exports.calculateExpiryMove = asyncHandler(async (req, res, next) => {
  const { accountId, targetDate } = req.body;
  if (!targetDate) return next(new ErrorResponse("Target date is required", 400));

  const loggedInCustomer = await Customer.findById(req.customerId).populate("subscription.packageId");
  if (!loggedInCustomer) return next(new ErrorResponse("Customer not found", 404));

  const target = await resolveAccessibleCustomer(loggedInCustomer, accountId);
  if (!target) return next(new ErrorResponse("Target account not found", 404));

  if (target.subscription.status !== "active") {
    return next(new ErrorResponse("Only active subscriptions can be extended", 400));
  }

  const currentExpiry = new Date(target.subscription.expiresAt);
  const newExpiry = new Date(targetDate);
  if (isNaN(newExpiry.getTime())) return next(new ErrorResponse("Invalid target date", 400));
  if (newExpiry <= currentExpiry) {
    return next(new ErrorResponse("Target date must be after current expiry date", 400));
  }

  const packageDoc = target.subscription.packageId;
  const dailyRate = calculateDailyRate(packageDoc);
  const daysToAdd = Math.ceil((newExpiry - currentExpiry) / (1000 * 60 * 60 * 24));
  const proratedAmount = dailyRate * daysToAdd;
  const convenienceFee = 100;
  const total = Math.ceil(proratedAmount + convenienceFee);
  const balance = target.billing?.balance || 0;
  const hasEnoughBalance = balance >= total;

  res.json({
    success: true,
    data: {
      accountId: target.accountId,
      currentExpiry: currentExpiry.toISOString(),
      targetExpiry: newExpiry.toISOString(),
      daysToAdd,
      dailyRate: dailyRate.toFixed(2),
      proratedAmount: Math.ceil(proratedAmount),
      convenienceFee,
      total,
      balance,
      hasEnoughBalance,
    },
  });
});

/**
 * @desc    Move expiry date forward (deduct from wallet) – customer portal
 * @route   POST /api/customer-portal/move-expiry
 * @access  Private (Customer portal)
 */
exports.moveExpiry = asyncHandler(async (req, res, next) => {
  const { accountId, targetDate } = req.body;
  if (!targetDate) return next(new ErrorResponse("Target date is required", 400));

  const loggedInCustomer = await Customer.findById(req.customerId).populate("subscription.packageId");
  if (!loggedInCustomer) return next(new ErrorResponse("Customer not found", 404));

  const target = await resolveAccessibleCustomer(loggedInCustomer, accountId);
  if (!target) return next(new ErrorResponse("Target account not found", 404));

  if (target.subscription.status !== "active") {
    return next(new ErrorResponse("Only active subscriptions can be extended", 400));
  }

  const currentExpiry = new Date(target.subscription.expiresAt);
  const newExpiry = new Date(targetDate);
  if (isNaN(newExpiry.getTime())) return next(new ErrorResponse("Invalid target date", 400));
  if (newExpiry <= currentExpiry) {
    return next(new ErrorResponse("Target date must be after current expiry date", 400));
  }

  const packageDoc = target.subscription.packageId;
  const dailyRate = calculateDailyRate(packageDoc);
  const daysToAdd = Math.ceil((newExpiry - currentExpiry) / (1000 * 60 * 60 * 24));
  const proratedAmount = Math.ceil(dailyRate * daysToAdd);
  const convenienceFee = 100;
  const total = proratedAmount + convenienceFee;
  const balance = target.billing?.balance || 0;

  if (balance < total) {
    return next(new ErrorResponse(`Insufficient balance. Need KES ${total}. Please top up your wallet first.`, 400));
  }

  // Deduct from wallet
  target.billing.balance = balance - total;
  // Update expiry date
  target.subscription.expiresAt = newExpiry;
  // Add note
  target.notes.push({
    note: `Expiry moved forward from ${currentExpiry.toISOString()} to ${newExpiry.toISOString()} (cost: KES ${total})`,
    addedBy: req.customerId,
    addedAt: new Date(),
  });
  await target.save();

  // Log the transaction
  await SystemLog.create({
    eventType: "expiry_moved",
    severity: "info",
    regionCode: target.regionCode,
    entityType: "customer",
    entityId: target._id,
    accountId: target.accountId,
    message: `Expiry moved forward by ${daysToAdd} days for ${target.accountId}`,
    details: {
      previousExpiry: currentExpiry,
      newExpiry: newExpiry,
      daysAdded: daysToAdd,
      cost: total,
      deductedFromBalance: total,
    },
    triggeredBy: req.customerId,
    success: true,
  });

  res.json({
    success: true,
    message: `Expiry date moved to ${newExpiry.toISOString()}. KES ${total} deducted from wallet.`,
    data: {
      newExpiry: newExpiry.toISOString(),
      newBalance: target.billing.balance,
    },
  });
});