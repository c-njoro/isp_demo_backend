const asyncHandler = require("../middleware/asyncHandler");
const { ErrorResponse } = require("../middleware/errorHandler");
const Customer = require("../models/Customer");
const Package = require("../models/Package");
const Site = require("../models/Site");
const Ticket = require("../models/Ticket");
const Router = require("../models/Router");
const Voucher = require("../models/Voucher");
const Transaction = require("../models/Transaction");
const RadiusSyncJob = require("../models/RadiusSyncJobSchema");

const SystemLog = require("../models/SystemLog");
const SmsLog = require("../models/SmsLog");
const {
  generateAccountId,
  generatePPPoEPassword,
  generateWiFiPassword,
} = require("../utils/accountHelpers");
const { formatPhoneNumber } = require("../utils/phoneHelpers");
const { calculatePeriodEnd } = require("../utils/invoiceHelpers");
const { getMacVendor } = require("../utils/macVendor");

// ============================================
// HELPER FUNCTIONS FOR ROUTER-BASED ARCHITECTURE
// ============================================

/**
 * Get router for a customer based on their pppoe.siteIp
 * @param {Object} customer - Customer document
 * @param {boolean} throwError - Whether to throw error if not found
 * @returns {Promise<Object|null>} Router document or null
 */
async function getRouterForCustomer(customer, throwError = true) {
  if (!customer.pppoe?.siteIp) {
    if (throwError) {
      throw new Error(
        `Customer ${customer.accountId} has no router assigned (siteIp missing)`,
      );
    }
    return null;
  }

  const router = await Router.findOne({ ip: customer.pppoe.siteIp });
  if (!router) {
    if (throwError) {
      throw new Error(`Router not found for IP: ${customer.pppoe.siteIp}`);
    }
    return null;
  }
  return router;
}

/**
 * Get primary router for a site (for initial customer setup)
 * @param {string} siteId - Site ID
 * @returns {Promise<Object>} Router document
 */
async function getPrimaryRouterForSite(siteId) {
  const router = await Router.findOne({ site: siteId, isPrimary: true })
    .sort({ createdAt: 1 })
    .limit(1);

  if (!router) {
    throw new Error(`No primary router found for site: ${siteId}`);
  }
  return router;
}

/**
 * Build router connection object for mikrotikService
 * @param {Object} router - Router document
 * @returns {Object} Router object with credentials
 */
function buildRouterConnectionObject(router) {
  return {
    ip: router.ip,
    username: router.username,
    password: router.password,
    port: router.apiPort || 8728,
    apiType: router.apiType || "api",
  };
}

/**
 * Build site-like object for services that still expect site structure
 * (For backward compatibility during migration)
 * @param {Object} router - Router document
 * @returns {Object} Site-like object
 */
function buildSiteLikeObjectFromRouter(router) {
  return {
    router: buildRouterConnectionObject(router),
    siteName: router.name || "Unknown",
    ip: router.ip,
  };
}

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
 * Helper: Propagate expiry/status changes from parent to all children that share expiry.
 * @param {Object} parent - Parent customer document
 * @param {Object} options - { newExpiry?: Date, newStatus?: string, radiusAction?: 'enable'|'disable' }
 */
async function propagateToChildren(parent, { newExpiry, newStatus, radiusAction }) {
  if (!parent.sharedExpiry || parent.sharedExpiry.length === 0) return;

  const radiusService = require("../services/radiusService");
  const children = await Customer.find({ _id: { $in: parent.sharedExpiry } });

  for (const child of children) {
    const changes = {};

    if (newExpiry !== undefined) {
      changes['subscription.expiresAt'] = newExpiry;
    }
    if (newStatus !== undefined) {
      changes['subscription.status'] = newStatus;
    }

    if (Object.keys(changes).length > 0) {
      await Customer.updateOne({ _id: child._id }, { $set: changes });
    }

    if (radiusAction === 'enable') {
      const packageDoc = await Package.findById(child.subscription.packageId);
      if (packageDoc) {
        const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
        await radiusService.enableAccount(child.pppoe.username, groupName);
      }
    } else if (radiusAction === 'disable') {
      await radiusService.disableAccount(child.pppoe.username);
    }

    // Log for each child (optional)
    await SystemLog.create({
      eventType: "expiry_propagation",
      severity: "info",
      regionCode: child.regionCode,
      entityType: "customer",
      entityId: child._id,
      accountId: child.accountId,
      message: `Expiry/status synced from parent ${parent.accountId}`,
      details: { parentId: parent._id, newExpiry, newStatus, radiusAction },
      triggeredBy: 'system',
      success: true,
    });
  }
}

// @desc    Get all customers
// @route   GET /api/customers
// @access  Private
// controllers/customerController.js

// controllers/customerController.js (OPTION 2 - Server-side connectivity filtering)

// controllers/customerController.js (FIXED OPTION 2)

// ============================================
// OPTIMIZED VERSION 2: getCustomers with Connectivity Filter
// Replace the existing getCustomers in customerController.js
// ============================================

exports.getCustomers = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 13,
    search,
    status,
    packageId,
    siteId,
    city,
    subLocation,
    localArea,
    nasIp,
    connectivity,
    sortBy = "accountId",
    sortOrder = "asc",
  } = req.query;

  // Base query with region filter
  const query = { ...req.regionFilter };

  // Status filter
  if (status === 'disabled') {
    query.isActive = false;
  } else if (status) {
    query.isActive = true;
    query['subscription.status'] = status;
  } else {
    query.isActive = true;
  }

  // Exclude child accounts unless connectivity filter is present
  if (!connectivity) {
    query.accountId = { $not: /-/ };
  }

  // Search and other filters (unchanged)
  if (search) {
    const cleanSearch = search.trim();
    const terms = cleanSearch.split(/\s+/);
    if (terms.length >= 2) {
      query.$or = [
        { $and: terms.map((term, i) => ({ [i === 0 ? 'firstName' : 'lastName']: { $regex: term, $options: "i" } })) },
        { $and: [{ lastName: { $regex: terms[0], $options: "i" } }, { firstName: { $regex: terms[1], $options: "i" } }] },
        { accountId: { $regex: cleanSearch, $options: "i" } },
        { phoneNumber: { $regex: cleanSearch, $options: "i" } },
        { alternatePhoneNumber: { $regex: cleanSearch, $options: "i" } },
        { 'pppoe.username': { $regex: cleanSearch, $options: "i" } },
        { city: { $regex: cleanSearch, $options: "i" } },
        { sublocation: { $regex: cleanSearch, $options: "i" } },
        { localArea: { $regex: cleanSearch, $options: "i" } },
      ];
    } else {
      query.$or = [
        { accountId: { $regex: cleanSearch, $options: "i" } },
        { firstName: { $regex: cleanSearch, $options: "i" } },
        { lastName: { $regex: cleanSearch, $options: "i" } },
        { phoneNumber: { $regex: cleanSearch, $options: "i" } },
        { alternatePhoneNumber: { $regex: cleanSearch, $options: "i" } },

        { city: { $regex: cleanSearch, $options: "i" } },
        { sublocation: { $regex: cleanSearch, $options: "i" } },
        { localArea: { $regex: cleanSearch, $options: "i" } },
        { 'pppoe.username': { $regex: cleanSearch, $options: "i" } },
      ];
    }
  }
  if (packageId) query["subscription.packageId"] = packageId;
  if (siteId) query.siteId = siteId;
  if (city) query.city = { $regex: city, $options: "i" };
  if (subLocation) query.subLocation = { $regex: subLocation, $options: "i" };
  if (localArea) query.localArea = { $regex: localArea, $options: "i" };
  if (nasIp) query.nasIp = nasIp;

  const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
  const radiusService = require("../services/radiusService");

  let customers;
  let total;

  // ---------- DISABLED CUSTOMERS ----------
  if (status === 'disabled') {
    total = await Customer.countDocuments(query);
    const skip = (parseInt(page) - 1) * parseInt(limit);
    customers = await Customer.find(query)
      .populate("subscription.packageId", "packageName price")
      .populate("siteId", "name regionCode")
      .select("-pppoe.password -cpe.wifiPassword")
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    customers = customers.map(c => ({ ...c, connectivity: 'disabled' }));
    return res.status(200).json({
      success: true,
      data: { customers, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } }
    });
  }

  // ---------- WITH CONNECTIVITY FILTER ----------
  if (connectivity) {
    // Fetch all customers matching the query (no pagination yet)
    const allCustomers = await Customer.find(query)
      .populate("subscription.packageId", "packageName price")
      .populate("siteId", "name regionCode")
      .select("-pppoe.password -cpe.wifiPassword")
      .sort(sort)
      .lean();

    if (allCustomers.length === 0) {
      return res.status(200).json({
        success: true,
        data: { customers: [], pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 } }
      });
    }

    const usernames = allCustomers.map(c => c.pppoe.username);
    const statuses = await radiusService.getBulkUserConnectionStatus(usernames);

    // Build connectivity (no cache fallback; no active session = offline)
    const customersWithConnectivity = allCustomers.map(customer => {
      const radiusStatus = statuses[customer.pppoe.username];
      const isOnline = radiusStatus?.isOnline === true;
      return { ...customer, connectivity: isOnline ? 'online' : 'offline' };
    });

    const filtered = customersWithConnectivity.filter(c => c.connectivity === connectivity);
    total = filtered.length;
    const start = (parseInt(page) - 1) * parseInt(limit);
    const end = start + parseInt(limit);
    customers = filtered.slice(start, end);

    return res.status(200).json({
      success: true,
      data: { customers, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } }
    });
  }

  // ---------- NO CONNECTIVITY FILTER – PAGINATED WITH LIVE STATUS ----------
  total = await Customer.countDocuments(query);
  const skip = (parseInt(page) - 1) * parseInt(limit);

  customers = await Customer.find(query)
    .populate("subscription.packageId", "packageName price")
    .populate("siteId", "name regionCode")
    .select("-pppoe.password -cpe.wifiPassword")
    .sort(sort)
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  // Get live RADIUS status for the paginated customers
  const usernames = customers.map(c => c.pppoe?.username).filter(Boolean);
  if (usernames.length > 0) {
    const liveStatuses = await radiusService.getBulkUserConnectionStatus(usernames);
    customers = customers.map(customer => {
      const live = liveStatuses[customer.pppoe.username];
      const liveConnectivity = live?.isOnline === true ? 'online' : 'offline';
      return { ...customer, connectivity: liveConnectivity };
    });
  } else {
    // No PPPoE username – cannot be online
    customers = customers.map(c => ({ ...c, connectivity: 'offline' }));
  }

  res.status(200).json({
    success: true,
    data: { customers, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } }
  });
});


/**
 * @desc    Search customers by account ID only (includes child accounts)
 * @route   GET /api/customers/search-by-accountid
 * @access  Private
 * @query   { string } q - search query (minimum 2 characters)
 * @query   { number } limit - default 10
 */
exports.searchCustomersByAccountId = asyncHandler(async (req, res, next) => {
  const { q, limit = 10 } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(200).json({
      success: true,
      data: [],
      message: "Search query must be at least 2 characters",
    });
  }

  // Build region filter (respect admin's region access)
  const query = { ...req.regionFilter };

  // Search by accountId only – case‑insensitive partial match
  query.accountId = { $regex: q, $options: "i" };

  const customers = await Customer.find(query)
    .populate("subscription.packageId", "packageName price")
    .populate("siteId", "name")
    .select("accountId firstName lastName phoneNumber")
    .limit(parseInt(limit))
    .sort({ accountId: 1 });

  res.status(200).json({
    success: true,
    data: customers,
  });
});

// @desc    Get single customer
// @route   GET /api/customers/:id
// @access  Private
// customerController.js – updated getCustomer
exports.getCustomer = asyncHandler(async (req, res, next) => {
  const customerDoc = await Customer.findById(req.params.id)
    .populate("subscription.packageId")
    .populate("siteId")
    .populate("createdBy", "firstName lastName");

  if (!customerDoc) return next(new ErrorResponse("Customer not found", 404));
  if (req.regionFilter.regionCode && customerDoc.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse("Access denied", 403));
  }

  // Convert to plain object
  const customer = customerDoc.toObject();

  // Collect unique addedBy IDs (ensure strings)
  const ids = [];
  for (const note of customer.notes) {
    if (note.addedBy) {
      ids.push(note.addedBy.toString());
    }
  }
  const uniqueIds = [...new Set(ids)];

  const User = require('../models/User');
  const Admin = require('../models/Admin');
  const [users, admins] = await Promise.all([
    User.find({ _id: { $in: uniqueIds } }).select('firstName lastName'),
    Admin.find({ _id: { $in: uniqueIds } }).select('firstName lastName')
  ]);

  const nameMap = new Map();
  for (const u of users) nameMap.set(u._id.toString(), `${u.firstName} ${u.lastName}`);
  for (const a of admins) nameMap.set(a._id.toString(), `${a.firstName} ${a.lastName}`);

  // Enrich notes with addedByName
  customer.notes = customer.notes.map(note => {
    const id = note.addedBy ? note.addedBy.toString() : null;
    const addedByName = (id && nameMap.has(id)) ? nameMap.get(id) : 'System Auto';
    return { ...note, addedByName };
  });

  res.status(200).json({
    success: true,
    message: "Customer retrieved successfully",
    data: customer,
  });
});

// @desc    Create customer
// @route   POST /api/customers
// @access  Private
exports.createCustomer = asyncHandler(async (req, res, next) => {
  const {
    firstName,
    lastName,
    email,
    phoneNumber,
    alternatePhoneNumber,
    siteId,
    packageId,
    city,
    subLocation,
    localArea,
    clientMacAddress,
    wifiName,
    wifiPassword,
    model,
    serialNumber,
    notes,
    fupEnabled,
    installationFee,
    category
  } = req.body;

  // Validate required fields
  if (
    !firstName ||
    !lastName ||
    !phoneNumber ||
    !siteId ||
    !packageId ||
    !city ||
    !subLocation ||
    !localArea ||
    !clientMacAddress ||
    !wifiName ||
    !wifiPassword ||
    !model ||
    !serialNumber
  ) {
    return next(new ErrorResponse("All required fields must be filled", 400));
  }

  const site = await Site.findById(siteId);
  if (!site) return next(new ErrorResponse("Site not found", 404));
  if (
    req.regionFilter.regionCode &&
    site.regionCode !== req.regionFilter.regionCode
  )
    return next(new ErrorResponse("Access denied to this site", 403));

  // Verify package exists and belongs to site
  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) return next(new ErrorResponse("Package not found", 404));
  if (packageDoc.siteId.toString() !== siteId)
    return next(new ErrorResponse("Package does not belong to this site", 400));
  if (packageDoc.packageType !== "ppp")
    return next(new ErrorResponse("Only PPPoE packages allowed", 400));

  const formattedPhone = formatPhoneNumber(phoneNumber);
  // In createCustomer
const existing = await Customer.findOne({
  phoneNumber: formattedPhone,
  regionCode: site.regionCode,
  isChild: false
});
if (existing) return next(new ErrorResponse("Phone number already registered", 400));

// Alternate phone check also needs isChild: false
const existingAlt = await Customer.findOne({
  alternatePhoneNumber: formattedPhone,
  regionCode: site.regionCode,
  isChild: false
});
if (existingAlt) return next(new ErrorResponse("Phone number already registered as an alternate.", 400));

  const accountId = await generateAccountId(site.regionCode);
  const pppoePassword = generatePPPoEPassword();

  const now = new Date();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const customer = await Customer.create({
    accountId,
    regionCode: site.regionCode,
    siteId,
    firstName,
    lastName,
    email,
    phoneNumber: formattedPhone,
    alternatePhoneNumber: alternatePhoneNumber ? formatPhoneNumber(alternatePhoneNumber) : undefined,
    city,
    subLocation,
    localArea,
    pppoe: {
      username: accountId,
      password: pppoePassword,
      macAddress: null,
    },
    cpe: {
      serialNumber,
      macAddress: clientMacAddress,
      model,
      wifiName,
      wifiPassword,
    },
    subscription: {
      packageId,
      status: "active",
      activatedAt: now,
      expiresAt,
      autoRenew: true,
    },
    billing:{
      balance: installationFee ? `-${installationFee}` : 0
    },
    fupEnabled: fupEnabled === true && packageDoc.fup?.enabled ? true : false,
    createdBy: req.session.userId,
    category: category || 'residential',
  });

  if (notes) {
    customer.notes.push({ note: notes, addedBy: req.session.userId, addedAt: now });
    await customer.save();
  }

  // Update site coverage (these are non-critical, failures are logged but don't block)
  try {
    await site.addCityIfNotExists(city);
  } catch (err) {
    console.warn('Failed to add city to site coverage:', err.message);
  }
  try {
    await site.addSubLocationIfNotExists(city, subLocation);
  } catch (err) {
    console.warn('Failed to add sub-location to site coverage:', err.message);
  }
  try {
    await site.addLocalAreaIfNotExists(city, subLocation, localArea);
  } catch (err) {
    console.warn('Failed to add local area to site coverage:', err.message);
  }

  // RADIUS account creation (critical)
  const radiusService = require("../services/radiusService");
  const radiusResult = await radiusService.createAccount(customer, packageDoc);
  let serversResults = radiusResult.success
    ? "RADIUS account created\n"
    : `RADIUS error: ${radiusResult.error}\n`;

  // Set billing cycle start
  await radiusService.setBillingCycleStart(customer.pppoe.username, new Date());

  const smsTemplateService = require('../services/smsTemplateService');

  // After customer is created and saved (before final response)
  try {
    await smsTemplateService.sendUsingTemplate(
      'welcome',
      customer.phoneNumber,
      { customerName: `${customer.firstName} ${customer.lastName}`, accountId: customer.accountId },
      { customerId: customer._id, accountId: customer.accountId, type: 'welcome', regionCode: customer.regionCode }
    );
  } catch (err) {
    console.error('Welcome SMS failed:', err.message);
  }

  await SystemLog.create({
    eventType: "admin_action",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Customer account created: ${customer.accountId}`,
    triggeredBy: req.session.userId,
    success: true,
  });

  await customer.populate("subscription.packageId siteId");
  res.status(201).json({
    success: true,
    message: `Customer created successfully\n${serversResults}`,
    data: customer,
  });
});

/**
 * Toggle FUP (Fair Usage Policy) for a customer
 * @route   PUT /api/customers/:id/toggle-fup
 * @access  Private
 */
exports.toggleCustomerFUP = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id).populate(
    "subscription.packageId",
  );
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  const radiusService = require("../services/radiusService");
  const pkg = customer.subscription.packageId;

  if (!customer.fupEnabled) {
    // Enable FUP
    if (!pkg.fup?.enabled) {
      return next(new ErrorResponse("This package does not support FUP", 400));
    }
    const quotaBytes = pkg.fup.dataThresholdGB * 1024 * 1024 * 1024;
    const radResult = await radiusService.enableFUPForCustomer(
      customer.pppoe.username,
      quotaBytes,
    );
    if (!radResult.success) {
      console.error("Failed to enable FUP in RADIUS:", radResult.error);
      return next(new ErrorResponse("Failed to enable FUP in RADIUS", 500));
    }
    customer.fupEnabled = true;
    await customer.save();
    return res.json({ success: true, message: "FUP enabled for customer" });
  } else {
    // Disable FUP
    const normalGroup = pkg.packageName.replace(/\s+/g, "_").toUpperCase();
    const radResult = await radiusService.disableFUPForCustomer(
      customer.pppoe.username,
      normalGroup,
    );
    if (!radResult.success) {
      console.error("Failed to disable FUP in RADIUS:", radResult.error);
      return next(new ErrorResponse("Failed to disable FUP in RADIUS", 500));
    }
    customer.fupEnabled = false;
    await customer.save();
    return res.json({ success: true, message: "FUP disabled for customer" });
  }
});

/**
 * @desc    Update customer (Basic info, location, CPE, subscription)
 * @route   PUT /api/customers/:id
 * @access  Private (admin)
 *
 *
 * ALLOWED UPDATES:
 * - Basic info (name, email, phone, ID)
 * - Location details
 * - CPE details (serial, MAC, model, WiFi credentials)
 * - Subscription details (package, status, expiry) - SAME SITE ONLY
 * - Notes
 *
 * NOT ALLOWED:
 * - Site changes (use migrateCustomer instead)
 * - PPPoE changes (generated by system)
 */

exports.updateCustomer = asyncHandler(async (req, res, next) => {
  let customer = await Customer.findById(req.params.id)
    .populate("siteId")
    .populate("subscription.packageId");

    const site = customer.siteId;

  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  // Check region access
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  const {
    // Basic info
    firstName,
    lastName,
    email,
    phoneNumber,
    alternatePhoneNumber,
    idNumber,

    // Location
    location,

    // CPE details
    cpe,

    // Subscription (same site only)
    subscription,

    // Notes
    notes,

    category,
  } = req.body;

  // BLOCK site and PPPoE changes
  if (req.body.siteId) {
    return next(
      new ErrorResponse(
        "Cannot change customer site via this endpoint. Use /api/customers/:id/migrate instead",
        400,
      ),
    );
  }

  console.log(`📝 Updating customer: ${customer.accountId}`);

  const changes = {};

  // ============================================
  // BASIC INFORMATION
  // ============================================

  if (firstName && firstName !== customer.firstName) {
    changes.firstName = { old: customer.firstName, new: firstName };
    customer.firstName = firstName;
  }

  if (lastName && lastName !== customer.lastName) {
    changes.lastName = { old: customer.lastName, new: lastName };
    customer.lastName = lastName;
  }

  if (email !== undefined && email !== customer.email) {
    changes.email = { old: customer.email, new: email };
    customer.email = email;
  }

  if (idNumber && idNumber !== customer.idNumber) {
    changes.idNumber = { old: customer.idNumber, new: idNumber };
    customer.idNumber = idNumber;
  }

  if(category && (!customer.category || customer.category !== category)){
    changes.category = {old: customer.category || "Blank", new: category}
    customer.category = category;
  }

  // ============================================
  // PHONE NUMBERS
  // ============================================

// PHONE NUMBERS
// ============================================
// PHONE NUMBERS
// ============================================

if (phoneNumber) {
  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (formattedPhone !== customer.phoneNumber) {
    // Check uniqueness for primary accounts (excluding self)
    const existing = await Customer.findOne({
      phoneNumber: formattedPhone,
      regionCode: customer.regionCode,
      isChild: false,
      _id: { $ne: customer._id }
    });
    if (existing) {
      return next(new ErrorResponse("Phone number already registered in this region", 400));
    }
    changes.phoneNumber = { old: customer.phoneNumber, new: formattedPhone };
    customer.phoneNumber = formattedPhone;
  }
}

if (alternatePhoneNumber !== undefined) {
  const formattedAltPhone = alternatePhoneNumber ? formatPhoneNumber(alternatePhoneNumber) : null;
  if (formattedAltPhone !== customer.alternatePhoneNumber) {
    if (formattedAltPhone) {
      // Check if this number is already used as a primary phone by another account
      const existingAsPrimary = await Customer.findOne({
        phoneNumber: formattedAltPhone,
        regionCode: customer.regionCode,
        isChild: false,
        _id: { $ne: customer._id }
      });
      if (existingAsPrimary) {
        return next(new ErrorResponse("Alternate phone number already used as primary in this region", 400));
      }
      // Check if this number is already used as an alternate by another account
      const existingAsAlternate = await Customer.findOne({
        alternatePhoneNumber: formattedAltPhone,
        regionCode: customer.regionCode,
        isChild: false,
        _id: { $ne: customer._id }
      });
      if (existingAsAlternate) {
        return next(new ErrorResponse("Alternate phone number already in use by another account in this region", 400));
      }
    }
    changes.alternatePhoneNumber = {
      old: customer.alternatePhoneNumber,
      new: formattedAltPhone,
    };
    customer.alternatePhoneNumber = formattedAltPhone;
  }
}

  // ============================================
  // LOCATION
  // ============================================


  // ============================================
// LOCATION FIELDS (top-level required)
// ============================================

const { city, subLocation, localArea } = req.body;

if (city !== undefined && city !== customer.city) {
  changes.city = { old: customer.city, new: city };
  customer.city = city;
}
if (subLocation !== undefined && subLocation !== customer.subLocation) {
  changes.subLocation = { old: customer.subLocation, new: subLocation };
  customer.subLocation = subLocation;
}
if (localArea !== undefined && localArea !== customer.localArea) {
  changes.localArea = { old: customer.localArea, new: localArea };
  customer.localArea = localArea;
}

// ============================================
// LEGACY LOCATION OBJECT (optional fields)
// ============================================

if (location) {
  const oldLocation = JSON.stringify(customer.location);
  customer.location = { ...customer.location, ...location };
  const newLocation = JSON.stringify(customer.location);
  if (oldLocation !== newLocation) {
    changes.location = { updated: true };
  }
}


  // ============================================
  // CPE DETAILS
  // ============================================

  if (cpe) {
    console.log("📡 Updating CPE details");

    if (!customer.cpe) {
      customer.cpe = {};
    }

    if (
      cpe.serialNumber !== undefined &&
      cpe.serialNumber !== customer.cpe.serialNumber
    ) {
      changes.cpeSerialNumber = {
        old: customer.cpe.serialNumber,
        new: cpe.serialNumber,
      };
      customer.cpe.serialNumber = cpe.serialNumber;
    }

    if (
      cpe.macAddress !== undefined &&
      cpe.macAddress !== customer.cpe.macAddress
    ) {
      changes.cpeMacAddress = {
        old: customer.cpe.macAddress,
        new: cpe.macAddress,
      };
      customer.cpe.macAddress = cpe.macAddress;
    }

    if (cpe.model !== undefined && cpe.model !== customer.cpe.model) {
      changes.cpeModel = { old: customer.cpe.model, new: cpe.model };
      customer.cpe.model = cpe.model;
    }

    if (cpe.wifiName !== undefined && cpe.wifiName !== customer.cpe.wifiName) {
      changes.cpeWifiName = { old: customer.cpe.wifiName, new: cpe.wifiName };
      customer.cpe.wifiName = cpe.wifiName;
    }

    if (
      cpe.wifiPassword !== undefined &&
      cpe.wifiPassword !== customer.cpe.wifiPassword
    ) {
      changes.cpeWifiPassword = { old: "***", new: "***" };
      customer.cpe.wifiPassword = cpe.wifiPassword;
    }
  }

  // ============================================
  // SUBSCRIPTION (SAME SITE ONLY)
  // ============================================

  if (subscription) {
    console.log("📦 Updating subscription");

    if (!customer.subscription) {
      customer.subscription = {};
    }

    // Update package (must be from same site)
    if (
      subscription.packageId &&
      subscription.packageId !== customer.subscription.packageId?.toString()
    ) {
      const Package = require("../models/Package");
      const newPackage = await Package.findById(subscription.packageId);

      if (!newPackage) {
        return next(new ErrorResponse("Package not found", 404));
      }

      // IMPORTANT: Package must be from same site
      if (newPackage.siteId?.toString() !== customer.siteId?._id.toString()) {
        return next(
          new ErrorResponse(
            "Package must be from the same site. To change sites, use /api/customers/:id/migrate",
            400,
          ),
        );
      }

      changes.package = {
        old: customer.subscription.packageId?.toString(),
        new: subscription.packageId,
        oldPackageName: customer.subscription.packageId?.packageName,
        newPackageName: newPackage.packageName,
      };
      customer.subscription.packageId = subscription.packageId;

      console.log(
        `📦 Package changed: ${customer.subscription.packageId?.packageName} → ${newPackage.packageName}`,
      );
    }

    // Update status
    if (
      subscription.status &&
      subscription.status !== customer.subscription.status
    ) {
      changes.subscriptionStatus = {
        old: customer.subscription.status,
        new: subscription.status,
      };
      customer.subscription.status = subscription.status;
    }

    // Update expiry date
    if (subscription.expiresAt !== undefined) {
      const newExpiresAt = subscription.expiresAt
        ? new Date(subscription.expiresAt)
        : null;
      const oldExpiresAt = customer.subscription.expiresAt;

      if (newExpiresAt?.getTime() !== oldExpiresAt?.getTime()) {
        changes.expiresAt = { old: oldExpiresAt, new: newExpiresAt };
        customer.subscription.expiresAt = newExpiresAt;
      }
    }

    // Update auto-renew
    if (
      subscription.autoRenew !== undefined &&
      subscription.autoRenew !== customer.subscription.autoRenew
    ) {
      changes.autoRenew = {
        old: customer.subscription.autoRenew,
        new: subscription.autoRenew,
      };
      customer.subscription.autoRenew = subscription.autoRenew;
    }
  }

  // ============================================
  // NOTES
  // ============================================

  if (notes) {
    customer.notes.push({
      note: notes,
      addedBy: req.session.userId,
      addedAt: new Date(),
    });
    changes.notesAdded = true;
  }

  // ============================================
  // SAVE CHANGES
  // ============================================

  const changeCount = Object.keys(changes).length;

  if (changeCount === 0) {
    return res.status(200).json({
      success: true,
      message: "No changes detected",
      data: customer,
    });
  }

  console.log(
    `💾 Saving ${changeCount} changes to customer ${customer.accountId}`,
  );

  await customer.save();


    // Update site coverage (these are non-critical, failures are logged but don't block)
    try {
      await site.addCityIfNotExists(city);
    } catch (err) {
      console.warn('Failed to add city to site coverage:', err.message);
    }
    try {
      await site.addSubLocationIfNotExists(city, subLocation);
    } catch (err) {
      console.warn('Failed to add sub-location to site coverage:', err.message);
    }
    try {
      await site.addLocalAreaIfNotExists(city, subLocation, localArea);
    } catch (err) {
      console.warn('Failed to add local area to site coverage:', err.message);
    }

  // ============================================
  // LOG CHANGES
  // ============================================

  await SystemLog.create({
    eventType: "customer_updated",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Customer ${customer.accountId} updated: ${changeCount} changes`,
    details: {
      customerId: customer._id,
      accountId: customer.accountId,
      changes,
      changedFields: Object.keys(changes),
    },
    triggeredBy: req.session.userId,
    success: true,
  });

  console.log(`✅ Customer ${customer.accountId} updated successfully`);

  // Reload populated fields
  await customer.populate("subscription.packageId siteId");

  res.status(200).json({
    success: true,
    message: `Customer updated successfully (${changeCount} changes)`,
    data: {
      customer,
      changes: Object.keys(changes),
      changeCount,
    },
  });
});

// @desc    Suspend customer
// @route   PUT /api/customers/:id/suspend
// @access  Private
exports.suspendCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);

  

  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }


  if (customer.isChild && customer.shared?.expiryWithParent) {
    return next(new ErrorResponse("Cannot pause a child account that shares expiry with parent.", 400));
  }


  // Check region access
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  if (customer.subscription.status === "suspended") {
    return next(new ErrorResponse("Customer is already suspended", 400));
  }

  const { reason } = req.body;

  customer.subscription.status = "suspended";
  customer.subscription.pausedAt = Date.now();

  customer.suspensionSource = {
    reason: "admin",
    siteId: customer.siteId,
    timestamp: new Date(),
  };


    customer.notes.push({
      note: `Account subscription paused.`,
      addedBy: req.session.userId,
      createdAt: new Date(),
    });
  



  if(customer.isChild && customer.shared.expiryWithParent){
    customer.shared.expiryWithParent = false;

    await Customer.findByIdAndUpdate(customer.parentAccount, {
      $pull: { sharedExpiry: customer._id }
  });
  }

  await customer.save();

  // Propagate suspension to children that share expiry
if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
  // For children, we also set subscription.status = 'suspended' and pausedAt = now
  const now = new Date();
  await Customer.updateMany(
    { _id: { $in: customer.sharedExpiry } },
    {
      $set: {
        'subscription.status': 'suspended',
        'subscription.pausedAt': now,
      }
    }
  );
  // Disable RADIUS for each child
  const radiusService = require("../services/radiusService");
  const children = await Customer.find({ _id: { $in: customer.sharedExpiry } });
  for (const child of children) {
    await radiusService.disableAccount(child.pppoe.username);
  }
}

  let serversResults = "";

  // Disable in RADIUS
  const radiusService = require("../services/radiusService");
  const radiusResult = await radiusService.disableAccount(
    customer.pppoe.username,
  );
  if (!radiusResult.success) {
    console.error("RADIUS disable failed:", radiusResult.error);
    serversResults += `RADIUS disable failed: \n`;
  } else {
    console.log("RADIUS disable successful");
    serversResults += `RADIUS disable successful\n`;
  }

  serversResults += `\n`;

  // Log suspension
  await SystemLog.create({
    eventType: "admin_action",
    severity: "warning",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Customer suspended: ${customer.accountId}`,
    details: { reason },
    triggeredBy: req.session.userId,
    success: true,
  });

  res.status(200).json({
    success: true,
    message: `Customer suspended successfully\n${serversResults}`,
    data: customer,
  });
});

// @desc    Reactivate customer
// @route   PUT /api/customers/:id/reactivate
// @access  Private
exports.reactivateCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  if (customer.isChild && customer.shared?.expiryWithParent) {
    return next(new ErrorResponse("Cannot reactivate a child account that shares expiry with parent.", 400));
  }

  // Check region access
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  if (customer.subscription.status !== "suspended") {
    return next(new ErrorResponse("Customer is not suspended", 400));
  }

  const now = new Date();
  const pausedAt = customer.subscription.pausedAt;

  if (pausedAt) {
    // Calculate suspension duration (milliseconds)
    const suspensionDuration = now - pausedAt;
    // Add it to the current expiry date
    customer.subscription.expiresAt = new Date(
      customer.subscription.expiresAt.getTime() + suspensionDuration,
    );
    // Clear pausedAt to prevent double‑counting in future reactivations
    customer.subscription.pausedAt = null;
  } else {
    // Fallback for old records where pausedAt might be missing
    console.warn(
      `Customer ${customer.accountId} reactivated but pausedAt is missing – no expiry extension applied.`,
    );
  }

  // Set status to active (since we've extended the expiry)
  customer.subscription.status = "active";

  // Add audit note
  customer.notes.push({
    note: "Account reactivated – expiry extended by suspension period",
    addedBy: req.session.userId,
    createdAt: now,
  });

  // Get site and package information
  const site = await Site.findById(customer.siteId);
  const packageDoc = await Package.findById(customer.subscription.packageId);

  let serversResults = "";

  // Enable in RADIUS (restore original group)
  const radiusService = require("../services/radiusService");
  const groupName = packageDoc.packageName.replace(/\s+/g, "_").toUpperCase();
  const radiusResult = await radiusService.enableAccount(
    customer.pppoe.username,
    groupName,
  );
  if (!radiusResult.success) {
    console.error("RADIUS enable failed:", radiusResult.error);
    serversResults += `RADIUS enable failed: \n`;
  } else {
    console.log("RADIUS enable successful");
    serversResults += `RADIUS enable successful\n`;
  }

  // Restart their PPPoE session (force reconnect)
  try {
    const router = await getRouterForCustomer(customer, false);
    if (router) {
      const mikrotikService = require("../services/mikrotikService");
      const siteObj = buildSiteLikeObjectFromRouter(router);
      const mikrotikResult = await mikrotikService.endSession(
        siteObj,
        customer.pppoe.username,
      );
      if (!mikrotikResult.success) {
        console.log(
          "Failed to restart the session, customer still using previous session.",
        );
        serversResults += `SESSION restart failed: \n`;
      } else {
        console.log("Session restarted successfully.");
        serversResults += `SESSION restart successful: \n`;
      }
    } else {
      console.warn("⚠️ No router found, skipping session restart");
    }
  } catch (routerError) {
    console.error("⚠️ Error restarting session:", routerError.message);
  }

  serversResults += `\n`;

  await customer.save();

  // Propagate reactivation to children
if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
  const now = new Date();
  const suspensionDuration = now - customer.subscription.pausedAt; // pausedAt is cleared on parent already
  // For each child, add same duration to expiry
  const children = await Customer.find({ _id: { $in: customer.sharedExpiry } });
  for (const child of children) {
    const newExpiry = new Date(child.subscription.expiresAt.getTime() + suspensionDuration);
    child.subscription.expiresAt = newExpiry;
    child.subscription.status = 'active';
    child.subscription.pausedAt = null;
    await child.save();

    // Enable RADIUS
    const packageDoc = await Package.findById(child.subscription.packageId);
    if (packageDoc) {
      const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
      await radiusService.enableAccount(child.pppoe.username, groupName);
    }
  }
}

  // Log reactivation
  await SystemLog.create({
    eventType: "admin_action",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Customer reactivated: ${customer.accountId}`,
    triggeredBy: req.session.userId,
    success: true,
  });

  res.status(200).json({
    success: true,
    message: `Customer reactivated successfully\n${serversResults}`,
    data: customer,
  });
});

// @desc    Change customer package (with optional override)
// @route   PUT /api/customers/:id/change-package
// @access  Private
exports.changePackage = asyncHandler(async (req, res, next) => {
  const { packageId, override = false } = req.body;

  if (!packageId) {
    return next(new ErrorResponse("Package ID is required", 400));
  }

  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  if (customer.subscription.packageId.toString() === packageId.toString()) {
    return next(new ErrorResponse("Customer is already on this package", 400));
  }

  // Region access check (unchanged)
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  // Verify new package
  const newPackage = await Package.findById(packageId);
  if (!newPackage) {
    return next(new ErrorResponse("Package not found", 404));
  }

  if (newPackage.siteId.toString() !== customer.siteId.toString()) {
    return next(
      new ErrorResponse("Package does not belong to customer site", 400)
    );
  }

  if (newPackage.packageType !== "ppp") {
    return next(new ErrorResponse("Invalid package type", 400));
  }

  const oldPackageId = customer.subscription.packageId;
  const previousPackage = await Package.findById(oldPackageId);
  if (!previousPackage) {
    return next(new ErrorResponse("Previous Package not found", 404));
  }

    // Propagation helper for children that share package
    const propagateToChildrenPackage = async (newPackageDoc, parentExpiry, parentStatus) => {
      if (!customer.sharedPackage || customer.sharedPackage.length === 0) return;
  
      const radiusService = require("../services/radiusService");
      const children = await Customer.find({ _id: { $in: customer.sharedPackage } }).populate('subscription.packageId');
  
      for (const child of children) {
        child.subscription.packageId = newPackageDoc._id;
  
        if (child.shared?.expiryWithParent) {
          child.subscription.expiresAt = parentExpiry;
          child.subscription.status = parentStatus;
          if (parentStatus === 'active' && !child.subscription.activatedAt) {
            child.subscription.activatedAt = new Date();
          }
        }
  
        await child.save();
  
        const groupName = newPackageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
        await radiusService.updateBandwidth(child.pppoe.username, newPackageDoc.speed.upload, newPackageDoc.speed.download, groupName);
        if (child.subscription.status === 'active') {
          await radiusService.enableAccount(child.pppoe.username, groupName);
        } else {
          await radiusService.disableAccount(child.pppoe.username);
        }
  
        await SystemLog.create({
          eventType: "package_propagation",
          severity: "info",
          regionCode: child.regionCode,
          entityType: "customer",
          entityId: child._id,
          accountId: child.accountId,
          message: `Package updated to ${newPackageDoc.packageName} due to parent ${customer.accountId} change${child.shared?.expiryWithParent ? ' (expiry also synced)' : ''}`,
          details: {
            parentId: customer._id,
            oldPackage: previousPackage.packageName,
            newPackage: newPackageDoc.packageName,
            syncExpiry: !!child.shared?.expiryWithParent,
            newExpiry: child.subscription.expiresAt,
            newStatus: child.subscription.status,
          },
          triggeredBy: req.user._id,
          success: true,
        });
      }
    };

  if (customer.subscription.status === "expired") {
    const now = new Date();
    const balance = customer.billing?.balance || 0;
  
    // Always update the package ID (the customer wants to change plan)
    customer.subscription.packageId = newPackage._id;
  
    if (balance >= newPackage.price) {
      // Has enough balance – proceed with activation (either immediate or wait for session)
      const radiusService = require("../services/radiusService");
      let hasActiveSession = false;
      try {
        hasActiveSession = await radiusService.hasActiveSession(customer.pppoe.username);
      } catch (err) {
        console.error(`Session check failed for ${customer.accountId}:`, err.message);
      }
  
      if (!hasActiveSession) {
        // No active session – mark waiting, don't deduct yet
        customer.waitingForSession = true;
        customer.notes.push({
          note: `Package changed from ${previousPackage.packageName} to ${newPackage.packageName} (awaiting session)`,
          addedBy: req.user._id,
          createdAt: now,
        });
        await customer.save();
        await radiusService.addPendingActivation(customer.pppoe.username); 

        await propagateToChildrenPackage(newPackage, customer.subscription.expiresAt, 'expired');
  
        await SystemLog.create({
          eventType: "admin_action",
          severity: "info",
          regionCode: customer.regionCode,
          entityType: "customer",
          entityId: customer._id,
          accountId: customer.accountId,
          message: `Package changed for ${customer.accountId} (waiting for session)`,
          details: { oldPackage: oldPackageId, newPackage: packageId },
          triggeredBy: req.user._id,
          success: true,
        });
  
        return res.status(200).json({
          success: true,
          message: "Package changed. Customer will be activated when they connect.",
          data: customer,
        });
      } else {
        // Active session – deduct and activate immediately
        customer.billing.balance = balance - newPackage.price;
        let newExpiry = calculatePeriodEnd(now, newPackage.period, newPackage.periodUnit);
        if (customer.freeExtensionDays > 0) {
          newExpiry = new Date(newExpiry);
          newExpiry.setDate(newExpiry.getDate() - customer.freeExtensionDays);
          if (newExpiry < now) newExpiry = now;
          customer.freeExtensionDays = 0;
        }
        customer.subscription.status = "active";
        customer.subscription.expiresAt = newExpiry;
        customer.subscription.activatedAt = now;
        customer.waitingForSession = false;
        
        if (!customer.renewals) customer.renewals = [];
        customer.renewals.push({ dateRenewed: now, method: "wallet", amount: newPackage.price });
  
        await customer.save();
  
        // RADIUS updates
        const groupName = newPackage.packageName.replace(/\s+/g, "_").toUpperCase();
        await radiusService.setBillingCycleStart(customer.pppoe.username, new Date());
        await radiusService.updateBandwidth(customer.pppoe.username, newPackage.speed.upload, newPackage.speed.download, groupName);
        await radiusService.enableAccount(customer.pppoe.username, groupName);
        await radiusService.removePendingActivation(customer.pppoe.username); 
  
        if (customer.fupEnabled && newPackage.fup?.enabled) {
          const quotaBytes = newPackage.fup.dataThresholdGB * 1024 * 1024 * 1024;
          await radiusService.enableFUPForCustomer(customer.pppoe.username, quotaBytes);
        } else if (!newPackage.fup?.enabled) {
          await radiusService.disableFUPForCustomer(customer.pppoe.username);
          customer.fupEnabled = false;
        }

        await propagateToChildrenPackage(newPackage, newExpiry, 'active');
  
        await SystemLog.create({
          eventType: "admin_action",
          severity: "info",
          regionCode: customer.regionCode,
          entityType: "customer",
          entityId: customer._id,
          accountId: customer.accountId,
          message: `Package changed and activated for ${customer.accountId}`,
          details: { oldPackage: oldPackageId, newPackage: packageId, amountDeducted: newPackage.price, newExpiry },
          triggeredBy: req.user._id,
          success: true,
        });
  
        await customer.populate("subscription.packageId siteId");
        return res.status(200).json({
          success: true,
          message: "Package changed and customer activated immediately.",
          data: customer,
        });
      }
    } else {
      // Insufficient balance – only change package, do NOT activate or deduct
      customer.notes.push({
        note: `Package changed from ${previousPackage.packageName} to ${newPackage.packageName} (insufficient balance – remains expired)`,
        addedBy: req.user._id,
        createdAt: now,
      });
      await customer.save();

      await propagateToChildrenPackage(newPackage, customer.subscription.expiresAt, 'expired');
  
      await SystemLog.create({
        eventType: "admin_action",
        severity: "info",
        regionCode: customer.regionCode,
        entityType: "customer",
        entityId: customer._id,
        accountId: customer.accountId,
        message: `Package changed for ${customer.accountId} (expired, insufficient balance)`,
        details: { oldPackage: oldPackageId, newPackage: packageId, balance, required: newPackage.price },
        triggeredBy: req.user._id,
        success: true,
      });
  
      await customer.populate("subscription.packageId siteId");
      return res.status(200).json({
        success: true,
        message: "Package changed successfully (customer remains expired due to insufficient balance).",
        data: customer,
      });
    }
  }

  // --- Override mode: skip all financial checks ---
  if (override) {
    // Directly update package without any balance/downgrade restrictions
    customer.subscription.packageId = packageId;
    customer.notes.push({
      note: `Package changed from ${oldPackageId.packageName} to ${packageId.packageName} (OVERRIDE MODE - no financial checks)`,
      addedBy: req.user._id,
      createdAt: new Date(),
    });
    await customer.save();

    // Update RADIUS bandwidth
    const radiusService = require("../services/radiusService");
    const groupName = newPackage.packageName;
    const radiusResult = await radiusService.updateBandwidth(
      customer.pppoe.username,
      newPackage.speed.upload,
      newPackage.speed.download,
      groupName
    );
    if (!radiusResult.success) {
      console.error("RADIUS bandwidth update failed (override):", radiusResult.error);
    }

    // Optionally enable connection (override implies force-enable)
    await radiusService.enableAccount(customer.pppoe.username, groupName);

    // Handle FUP
    if (customer.fupEnabled && newPackage.fup?.enabled) {
      const quotaBytes = newPackage.fup.dataThresholdGB * 1024 * 1024 * 1024;
      await radiusService.enableFUPForCustomer(customer.pppoe.username, quotaBytes);
    } else if (!newPackage.fup?.enabled) {
      await radiusService.disableFUPForCustomer(customer.pppoe.username);
      customer.fupEnabled = false;
    }

    

    




    await customer.save();

    await propagateToChildrenPackage(newPackage, customer.subscription.expiresAt, customer.subscription.status);

    await SystemLog.create({
      eventType: "admin_action",
      severity: "info",
      regionCode: customer.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Package changed with OVERRIDE for ${customer.accountId}`,
      details: { oldPackage: oldPackageId, newPackage: packageId, override: true },
      triggeredBy: req.user._id,
      success: true,
    });

    await customer.populate("subscription.packageId siteId");

    return res.status(200).json({
      success: true,
      message: "Package changed successfully (override applied)",
      data: customer,
    });
  }

  // --- NORMAL MODE (existing logic with all checks) ---
  const oldPrice = previousPackage.price;
  const newPrice = newPackage.price;
  const balance = customer.billing?.balance;
  let willHaveConnection = false;

  if (newPrice > oldPrice) {
    // UPGRADE
    if (customer.subscription.status === "active") {
      if (balance === undefined || typeof balance !== "number") {
        return next(new ErrorResponse("Customer balance information is missing", 500));
      }
      const priceDiff = newPrice - oldPrice;
      if (balance < priceDiff) {
        return next(new ErrorResponse("Insufficient balance to upgrade package.", 400));
      }
      customer.billing.balance = balance - priceDiff;
      willHaveConnection = true;
        // 1. Create Transaction (negative, type EXPENSE)
  const transaction = await Transaction.create({
    type: "PLAN_CHANGE",
    customerType: "pppoe", // or could be hotspot, but we handle generically
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: customer.regionCode,
    siteId: customer.siteId,
    amount: `-${newPrice - oldPrice}`,  // negative
    description: `Package upgrade`,
    paymentMethod: "wallet", 
    status: "completed",
    metadata: {
      
      category: "Package upgrade",
      deductedBy: req.session.userId,
    },
  });

  await transaction.save();



    }
  } else if (newPrice < oldPrice) {
    // DOWNGRADE
    if (customer.subscription.status !== "active") {
      if (balance === undefined || typeof balance !== "number") {
        return next(new ErrorResponse("Customer balance information is missing", 500));
      }
      if (balance >= newPrice) {
        customer.subscription.status = "active";
        customer.billing.balance = balance - newPrice;
        customer.notes.push({
          note: `Customer reactivated due to downgrade to cheaper package (balance now sufficient)`,
          addedBy: req.user._id,
          createdAt: new Date(),
        });
        willHaveConnection = true;
      }



    } else {
      return next(
        new ErrorResponse(
          "You cannot downgrade while your subscription is still active.",
          400
        )
      );
    }
  }
  // If prices equal, no changes to balance or status

  customer.subscription.packageId = packageId;
  customer.notes.push({
    note: `Package changed from ${previousPackage.packageName} to ${newPackage.packageName}`,
    addedBy: req.user._id,
    createdAt: new Date(),
  });

  await customer.save();

  const radiusService = require("../services/radiusService");
  const groupName = newPackage.packageName;
  const radiusResult = await radiusService.updateBandwidth(
    customer.pppoe.username,
    newPackage.speed.upload,
    newPackage.speed.download,
    groupName
  );
  if (!radiusResult.success) {
    console.error("RADIUS bandwidth update failed:", radiusResult.error);
  }

  if (willHaveConnection) {
    await radiusService.enableAccount(customer.pppoe.username, groupName);
  }

  if (customer.fupEnabled) {
    if (newPackage.fup?.enabled) {
      const quotaBytes = newPackage.fup.dataThresholdGB * 1024 * 1024 * 1024;
      await radiusService.enableFUPForCustomer(customer.pppoe.username, quotaBytes);
    } else {
      await radiusService.disableFUPForCustomer(customer.pppoe.username);
      customer.fupEnabled = false;
    }
  }

  await customer.save();

  if (willHaveConnection) {
    await propagateToChildrenPackage(newPackage, customer.subscription.expiresAt, 'active');
  } else {
    await propagateToChildrenPackage(newPackage, customer.subscription.expiresAt, customer.subscription.status);
  }

  await SystemLog.create({
    eventType: "admin_action",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Package changed for ${customer.accountId}`,
    details: { oldPackage: oldPackageId, newPackage: packageId },
    triggeredBy: req.user._id,
    success: true,
  });

  await customer.populate("subscription.packageId siteId");

  res.status(200).json({
    success: true,
    message: "Package changed successfully",
    data: customer,
  });
});

// @desc    Get customer transactions
// @route   GET /api/customers/:id/transactions
// @access  Private
exports.getCustomerTransactions = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;

  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  // Check region access
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  const transactions = await Transaction.find({ customerId: req.params.id })
    .populate("packageId", "packageName")
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Transaction.countDocuments({ customerId: req.params.id });

  res.status(200).json({
    success: true,
    message: "Transactions retrieved successfully",
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

// @desc    Delete customer
// @route   DELETE /api/customers/:id
// @access  Private (Admin only)
exports.deleteCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  const children = await Customer.find({parentAccount: customer._id});

  if(children && children.length > 0){
    return next(new ErrorResponse("Customer has children accounts!", 404));
  
  }

  // Check region access
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  // Soft delete – mark as inactive
  customer.isActive = false;
  customer.subscription.status = "terminated";
  customer.notes.push({
    note: "Account termination initiated",
    addedBy: req.session.userId,
  });

  const radiusService = require("../services/radiusService");

  const radiusResult = await radiusService.deleteAccount(
    customer.pppoe.username,
  );
  if (!radiusResult.success) {
    console.error("RADIUS deletion failed:", radiusResult.error);
  } else {
    console.log("RADIUS deletion successful");
  }

  await customer.deleteOne();

  res.status(200).json({
    success: true,
    message: "Customer deleted successfully",
    data: null,
  });
});


// @desc    Delete customer
// @route   PUT /api/customers/:id/disable-account
// @access  Private (Admin only)
exports.disableCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  if(customer.subscription.status !== 'expired' ){
    return next(new ErrorResponse("Customer is Active", 404));
  }

  // Check region access
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  // Soft delete – mark as inactive
  customer.isActive = false;
  customer.notes.push({
    note: "Account disabled",
    addedBy: req.session.userId,
  });

  await customer.save();

  const radiusService = require("../services/radiusService");

  const radiusResult = await radiusService.disableAccount(
    customer.pppoe.username,
  );
  if (!radiusResult.success) {
    console.error("RADIUS disable failed:", radiusResult.error);
  } else {
    console.log("RADIUS disable successful");
  }


  res.status(200).json({
    success: true,
    message: "Customer disabled successfully",
    data: null,
  });
});

exports.enableCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  // Check region access
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  // Soft delete – mark as inactive
  customer.isActive = true;
  customer.notes.push({
    note: "Account enabled",
    addedBy: req.session.userId,
  });

  await customer.save()

  // const radiusService = require("../services/radiusService");

  // const radiusResult = await radiusService.Account(
  //   customer.pppoe.username,
  // );
  // if (!radiusResult.success) {
  //   console.error("RADIUS disable failed:", radiusResult.error);
  // } else {
  //   console.log("RADIUS disable successful");
  // }


  res.status(200).json({
    success: true,
    message: "Customer enabled successfully",
    data: null,
  });
});

/**
 * @desc    Migrate customer to a different site
 * @route   POST /api/customers/:id/migrate
 * @access  Private (admin only)
 *
 * This handles the complex process of moving a customer to a different site:
 * 1. Validates new site and package
 * 2. Removes old PPPoE from old site's Mikrotik
 * 3. Generates new PPPoE credentials for new site
 * 4. Creates PPPoE on new site's Mikrotik
 * 5. Updates customer record
 * 6. Logs migration
 *
 * IMPORTANT: This is the ONLY way to change a customer's site
 */
exports.migrateCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id)
    .populate("siteId")
    .populate("subscription.packageId");

  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  // Check region access for current site
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  const { newSiteId, newPackageId, reason, activeService = true } = req.body;

  // Validate required fields
  if (!newSiteId || !newPackageId) {
    return next(
      new ErrorResponse("New site ID and new package ID are required", 400),
    );
  }

  // Validate new site
  const newSite = await Site.findById(newSiteId);
  if (!newSite) {
    return next(new ErrorResponse("New site not found", 404));
  }

  // Check if different site
  if (newSiteId === customer.siteId._id.toString()) {
    return next(
      new ErrorResponse(
        "Customer is already at this site. Use change plan endpoint instead",
        400,
      ),
    );
  }

  // Region access for target site
  if (
    req.regionFilter.regionCode &&
    newSite.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to target site", 403));
  }

  // Validate new package
  const newPackage = await Package.findById(newPackageId);
  if (!newPackage) {
    return next(new ErrorResponse("New package not found", 404));
  }
  if (newPackage.siteId?.toString() !== newSiteId) {
    return next(
      new ErrorResponse("Package does not belong to the new site", 400),
    );
  }
  if (newPackage.packageType !== "ppp") {
    return next(new ErrorResponse("Only PPPoE packages are supported", 400));
  }

  console.log(`\n🚚 ========================================`);
  console.log(`   CUSTOMER MIGRATION STARTED`);
  console.log(`   Customer: ${customer.accountId}`);
  console.log(
    `   From: ${customer.siteId.siteName} (${customer.siteId.regionCode})`,
  );
  console.log(`   To: ${newSite.siteName} (${newSite.regionCode})`);
  console.log(`========================================\n`);

  const oldSite = customer.siteId;
  const oldPackage = customer.subscription.packageId;
  const oldPppoeUsername = customer.pppoe?.username;

  try {
    // ============================================
    // STEP 0: GET NEW ROUTER
    // ============================================
    console.log(`🔌 Getting primary router for new site`);
    let newRouter;
    try {
      newRouter = await getPrimaryRouterForSite(newSiteId);
    } catch (routerError) {
      throw new Error(`Cannot migrate: ${routerError.message}`);
    }
    console.log(`   Router: ${newRouter.name} (${newRouter.ip})`);

    // ============================================
    // STEP 1: DELETE OLD RADIUS ACCOUNT
    // ============================================
    if (oldPppoeUsername) {
      console.log(`🗑️  Deleting old RADIUS account: ${oldPppoeUsername}`);
      const radiusService = require("../services/radiusService");
      const deleteResult = await radiusService.deleteAccount(oldPppoeUsername);
      if (!deleteResult.success) {
        console.warn(
          `⚠️  Could not delete old RADIUS account: ${deleteResult.error}`,
        );
        // Continue – old account might not exist
      } else {
        console.log(`   ✅ Old RADIUS account deleted`);
      }
    }

    // ============================================
    // STEP 2: GENERATE NEW PPPoE CREDENTIALS
    // ============================================
    console.log(`🔐 Generating new PPPoE credentials`);
    const {
      generateAccountId,
      generatePPPoEPassword,
    } = require("../utils/accountHelpers");
    const newPppoeUsername = await generateAccountId(newSite.regionCode);
    const newPppoePassword = generatePPPoEPassword();
    console.log(`   New username: ${newPppoeUsername}`);

    // ============================================
    // STEP 3: CREATE NEW RADIUS ACCOUNT
    // ============================================
    // Build a temporary customer-like object for RADIUS creation
    const tempCustomer = {
      ...customer.toObject(),
      siteId: newSiteId,
      regionCode: newSite.regionCode,
      pppoe: {
        username: newPppoeUsername,
        password: newPppoePassword,
        macAddress: customer.pppoe?.macAddress || null,
        siteIp: newRouter.ip,
      },
    };

    const radiusService = require("../services/radiusService");
    const createResult = await radiusService.createAccount(
      tempCustomer,
      newPackage,
    );

    if (!createResult.success) {
      throw new Error(`RADIUS account creation failed: ${createResult.error}`);
    }
    console.log(`   ✅ New RADIUS account created`);

    // Handle activeService flag (disable if false)
    if (!activeService) {
      console.log(`   🔒 Disabling new RADIUS account (activeService = false)`);
      const disableResult =
        await radiusService.disableAccount(newPppoeUsername);
      if (!disableResult.success) {
        console.warn(
          `   ⚠️  Could not disable new account: ${disableResult.error}`,
        );
      } else {
        console.log(`   ✅ New account disabled`);
      }
    } else {
      // Ensure the account is enabled (it already is, but force if needed)
      const groupName = newPackage.packageName
        .replace(/\s+/g, "_")
        .toUpperCase();
      await radiusService.enableAccount(newPppoeUsername, groupName);
      console.log(`   ✅ New account enabled`);
    }

    // ============================================
    // STEP 4: UPDATE CUSTOMER RECORD
    // ============================================
    console.log(`💾 Updating customer record`);

    customer.siteId = newSiteId;
    customer.regionCode = newSite.regionCode;
    customer.pppoe = {
      username: newPppoeUsername,
      password: newPppoePassword,
      siteIp: newRouter.ip,
      macAddress: customer.pppoe?.macAddress || null,
    };
    customer.subscription.packageId = newPackageId;
    // Keep existing expiry date, balance, status, etc.
    // (You may optionally reset expiry to now + package period if desired)
    // For safety, we preserve the current expiry.

    // Add migration note
    customer.notes.push({
      note:
        reason ||
        `Migrated from ${oldSite.siteName} to ${newSite.siteName} (package: ${newPackage.packageName})`,
      addedBy: req.session.userId,
      addedAt: new Date(),
    });

    await customer.save();
    console.log(`   ✅ Customer record updated`);

    // ============================================
    // STEP 5: LOG MIGRATION
    // ============================================
    await SystemLog.create({
      eventType: "customer_migrated",
      severity: "info",
      regionCode: customer.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Customer ${customer.accountId} migrated: ${oldSite.siteName} → ${newSite.siteName}`,
      details: {
        customerId: customer._id,
        accountId: customer.accountId,
        oldSite: { siteId: oldSite._id, siteName: oldSite.siteName },
        newSite: { siteId: newSite._id, siteName: newSite.siteName },
        oldPackage: {
          packageId: oldPackage._id,
          packageName: oldPackage.packageName,
        },
        newPackage: {
          packageId: newPackage._id,
          packageName: newPackage.packageName,
        },
        oldPppoeUsername,
        newPppoeUsername,
        reason: reason || "Site migration",
        activeService,
      },
      triggeredBy: req.session.userId,
      success: true,
    });

    console.log(`\n✅ ========================================`);
    console.log(`   MIGRATION COMPLETED SUCCESSFULLY`);
    console.log(`   New PPPoE: ${newPppoeUsername}`);
    console.log(`   New Package: ${newPackage.packageName}`);
    console.log(`   Active: ${activeService}`);
    console.log(`========================================\n`);

    // Reload populated fields
    await customer.populate("subscription.packageId siteId");

    res.status(200).json({
      success: true,
      message: "Customer migrated successfully",
      data: {
        customer,
        migration: {
          from: {
            site: oldSite.siteName,
            package: oldPackage.packageName,
            pppoeUsername: oldPppoeUsername,
          },
          to: {
            site: newSite.siteName,
            package: newPackage.packageName,
            pppoeUsername: newPppoeUsername,
            pppoePassword: newPppoePassword,
          },
          activeService,
        },
      },
    });
  } catch (error) {
    return next(new ErrorResponse(`Migration failed: ${error.message}`, 500));
  }
});

// @desc    Change customer PPPoE password
// @route   PUT /api/customers/:id/change-password
// @access  Private (Admin, Manager)
exports.changePassword = asyncHandler(async (req, res, next) => {
  const { newPassword } = req.body;

  if (!newPassword ) {
    return next(
      new ErrorResponse("Password not provided", 400),
    );
  }

  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return next(new ErrorResponse("Resource not found: Customer", 404));
  }

  // Check region access
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  // Update password in customer database
  customer.pppoe.password = newPassword;
  await customer.save();

  console.log(`🔐 Changing password for ${customer.accountId}...`);

 

  // Update in RADIUS
  const radiusService = require("../services/radiusService");
  const radiusResult = await radiusService.updatePassword(
    customer.pppoe.username,
    newPassword,
  );

  if (!radiusResult.success) {
    console.error("⚠️ RADIUS password update failed:", radiusResult.error);
  } else {
    console.log("✅ RADIUS password updated");
  }

  // Log action
  await SystemLog.create({
    eventType: "customer_update",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Password changed for ${customer.accountId}`,
    userId: req.user._id,
    success: true,
  });

  console.log(`✅ Password change complete for ${customer.accountId}`);

  res.status(200).json({
    success: true,
    message: "Password changed successfully",
    data: null,
  });
});

// @desc    Update CPE information (MAC, WiFi, Model, Serial)
// @route   PUT /api/customers/:id/cpe
// @access  Private (Admin, Manager, Technical)
exports.updateCPE = asyncHandler(async (req, res, next) => {
  const { macAddress, wifiName, wifiPassword, model, serialNumber } = req.body;

  if (!macAddress && !wifiName && !wifiPassword && !model && !serialNumber) {
    return next(new ErrorResponse("At least one field is required", 400));
  }

  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    return next(new ErrorResponse("Resource not found: Customer", 404));
  }

  // Check region access
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  console.log(`🔧 Updating CPE info for ${customer.accountId}...`);

  const oldMacAddress = customer.cpe.macAddress;

  // Update CPE info
  if (macAddress) customer.cpe.macAddress = macAddress;
  if (wifiName) customer.cpe.wifiName = wifiName;
  if (wifiPassword) customer.cpe.wifiPassword = wifiPassword;
  if (model) customer.cpe.model = model;
  if (serialNumber) customer.cpe.serialNumber = serialNumber;

  await customer.save();

  // If MAC address changed, update in Mikrotik
  if (macAddress && macAddress !== oldMacAddress) {
    console.log(
      `📡 Updating MAC address in Mikrotik: ${oldMacAddress} → ${macAddress}`,
    );

    try {
      const router = await getRouterForCustomer(customer, false);

      if (router) {
        const mikrotikService = require("../services/mikrotikService");

        try {
          // Build site-like object for backward compatibility
          const siteObj = buildSiteLikeObjectFromRouter(router);

          const client = await mikrotikService.getConnection(siteObj);

          // Find the secret
          const secrets = await client.write("/ppp/secret/print", {
            "?name": customer.pppoe.username,
          });

          if (secrets && secrets.length > 0) {
            // Update caller-id (MAC address)
            await client.write("/ppp/secret/set", {
              ".id": secrets[0][".id"],
              "caller-id": macAddress,
            });

            console.log("✅ Mikrotik MAC address updated");
          }

          // Also update in RADIUS if MAC binding exists
          const radiusService = require("../services/radiusService");
          try {
            const connection = await radiusService.getConnection();

            // Delete old MAC binding
            await connection.query(
              `DELETE FROM radcheck WHERE username = ? AND attribute = 'Calling-Station-Id'`,
              [customer.pppoe.username],
            );

            // Insert new MAC binding
            await connection.query(
              `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Calling-Station-Id', '==', ?)`,
              [customer.pppoe.username, macAddress.toUpperCase()],
            );

            connection.release();
            console.log("✅ RADIUS MAC address updated");
          } catch (radiusError) {
            console.error("⚠️ RADIUS MAC update failed:", radiusError.message);
          }
        } catch (error) {
          console.error("⚠️ Failed to update MAC in Mikrotik:", error.message);
        }
      } else {
        console.warn(
          "⚠️ No router found for this customer, skipping Mikrotik MAC update",
        );
      }
    } catch (routerError) {
      console.error("⚠️ Error getting router:", routerError.message);
    }
  }

  // Log action
  await SystemLog.create({
    eventType: "customer_update",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `CPE information updated for ${customer.accountId}`,
    details: { macAddress, wifiName, model, serialNumber },
    userId: req.user._id,
    success: true,
  });

  console.log(`✅ CPE update complete for ${customer.accountId}`);

  // Populate before sending response
  await customer.populate("subscription.packageId siteId");

  res.status(200).json({
    success: true,
    message: "CPE information updated successfully",
    data: customer,
  });
});

// ============================================
// NEW FUNCTIONS TO ADD TO customerController.js
// ============================================

/**
 * @desc    Get customer router status (via PPPoE) - RADIUS-based version
 * @route   GET /api/customers/:id/router-status
 * @access  Private
 *
 * Determines real-time connection status by querying RADIUS database.
 * Returns online/offline status, uptime, IP address, and diagnostic information.
 */
exports.getCustomerRouterStatus = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id).populate("siteId");
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  // Region access check
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied", 403));
  }
  if (!customer.pppoe?.username) {
    return next(new ErrorResponse("No PPPoE credentials", 400));
  }

  const radiusService = require("../services/radiusService");
  const now = new Date();

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
      console.error("Error fetching last session end time:", err);
      return null;
    } finally {
      if (conn) conn.release();
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds <= 0) return "0s";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    return parts.join(" ");
  };

  // Fetch latest authentication result from radius_auth_log
  const getLatestAuthResult = async (username) => {
    let conn;
    try {
      conn = await radiusService.getConnection();
      const [rows] = await conn.query(
        `SELECT auth_result, auth_timestamp, password, calling_station_id, nas_ip_address
         FROM radius_auth_log
         WHERE username = ?
         ORDER BY auth_timestamp DESC
         LIMIT 1`,
        [username]
      );
      if (rows.length === 0) return null;
      let decodedPassword = null;
      try {
        decodedPassword = Buffer.from(rows[0].password, "base64").toString("utf8");
      } catch (e) {
        decodedPassword = rows[0].password;
      }
      return {
        authResult: rows[0].auth_result,
        timestamp: rows[0].auth_timestamp,
        attemptedPassword: decodedPassword,
        callingStationId: rows[0].calling_station_id,
        nasIpAddress: rows[0].nas_ip_address,
      };
    } catch (err) {
      console.error("Error fetching auth log:", err);
      return null;
    } finally {
      if (conn) conn.release();
    }
  };

  // Check router reachability (unchanged – only for offline reason)
  const expectedNasIp = customer.pppoe.siteIp || null;
  // if (expectedNasIp) {
  //   const mikrotikService = require("../services/mikroticService");
  //   const router = await Router.findOne({ ip: expectedNasIp });
  //   if (router) {
  //     const testResult = await mikrotikService.testConnection({
  //       router: {
  //         ip: expectedNasIp,
  //         username: router.username,
  //         password: router.password,
  //         port: router.apiPort || 8728,
  //       },
  //     });
  //     if (!testResult.success) {
  //       const lastEndTime = await getLastSessionEndTime(customer.pppoe.username);
  //       const lastSeen = lastEndTime || customer.createdAt;
  //       const offlineSince = lastSeen;
  //       const offlineMs = Date.now() - new Date(offlineSince).getTime();
  //       const offlineDuration = formatDuration(Math.floor(offlineMs / 1000));

  //       return res.status(200).json({
  //         success: true,
  //         data: {
  //           customerInfo: {
  //             username: customer.pppoe.username,
  //             accountId: customer.accountId,
  //             name: `${customer.firstName} ${customer.lastName}`,
  //             package: customer.subscription?.packageId?.packageName || "N/A",
  //           },
  //           routerInfo: {
  //             routerIp: expectedNasIp,
  //             siteName: customer.siteId?.siteName || "Unknown",
  //           },
  //           status: "offline",
  //           connectionInfo: {
  //             reason: "Router Unreachable",
  //             ipAddress: null,
  //             macAddress: customer.cpe?.macAddress || null,
  //             uptime: null,
  //             uptimeSeconds: 0,
  //             offlineSince: offlineSince.toISOString(),
  //             offlineDuration,
  //             lastSeen: lastSeen.toISOString(),
  //             routerBrand: customer.cpe?.model || null,
  //           },
  //         },
  //       });
  //     }
  //   }
  // }

  // Get active RADIUS session (online/offline)
  let sessionStatus;
  
  sessionStatus = await radiusService.getUserConnectionStatus(
    customer.pppoe.username,
    expectedNasIp
  );
  if (!sessionStatus.success) {
    return next(new ErrorResponse(`RADIUS query failed: ${sessionStatus.error}`, 500));
  }

  if(customer.accountId !== customer.pppoe.username && !sessionStatus.isOnline && !sessionStatus.isOnlineNoInternet){
    sessionStatus = await radiusService.getUserConnectionStatus(
      customer.accountId,
      expectedNasIp
    );
   
  }






  // Get latest authentication log
  const authLog = await getLatestAuthResult(customer.pppoe.username);
// After checking sessionStatus and authLog
let routerBrand = null;
let macToLookup = null;

// Prefer the MAC from the active session, otherwise fallback to stored CPE MAC
if (sessionStatus.callingMac) {
  macToLookup = sessionStatus.callingMac;
} else if (customer.cpe?.macAddress) {
  macToLookup = customer.cpe.macAddress;
}

if (macToLookup) {
  routerBrand = await getMacVendor(macToLookup);
}

// Update customer connectionStatus cache
if (!customer.connectionStatus) customer.connectionStatus = {};
customer.connectionStatus.lastChecked = now;
customer.connectionStatus.currentIp = sessionStatus.ipAddress || null;
customer.connectionStatus.currentMac = customer.cpe?.macAddress || null;
customer.connectionStatus.currentNasIp = sessionStatus.nasIpAddress || null;  // fixed placement

  // Base response data (same structure)
  const responseData = {
    customerInfo: {
      username: customer.pppoe.username,
      accountId: customer.accountId,
      name: `${customer.firstName} ${customer.lastName}`,
      package: customer.subscription?.packageId?.packageName || "N/A",
    },
    routerInfo: {
      routerIp: customer.siteId?.router?.ip || "Unknown",
      siteName: customer.siteId?.siteName || "Unknown",
    },
  };
  const alreadyBindedMac = customer.cpe?.macAddress || "";

  // CASE 1: Active session exists
  if (sessionStatus.isOnline || sessionStatus.isOnlineNoInternet) {
    const hasActiveSession = true;
    const ipAddress = sessionStatus.ipAddress;
    const startTime = sessionStatus.startTime;
    const sessionTime = sessionStatus.sessionTime;
    const callingMac = sessionStatus.callingMac;
    const nasIpAddress = sessionStatus.nasIpAddress;
   

   

    // Determine issue from auth_log (if available)
    let finalStatus = "online-no-internet";
    let reason = "";
    let authFailure = null;

    if (authLog && authLog.authResult) {
      switch (authLog.authResult) {
        case "correct":
          finalStatus = "online";
          reason = "";
          break;
        case "disabled":
          finalStatus = "online-no-internet";
          reason = "Account disabled";
          break;
        case "wrong_password":
          finalStatus = "online-no-internet";
          reason = "Wrong password";
          authFailure = {
            attemptedPassword: authLog.attemptedPassword,
            timestamp: authLog.timestamp,
            message: "Wrong password used",
          };
          break;
        case "mac_mismatch":
          finalStatus = "online-no-internet";
          reason = "MAC address mismatch";
          break;
        case "no_user":
          finalStatus = "online-no-internet";
          reason = "User does not exist";
          authFailure = {
            attemptedPassword: authLog.attemptedPassword,
            timestamp: authLog.timestamp,
            message: "User does not exist in RADIUS",
          };
          break;
        default:
          finalStatus = "online-no-internet";
          reason = "Unknown authentication issue";
      }
    } else {
      // No auth log – fallback to session status
      if (sessionStatus.isOnline) finalStatus = "online";
      else finalStatus = "online-no-internet";
    }

    // Update customer status in database
    if (finalStatus === "online") {
      customer.connectionStatus.status = "online";
      customer.connectionStatus.lastOnline = now;
      if (customer.connectionStatus.noInternetSince) customer.connectionStatus.noInternetSince = null;
    } else {
      customer.connectionStatus.status = "online-no-internet";
      if (!customer.connectionStatus.noInternetSince) customer.connectionStatus.noInternetSince = now;
      if (!customer.connectionStatus.lastOnline) customer.connectionStatus.lastOnline = startTime || now;
    }

    // Save NAS IP if changed
    if (nasIpAddress && customer.nasIp !== nasIpAddress) {
      customer.pppoe.siteIp = nasIpAddress;
      customer.nasIp = nasIpAddress;
      await customer.save({ validateBeforeSave: false });
    }

    // Update MAC binding if needed
    

    await customer.save({ validateBeforeSave: false });

    responseData.status = finalStatus;
    responseData.connectionInfo = {
      ipAddress,
      macAddress: callingMac || customer.cpe?.macAddress || null,
      uptime: formatDuration(sessionTime),
      uptimeSeconds: sessionTime,
      onlineSince: startTime?.toISOString() || now.toISOString(),
      lastSeen: now.toISOString(),
      nasIpAddress,
      routerBrand,
      alreadyBindedMac,
    };
    if (reason) responseData.connectionInfo.reason = reason;
    if (authFailure) responseData.authFailure = authFailure;

    return res.status(200).json({ success: true, data: responseData });
  }

  // CASE 2: No active session – offline
  const lastEndTime = await getLastSessionEndTime(customer.pppoe.username);
  const lastSeen = lastEndTime || customer.createdAt;
  const offlineSince = lastSeen;
  const offlineMs = Date.now() - new Date(offlineSince).getTime();
  const offlineDuration = formatDuration(Math.floor(offlineMs / 1000));

  customer.connectionStatus.status = "offline";
  if (!customer.connectionStatus.lastOffline && customer.connectionStatus.lastOnline) {
    customer.connectionStatus.lastOffline = now;
  }
  if (customer.connectionStatus.noInternetSince) customer.connectionStatus.noInternetSince = null;
  customer.connectionStatus.lastOnline = lastSeen;
  await customer.save({ validateBeforeSave: false });

  // Check for recent auth failure while offline
  let offlineAuthFailure = null;
  if (authLog && authLog.authResult !== "correct") {
    offlineAuthFailure = {
      attemptedPassword: authLog.attemptedPassword,
      timestamp: authLog.timestamp,
      message: `Last auth attempt failed: ${authLog.authResult}`,
    };
  }

  responseData.status = "offline";
  responseData.connectionInfo = {
    ipAddress: null,
    macAddress: customer.cpe?.macAddress || null,
    uptime: null,
    uptimeSeconds: 0,
    offlineSince: offlineSince.toISOString(),
    offlineDuration,
    lastSeen: lastSeen.toISOString(),
    routerBrand,
    registeredAt: customer.createdAt,
    alreadyBindedMac,
  };
  if (offlineAuthFailure) responseData.authFailure = offlineAuthFailure;

  return res.status(200).json({ success: true, data: responseData });
});


/**
 * @desc    Reset customer MAC address (when ONU is replaced)
 * @route   POST /api/customers/:id/reset-mac
 * @access  Private
 *
 * When a customer's ONU/router is replaced:
 * 1. Auto-detect new MAC from RADIUS active session (if online)
 * 2. Or accept manual MAC, serial, model from request body
 * 3. Lookup manufacturer (brand) from MAC using API
 * 4. Update CPE and PPPoE MAC fields
 * 5. Log the change
 */
exports.resetCustomerMac = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id).populate("siteId");
  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  // Check region access
  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  // Check if customer has PPPoE credentials
  if (!customer.pppoe || !customer.pppoe.username) {
    return next(
      new ErrorResponse("Customer does not have PPPoE credentials", 400),
    );
  }

  const { serialNumber, macAddress, model, reason } = req.body;

  try {
    console.log(
      `🔄 Resetting MAC for customer: ${customer.firstName} ${customer.lastName}`,
    );

    // Store old CPE info for logging
    const oldCpe = {
      serialNumber: customer.cpe?.serialNumber,
      macAddress: customer.cpe?.macAddress,
      model: customer.cpe?.model,
    };

    let newMacAddress = null;
    let newModel = model;
    let newSerialNumber = serialNumber;
    let routerBrand = null;
    let detectionMethod = "manual";

    // ============================================
    // Option 1: Manual entry (admin provides details)
    // ============================================
    if (macAddress || serialNumber || model) {
      console.log("📝 Using manually provided CPE info");
      newMacAddress = macAddress || customer.cpe?.macAddress;
      newSerialNumber = serialNumber || customer.cpe?.serialNumber;
      newModel = model || customer.cpe?.model;
      detectionMethod = "manual";
    }
    // ============================================
    // Option 2: Auto-detect from RADIUS active session
    // ============================================
    else {
      console.log("🔍 Auto-detecting MAC from RADIUS active session");
      const radiusService = require("../services/radiusService");

      // Get user's connection status from RADIUS
      const statusResult = await radiusService.getUserConnectionStatus(
        customer.pppoe.username,
      );
      if (!statusResult.success) {
        throw new Error(`RADIUS query failed: ${statusResult.error}`);
      }

      // Check if there is an active session and get the MAC (Calling-Station-Id)
      // Note: getUserConnectionStatus currently returns ipAddress, startTime, etc., but not MAC.
      // We need to query radacct with the session ID to get Calling-Station-Id?
      // Actually, Calling-Station-Id is stored in radacct table (callingstationid column).
      // Let's do a separate query to get the MAC from the active session.

      if (!statusResult.isOnline && !statusResult.isOnlineNoInternet) {
        return next(
          new ErrorResponse(
            "Customer is not currently online. Please provide MAC address, serial number, or model manually.",
            400,
          ),
        );
      }

      // Fetch the active session details including MAC
      let conn;
      try {
        conn = await radiusService.getConnection();
        const [rows] = await conn.query(
          `SELECT callingstationid, framedipaddress, acctstarttime
           FROM radacct 
           WHERE username = ? AND acctstoptime IS NULL
           ORDER BY acctstarttime DESC
           LIMIT 1`,
          [customer.pppoe.username],
        );
        if (rows.length === 0 || !rows[0].callingstationid) {
          throw new Error("No MAC address found in active RADIUS session");
        }
        newMacAddress = rows[0].callingstationid
          .toUpperCase()
          .replace(/-/g, ":");
        console.log(`✅ Detected MAC from RADIUS: ${newMacAddress}`);
      } catch (dbErr) {
        console.error("RADIUS MAC query error:", dbErr);
        throw new Error(`Could not retrieve MAC from RADIUS: ${dbErr.message}`);
      } finally {
        if (conn) conn.release();
      }

      detectionMethod = "auto-detect";
    }

    // ============================================
    // Lookup router brand (vendor) from MAC
    // ============================================
    if (newMacAddress) {
      const { getMacVendor } = require("../utils/macVendor");
      routerBrand = await getMacVendor(newMacAddress);
      if (routerBrand) {
        console.log(`🏷️ Detected brand: ${routerBrand}`);
      } else {
        console.log(`⚠️ Could not determine brand for MAC: ${newMacAddress}`);
      }
    }

    // After updating customer.cpe and customer.pppoe.macAddress, and before saving:
    if (newMacAddress) {
      const radiusService = require("../services/radiusService");
      const macUpdateResult = await radiusService.updateMacBinding(
        customer.pppoe.username,
        newMacAddress,
      );
      if (!macUpdateResult.success) {
        console.warn(
          "RADIUS MAC binding update failed:",
          macUpdateResult.error,
        );
        // Still continue, but log
      }
    }

    // ============================================
    // Update customer CPE and PPPoE MAC fields
    // ============================================
    // Keep existing WiFi credentials
    const wifiName = customer.cpe?.wifiName;
    const wifiPassword = customer.cpe?.wifiPassword;

    // Update CPE object
    customer.cpe = {
      serialNumber: newSerialNumber || customer.cpe?.serialNumber,
      macAddress: newMacAddress,
      model: newModel || customer.cpe?.model,
      wifiName,
      wifiPassword,
    };

    // Also update pppoe.macAddress if used for MAC binding
    if (newMacAddress) {
      customer.pppoe.macAddress = newMacAddress;
    }

    // Optionally store the brand in a new field (you may want to add `cpe.brand` to the schema)
    // For now, we can add it to cpe as an extra field (or store in notes)
    if (routerBrand) {
      // If your Customer schema has a field for brand, set it here.
      // Example: customer.cpe.brand = routerBrand;
      // Since the schema doesn't have it, we'll add a note about the brand.
      customer.cpe.model = routerBrand;
      customer.notes.push({
        note: `CPE brand detected: ${routerBrand} (MAC: ${newMacAddress})`,
        addedBy: req.session.userId,
        addedAt: new Date(),
      });
    }

    await customer.save();

    // ============================================
    // Log the change
    // ============================================
    await SystemLog.create({
      eventType: "cpe_reset",
      severity: "info",
      regionCode: customer.regionCode,
      entityType: "customer",
      entityId: customer._id,
      accountId: customer.accountId,
      message: `CPE info reset for ${customer.firstName} ${customer.lastName}`,
      details: {
        customerId: customer._id,
        accountId: customer.accountId,
        oldCpe,
        newCpe: {
          serialNumber: customer.cpe.serialNumber,
          macAddress: customer.cpe.macAddress,
          model: customer.cpe.model,
          brand: routerBrand || null,
        },
        reason: reason || "Equipment replacement",
        method: detectionMethod,
      },
      success: true,
      performedBy: req.session.user?.username || req.session.userId || "system",
    });

    // ============================================
    // Return response
    // ============================================
    res.status(200).json({
      success: true,
      message:
        detectionMethod === "manual"
          ? "CPE information updated successfully"
          : "CPE MAC address auto-detected from RADIUS and updated",
      data: {
        customer: {
          accountId: customer.accountId,
          name: `${customer.firstName} ${customer.lastName}`,
          cpe: {
            serialNumber: customer.cpe.serialNumber,
            macAddress: customer.cpe.macAddress,
            model: customer.cpe.model,
            brand: routerBrand,
          },
          pppoe: {
            macAddress: customer.pppoe.macAddress,
          },
        },
        changes: {
          serialNumber: {
            old: oldCpe.serialNumber,
            new: customer.cpe.serialNumber,
          },
          macAddress: { old: oldCpe.macAddress, new: customer.cpe.macAddress },
          model: { old: oldCpe.model, new: customer.cpe.model },
          brand: routerBrand,
        },
        detectionMethod,
      },
    });
  } catch (error) {
    console.error("Reset MAC error:", error);

    // Log failed attempt
    await SystemLog.create({
      eventType: "cpe_reset",
      severity: "error",
      regionCode: customer.regionCode,
      entityType: "customer",
      entityId: customer._id,
      message: `Failed to reset CPE info for ${customer.firstName} ${customer.lastName}`,
      details: {
        customerId: customer._id,
        accountId: customer.accountId,
        error: error.message,
      },
      success: false,
      performedBy: req.session.user?.username || req.session.userId || "system",
    });

    return next(
      new ErrorResponse(`Failed to reset CPE info: ${error.message}`, 500),
    );
  }
});

/**
 * @desc    Clear MAC binding for a customer (remove MAC restriction)
 * @route   POST /api/customers/:id/clear-mac
 * @access  Private
 */
exports.clearCustomerMac = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied", 403));
  }

  const radiusService = require("../services/radiusService");
  const result = await radiusService.clearMacBinding(customer.pppoe.username);

  if (!result.success) {
    return next( 
      new ErrorResponse(`Failed to clear MAC binding: ${result.error}`, 500),
    );
  }

  // Also clear from customer document
  if (customer.pppoe.macAddress) {
    customer.pppoe.macAddress = null;
    await customer.save();
  }

  await SystemLog.create({
    eventType: "customer_mac_cleared",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `MAC binding cleared for ${customer.accountId}`,
    triggeredBy: req.session.userId,
    success: true,
  });

  res.status(200).json({
    success: true,
    message: "MAC binding cleared. Customer can now connect from any device.",
    data: { username: customer.pppoe.username },
  });
});

/**
 * @desc    Create child account under an existing customer
 * @route   POST /api/customers/:parentId/children
 * @access  Private
 */
/**
 * @desc    Create child account under an existing customer
 * @route   POST /api/customers/:parentId/children
 * @access  Private
 */
/**
 * @desc    Create child account under an existing customer (with sharing options)
 * @route   POST /api/customers/:parentId/children
 * @access  Private
 */
exports.createChildAccount = asyncHandler(async (req, res, next) => {
  const { parentId } = req.params;

  // 1. Find parent
  const parent = await Customer.findById(parentId);
  if (!parent) return next(new ErrorResponse("Parent customer not found", 404));
  if (parent.isChild) return next(new ErrorResponse("Cannot create child under another child", 400));

  // 2. Extract child-specific fields, including sharing flags
  const {
    packageId,
    siteId,
    city,
    subLocation,
    localArea,
    siteMacAddress,
    clientMacAddress,
    wifiName,
    wifiPassword,
    model,
    serialNumber,
    notes,
    sharePackage = false,
    shareExpiry = false,
    firstName: overrideFirstName,
    lastName: overrideLastName,
    email: overrideEmail,
    phoneNumber: overridePhone,
    alternatePhoneNumber: overrideAltPhone,
    location: overrideLocation,
  } = req.body;

  // Validate mandatory fields (location + CPE)
  if (!siteId || !city || !subLocation || !localArea || !clientMacAddress || !wifiName || !wifiPassword || !model || !serialNumber) {
    return next(new ErrorResponse("Missing required fields: siteId, city, subLocation, localArea, clientMacAddress, wifiName, wifiPassword, model, serialNumber", 400));
  }

  // If NOT sharing package, packageId must be provided
  if (!sharePackage && !packageId) {
    return next(new ErrorResponse("Package ID is required when not sharing parent's package", 400));
  }

  // Resolve site
  const site = await Site.findById(siteId);
  if (!site) return next(new ErrorResponse("Site not found", 404));

  // Determine effective package
  let effectivePackageId;
  if (sharePackage) {
    effectivePackageId = parent.subscription.packageId;
    if (!effectivePackageId) return next(new ErrorResponse("Parent has no package to share", 400));
  } else {
    const pkg = await Package.findById(packageId);
    if (!pkg) return next(new ErrorResponse("Package not found", 404));
    if (pkg.siteId.toString() !== siteId) return next(new ErrorResponse("Package does not belong to this site", 400));
    if (pkg.packageType !== "ppp") return next(new ErrorResponse("Only PPPoE packages allowed", 400));
    effectivePackageId = pkg._id;
  }

  // Inherit or override personal info
  const firstName = overrideFirstName || parent.firstName;
  const lastName = overrideLastName || parent.lastName;
  const email = overrideEmail || parent.email;
  const phoneNumber = overridePhone ? formatPhoneNumber(overridePhone) : parent.phoneNumber;
  const alternatePhoneNumber = overrideAltPhone ? formatPhoneNumber(overrideAltPhone) : parent.alternatePhoneNumber;
  const location = overrideLocation ? { ...parent.location, ...overrideLocation } : parent.location;

  // Generate child account ID
// Get all children's accountIds
const children = await Customer.find(
  { parentAccount: parent._id },
  { accountId: 1 }   // only fetch accountId for efficiency
);

let highestSuffix = 0;
for (const child of children) {
  const parts = child.accountId.split('-');
  if (parts.length === 2) {
    const num = parseInt(parts[1], 10);
    if (!isNaN(num) && num > highestSuffix) {
      highestSuffix = num;
    }
  }
}

const nextSuffix = highestSuffix + 1;
const suffix = nextSuffix.toString().padStart(2, '0');
const finalAccountId = `${parent.accountId}-${suffix}`;
const pppoePassword = generatePPPoEPassword();

  // Set expiry based on sharing flag
  let expiresAt;
  let subStatus = 'expired';

  if (shareExpiry) {
    console.log("They are sharing expiry with parent.")
    expiresAt = parent.subscription.expiresAt; // same as parent
    if(parent.subscription.status !== 'expired' ){
      subStatus = 'active';
    }
  } else {
    expiresAt = new Date(Date.now() - 1000);
  }

  // Create child document
  const child = await Customer.create({
    accountId: finalAccountId,
    regionCode: site.regionCode,
    siteId,
    firstName,
    lastName,
    email,
    phoneNumber,
    alternatePhoneNumber,
    city,
    subLocation,
    localArea,
    location,
    pppoe: {
      username: finalAccountId,
      password: pppoePassword,
      macAddress: siteMacAddress || null,
    },
    cpe: {
      serialNumber,
      macAddress: clientMacAddress,
      model,
      wifiName,
      wifiPassword,
    },
    subscription: {
      packageId: effectivePackageId,
      status: subStatus, // always start expired – activation requires payment or parent's active status later
      activatedAt: null,
      expiresAt,
      autoRenew: true,
    },
    billing: { balance: 0 },
    isChild: true,
    parentAccount: parent._id,
    shared: {
      expiryWithParent: shareExpiry,
      packageWithParent: sharePackage,
    },
    createdBy: req.session.userId,
  });

  // Add note if provided
  if (notes) {
    child.notes.push({ note: notes, addedBy: req.session.userId, addedAt: new Date() });
    await child.save();
  }

  // Update parent's shared arrays
  if (shareExpiry) {
    await Customer.updateOne(
      { _id: parent._id },
      { $addToSet: { sharedExpiry: child._id } }
    );
  }
  if (sharePackage) {
    await Customer.updateOne(
      { _id: parent._id },
      { $addToSet: { sharedPackage: child._id } }
    );
  }

  // Update site coverage (non-critical)
  try {
    await site.addCityIfNotExists(child.city);
    await site.addSubLocationIfNotExists(child.city, child.subLocation);
    await site.addLocalAreaIfNotExists(child.city, child.subLocation, child.localArea);
  } catch (err) {
    console.warn(`Site coverage update failed for ${child.accountId}:`, err.message);
  }

  // Create RADIUS account (disabled initially)
  let radiusMessage = "";
  try {
    const packageDoc = await Package.findById(effectivePackageId);
    const radiusService = require("../services/radiusService");
    const radiusResult = await radiusService.createAccount(child, packageDoc);
    if (!radiusResult.success) throw new Error(radiusResult.error);
    if(subStatus === 'expired'){
      await radiusService.disableAccount(child.pppoe.username);
    }else{
      const groupName = packageDoc.packageName.replace(/\s+/g, "_").toUpperCase();
      await radiusService.enableAccount(child.pppoe.username, groupName);
    }
    
    radiusMessage = "RADIUS account created and disabled.";
  } catch (error) {
    console.error("RADIUS account creation failed for child:", error.message);
    radiusMessage = `RADIUS account creation failed: ${error.message}`;
  }

  // Log creation
  await SystemLog.create({
    eventType: "child_account_created",
    severity: "info",
    regionCode: child.regionCode,
    entityType: "customer",
    entityId: child._id,
    accountId: child.accountId,
    message: `Child account created for ${parent.accountId}: ${child.accountId}`,
    details: {
      parentId: parent._id,
      childId: child._id,
      sharePackage,
      shareExpiry,
      radius: radiusMessage,
    },
    triggeredBy: req.session.userId,
    success: true,
  });

  res.status(201).json({
    success: true,
    message: `Child account created successfully. ${radiusMessage}`,
    data: child,
  });
});


/**
 * @desc    Update child account (including sharing toggles)
 * @route   PUT /api/customers/child/:id
 * @access  Private
 */
exports.updateChildAccount = asyncHandler(async (req, res, next) => {
  const child = await Customer.findById(req.params.id).populate('subscription.packageId');
  if (!child) return next(new ErrorResponse("Child account not found", 404));
  if (!child.isChild) return next(new ErrorResponse("This is not a child account", 400));

  const parent = await Customer.findById(child.parentAccount);
  if (!parent) return next(new ErrorResponse("Parent account not found", 400));

  // Region access check
  if (req.regionFilter?.regionCode && child.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse("Access denied", 403));
  }

  const {
    sharePackage,
    shareExpiry,
    packageId,            // only used if sharePackage becomes false
    city, subLocation, localArea,
    clientMacAddress, wifiName, wifiPassword, model, serialNumber,
    phoneNumber,           // optional override
    notes,
    firstName,
    lastName,
    alternatePhoneNumber,
  } = req.body;

  // Update sharing flags
  const oldSharePackage = child.shared?.packageWithParent || false;
  const oldShareExpiry = child.shared?.expiryWithParent || false;

  if(alternatePhoneNumber){
    child.alternatePhoneNumber = alternatePhoneNumber;
  }

  if (firstName && firstName !== child.firstName) {
    
    child.firstName = firstName;
  }

  if (lastName && lastName !== child.lastName) {
   
    child.lastName = lastName;
  }

  if (sharePackage !== undefined && sharePackage !== oldSharePackage) {
    child.shared.packageWithParent = sharePackage;
    if (sharePackage) {
      // Start sharing: use parent's package
      child.subscription.packageId = parent.subscription.packageId;
      // Add child to parent's sharedPackage array
      await Customer.updateOne(
        { _id: parent._id },
        { $addToSet: { sharedPackage: child._id } }
      );
    } else {
      // Stop sharing: need to assign a specific package
      if (!packageId) return next(new ErrorResponse("Package ID required when unsharing package", 400));
      const pkg = await Package.findById(packageId);
      if (!pkg) return next(new ErrorResponse("Package not found", 404));
      if (pkg.siteId.toString() !== child.siteId.toString()) {
        return next(new ErrorResponse("Package does not belong to child's site", 400));
      }
      child.subscription.packageId = pkg._id;
      // Remove child from parent's sharedPackage array
      await Customer.updateOne(
        { _id: parent._id },
        { $pull: { sharedPackage: child._id } }
      );
    }
  }

  if (shareExpiry !== undefined && shareExpiry !== oldShareExpiry) {
    child.shared.expiryWithParent = shareExpiry;
    if (shareExpiry) {
      const radiusService = require("../services/radiusService");
      if(child.subscription.status !== parent.subscription.status){
        child.subscription.status = parent.subscription.status;
        if(parent.subscription.status === "active"){
          const groupName = child.subscription.packageId.packageName.replace(/\s+/g, '_').toUpperCase();          
          await radiusService.enableAccount(child.pppoe.username, groupName);
        }else{
          console.log("Parent was disabled, disabling child");
          
          await radiusService.disableAccount(child.pppoe.username);
        }
        
      }
      child.subscription.expiresAt = parent.subscription.expiresAt;
      
      await Customer.updateOne(
        { _id: parent._id },
        { $addToSet: { sharedExpiry: child._id } }
      );

      
    } else {
      // Stop sharing expiry – set a default (e.g., expired)
      child.subscription.expiresAt = new Date(Date.now() - 1000);
      await Customer.updateOne(
        { _id: parent._id },
        { $pull: { sharedExpiry: child._id } }
      );
    }
  }

  // Location updates
  if (city) child.city = city;
  if (subLocation) child.subLocation = subLocation;
  if (localArea) child.localArea = localArea;

  // CPE updates
  if (clientMacAddress) child.cpe.macAddress = clientMacAddress;
  if (wifiName) child.cpe.wifiName = wifiName;
  if (wifiPassword) child.cpe.wifiPassword = wifiPassword;
  if (model) child.cpe.model = model;
  if (serialNumber) child.cpe.serialNumber = serialNumber;

  // Phone override
  if (phoneNumber) child.phoneNumber = formatPhoneNumber(phoneNumber);

  if (notes) {
    child.notes.push({ note: notes, addedBy: req.session.userId, addedAt: new Date() });
  }

  await child.save();

  // If package changed (including unsharing), update RADIUS group
  if ((sharePackage !== undefined && sharePackage !== oldSharePackage) ||
      (!sharePackage && packageId)) {
    const groupName = child.subscription.packageId.packageName.replace(/\s+/g, '_').toUpperCase();
    const radiusService = require("../services/radiusService");
    await radiusService.updateBandwidth(child.pppoe.username, child.subscription.packageId.speed.upload, child.subscription.packageId.speed.download, groupName);
  }

  // If expiry sharing changed or parent's expiry changed later will be handled via separate sync

  res.status(200).json({ success: true, data: child });
});

/**
 * @desc    Get child accounts of a parent
 * @route   GET /api/customers/:parentId/children
 * @access  Private
 */
/**
 * @desc    Get child accounts of a parent (with live connection status)
 * @route   GET /api/customers/:parentId/children
 * @access  Private
 */
exports.getChildren = asyncHandler(async (req, res, next) => {
  const { parentId } = req.params;

  const parent = await Customer.findById(parentId);
  if (!parent) return next(new ErrorResponse("Parent not found", 404));

  // Get all children (no region restriction)
  const children = await Customer.find({ parentAccount: parentId })
    .populate("subscription.packageId", "packageName")
    .populate("siteId", "siteName")
    .select("-pppoe.password -cpe.wifiPassword")
    .lean();

  if (children.length === 0) {
    return res.status(200).json({ success: true, data: [] });
  }

  // Get usernames for RADIUS status check
  const usernames = children.map(c => c.pppoe?.username).filter(Boolean);
  const expectedNasIpMap = {};
  for (const child of children) {
    if (child.pppoe?.siteIp) {
      expectedNasIpMap[child.pppoe.username] = child.pppoe.siteIp;
    }
  }

  const radiusService = require("../services/radiusService");
  let statuses = {};
  if (usernames.length > 0) {
    statuses = await radiusService.getBulkUserConnectionStatus(usernames, expectedNasIpMap);
  }

  // Enrich children with connectivity
  const enriched = children.map(child => {
    const username = child.pppoe?.username;
    const radiusStatus = statuses[username];
    const isOnline = radiusStatus?.isOnline || false;
    const connectivity = isOnline ? "online" : "offline";
    return {
      ...child,
      connectivity
    };
  });

  res.status(200).json({
    success: true,
    data: enriched,
  });
});

/**
 * @desc    Get customer data usage (since subscription activation and today)
 * @route   GET /api/customers/:id/usage
 * @access  Private
 */
exports.getCustomerUsage = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id).populate(
    "subscription.packageId",
  );
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied", 403));
  }

  const radiusService = require("../services/radiusService");
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const pkg = customer.subscription.packageId;
  let cycleStart;

  if (pkg && pkg.fup?.enabled && pkg.fup.resetPeriod === "monthly") {
    // Monthly reset: first day of current month at 00:00 local time
    cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    // Billing cycle or fallback
    cycleStart =
      customer.billingCycle?.startDate ||
      customer.subscription.activatedAt ||
      customer.createdAt;
    if (cycleStart) cycleStart = new Date(cycleStart);
    cycleStart.setHours(0, 0, 0, 0);
  }

  const totalUsage = await radiusService.getUserUsageStats(
    customer.pppoe.username,
    cycleStart,
    now,
  );
  const todayUsage = await radiusService.getUserUsageStats(
    customer.pppoe.username,
    startOfDay,
    now,
  );

  res.json({
    success: true,
    data: {
      cycleStart: cycleStart.toISOString(),
      cycleEnd: customer.subscription.expiresAt?.toISOString() || null,
      total: {
        uploadGB: totalUsage.uploadGB,
        downloadGB: totalUsage.downloadGB,
        totalGB: totalUsage.totalGB,
        sessions: totalUsage.sessions,
        totalTime: totalUsage.totalTime,
      },
      today: {
        uploadGB: todayUsage.uploadGB,
        downloadGB: todayUsage.downloadGB,
        totalGB: todayUsage.totalGB,
        sessions: todayUsage.sessions,
        totalTime: todayUsage.totalTime,
      },
    },
  });
});

// Get SMS logs for a customer (by customerId)
exports.getCustomerSmsLogs = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  if (
    req.regionFilter.regionCode &&
    customer.regionCode !== req.regionFilter.regionCode
  ) {
    return next(new ErrorResponse("Access denied", 403));
  }

  const { page = 1, limit = 20 } = req.query;
  const logs = await SmsLog.find({ "recipient.accountId": customer.accountId })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));
  const total = await SmsLog.countDocuments({
    "recipient.accountId": customer.accountId,
  });

  res.json({
    success: true,
    data: {
      logs,
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
 * @desc    Calculate cost to move expiry date forward
 * @route   POST /api/customers/:id/calculate-expiry-move
 * @access  Private (Customer portal or admin)
 */
exports.calculateExpiryMove = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { targetDate } = req.body;
  if (!targetDate)
    return next(new ErrorResponse("Target date is required", 400));

  const customer = await Customer.findById(id).populate(
    "subscription.packageId",
  );
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  // Only active customers can extend
  // if (customer.subscription.status !== "active") {
  //   return next(
  //     new ErrorResponse("Only active subscriptions can be extended", 400),
  //   );
  // }

  const currentExpiry = new Date(customer.subscription.expiresAt);
  const target = new Date(targetDate);
  if (isNaN(target.getTime()))
    return next(new ErrorResponse("Invalid target date", 400));
  if (target <= currentExpiry) {
    return next(
      new ErrorResponse("Target date must be after current expiry date", 400),
    );
  }

  const packageDoc = customer.subscription.packageId;
  const dailyRate = calculateDailyRate(packageDoc);
  const daysToAdd = Math.ceil((target - currentExpiry) / (1000 * 60 * 60 * 24));
  const proratedAmount = dailyRate * daysToAdd;
  const convenienceFee = 200;
  const total = Math.ceil(proratedAmount + convenienceFee);
  const balance = customer.billing?.balance || 0;
  const hasEnoughBalance = balance >= total;

  res.json({
    success: true,
    data: {
      currentExpiry: currentExpiry.toISOString(),
      targetExpiry: target.toISOString(),
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
 * @desc    Move expiry date forward (deduct from wallet)
 * @route   POST /api/customers/:id/move-expiry
 * @access  Private (Customer portal or admin)
 */
exports.moveExpiry = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { targetDate } = req.body;
  if (!targetDate)
    return next(new ErrorResponse("Target date is required", 400));

  const customer = await Customer.findById(id).populate(
    "subscription.packageId",
  );
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  if (customer.isChild && customer.shared.expiryWithParent) {
    return next(new ErrorResponse('This is a child account and shares expiry with parent.', 400));
  }



  const oldStatus = customer.subscription.status;

  if (oldStatus === "suspended") {
    return next(new ErrorResponse('Account paused, First resume to continue.', 400));
  }

  if (customer.subscription.status !== "active") {
    return next(
      new ErrorResponse("Only active subscriptions can be extended", 400),
    );
  }

  const currentExpiry = new Date(customer.subscription.expiresAt);
  const target = new Date(targetDate);
  // target.setHours(target.getHours() - 3);
  if (isNaN(target.getTime()))
    return next(new ErrorResponse("Invalid target date", 400));
  if (target <= currentExpiry) {
    return next(
      new ErrorResponse("Target date must be after current expiry date", 400),
    );
  }

  const packageDoc = customer.subscription.packageId;
  const dailyRate = calculateDailyRate(packageDoc);
  const daysToAdd = Math.ceil((target - currentExpiry) / (1000 * 60 * 60 * 24));
  const proratedAmount = Math.ceil(dailyRate * daysToAdd);
  const convenienceFee = 200;
  const total = proratedAmount + convenienceFee;
  const balance = customer.billing?.balance || 0;

  if (balance < total) {
    return next(
      new ErrorResponse(`Insufficient balance. Need KES ${total}.`, 400),
    );
  }

  // Deduct from wallet
  customer.billing.balance = balance - total;
  // Update expiry date
  customer.subscription.expiresAt = target;
  // Add note
  customer.notes.push({
    note: `Expiry moved forward from ${currentExpiry.toISOString()} to ${target.toISOString()} (cost: KES ${total})`,
    addedBy: req.user?._id || req.customerId || "system",
    addedAt: new Date(),
  });
  await customer.save();

  // Propagate to children that share expiry
if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
  await propagateToChildren(customer, { newExpiry: customer.subscription.expiresAt, radiusAction: 'enable' });
}

  const transaction = await Transaction.create({
    type: "PRORATED_MOVE",
    customerType: "pppoe", // or could be hotspot, but we handle generically
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: customer.regionCode,
    siteId: customer.siteId,
    amount: `-${total}`,  // negative
    description: `Expiry date prorated`,
    paymentMethod: "wallet", 
    status: "completed",
    metadata: {
      
      category: "Expiry date prorated",
      deductedBy: req.session.userId,
    },
  });

  await transaction.save();


  const timeOnly = `${target.getHours().toString().padStart(2, "0")}:${target.getMinutes().toString().padStart(2, "0")}`;
  const mobileSasaService = require("../services/mobileSasaService");
  const smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your subscription expiry date has been moved to ${target.toDateString()} at ${timeOnly}.  Thankyou.`;

  const smsResult = await mobileSasaService.sendSingle(
    customer.phoneNumber,
    smsMessage,
  );

  if (smsResult.success) {
    console.log("A message of expiry movement confirmation was not sent.");
  } else {
    console.log("A message of expiry movement confirmation was sent.");
  }

  // Log the transaction
  await SystemLog.create({
    eventType: "expiry_moved",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Expiry moved forward by ${daysToAdd} days for ${customer.accountId}`,
    details: {
      previousExpiry: currentExpiry,
      newExpiry: target,
      daysAdded: daysToAdd,
      cost: total,
      deductedFromBalance: total,
    },
    triggeredBy: req.user?._id || req.customerId,
    success: true,
  });

  res.json({
    success: true,
    message: `Expiry date moved to ${target.toISOString()}. KES ${total} deducted from wallet.`,
    data: {
      newExpiry: target.toISOString(),
      newBalance: customer.billing.balance,
    },
  });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse Mikrotik uptime string to seconds
 * Examples: "2w3d4h30m15s", "1d5h", "3h30m"
 */
function parseUptime(uptimeStr) {
  if (!uptimeStr) return 0;

  let totalSeconds = 0;

  // Parse weeks
  const weeksMatch = uptimeStr.match(/(\d+)w/);
  if (weeksMatch) totalSeconds += parseInt(weeksMatch[1]) * 7 * 24 * 60 * 60;

  // Parse days
  const daysMatch = uptimeStr.match(/(\d+)d/);
  if (daysMatch) totalSeconds += parseInt(daysMatch[1]) * 24 * 60 * 60;

  // Parse hours
  const hoursMatch = uptimeStr.match(/(\d+)h/);
  if (hoursMatch) totalSeconds += parseInt(hoursMatch[1]) * 60 * 60;

  // Parse minutes
  const minutesMatch = uptimeStr.match(/(\d+)m/);
  if (minutesMatch) totalSeconds += parseInt(minutesMatch[1]) * 60;

  // Parse seconds
  const secondsMatch = uptimeStr.match(/(\d+)s/);
  if (secondsMatch) totalSeconds += parseInt(secondsMatch[1]);

  return totalSeconds;
}

/**
 * Format seconds into human-readable duration
 */
function formatDuration(seconds) {
  const weeks = Math.floor(seconds / (7 * 24 * 60 * 60));
  seconds %= 7 * 24 * 60 * 60;

  const days = Math.floor(seconds / (24 * 60 * 60));
  seconds %= 24 * 60 * 60;

  const hours = Math.floor(seconds / (60 * 60));
  seconds %= 60 * 60;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  const parts = [];
  if (weeks > 0) parts.push(`${weeks}w`);
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join("");
}

/**
 * Helper: Calculate daily rate for a package (in KES per day)
 */
function calculateDailyRate(packageDoc) {
  let days = packageDoc.period;
  if (packageDoc.periodUnit === "m") {
    days = packageDoc.period / (24 * 60); // minutes to days
  } else if (packageDoc.periodUnit === "h") {
    days = packageDoc.period / 24; // hours to days
  }
  // For 'd', days = period (already days)
  if (days <= 0) days = 30; // fallback to 30 days if invalid
  return packageDoc.price / days;
}


/**
 * Apply burst speed upgrade for a customer
 * @route POST /api/customers/:id/burst
 * @body { uploadSpeed, downloadSpeed, durationHours }
 */
exports.applyBurst = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { uploadSpeed, downloadSpeed, durationHours } = req.body;
  console.log(req.body)

  if (!uploadSpeed || !downloadSpeed || !durationHours || durationHours <= 0) {
    return next(new ErrorResponse('Upload speed, download speed, and duration (>0) required', 400));
  }

  const customer = await Customer.findById(id).populate('subscription.packageId');
  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  if (customer.burst?.enabled) {
    return next(new ErrorResponse('Customer already has an active burst. Remove existing burst first.', 400));
  }

  // Get current package group name
  const packageDoc = customer.subscription.packageId;
  const originalGroup = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();

  const burstGroupName = `BURST_${customer.pppoe.username}_${Date.now()}`;
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

  // Apply RADIUS override
  const radiusService = require('../services/radiusService');
  const result = await radiusService.applyBurstOverride(
    customer.pppoe.username,
    originalGroup,
    uploadSpeed,
    downloadSpeed,
    burstGroupName
  );

  if (!result.success) {
    return next(new ErrorResponse(`Failed to apply burst: ${result.error}`, 500));
  }

  // Store burst info in customer
  customer.burst = {
    enabled: true,
    originalGroup,
    burstGroup: burstGroupName,
    downloadSpeed,
    uploadSpeed,
    expiresAt,
    startedAt: new Date()
  };

  customer.notes.push({
    note: `Customer speed boosted to D:${downloadSpeed} and U:${uploadSpeed} until ${expiresAt}`,
    addedBy: req.user?._id || req.customerId || "system",
    addedAt: new Date(),
  });
  await customer.save();

  await SystemLog.create({
    eventType: 'burst_applied',
    severity: 'info',
    regionCode: customer.regionCode,
    entityType: 'customer',
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Burst speed applied for ${durationHours} hours: ${uploadSpeed}/${downloadSpeed} Mbps`,
    details: { uploadSpeed, downloadSpeed, durationHours, expiresAt },
    triggeredBy: req.session.userId,
    success: true
  });

  res.json({
    success: true,
    message: `Burst speed applied. Will expire at ${expiresAt.toISOString()}`,
    data: { burst: customer.burst }
  });
});

/**
 * Remove active burst from customer
 * @route DELETE /api/customers/:id/burst
 */
exports.removeBurst = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const customer = await Customer.findById(id);
  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  if (!customer.burst?.enabled) {
    return next(new ErrorResponse('No active burst to remove', 400));
  }

  const radiusService = require('../services/radiusService');
  const result = await radiusService.removeBurstOverride(
    customer.pppoe.username,
    customer.burst.originalGroup,
    customer.burst.burstGroup
  );

  if (!result.success) {
    return next(new ErrorResponse(`Failed to remove burst: ${result.error}`, 500));
  }

  // Clear burst fields
  customer.burst = { enabled: false };

  customer.notes.push({
    note: `Customer speed restored to original package.`,
    addedBy: req.user?._id || req.customerId || "system",
    addedAt: new Date(),
  });


  await customer.save();

  await SystemLog.create({
    eventType: 'burst_removed',
    severity: 'info',
    regionCode: customer.regionCode,
    entityType: 'customer',
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Burst speed removed`,
    triggeredBy: req.session.userId,
    success: true
  });

  res.json({ success: true, message: 'Burst removed, customer restored to original package' });
});

/**
 * Admin override: change expiry date without prorating or billing
 * @route PUT /api/customers/:id/override-expiry
 * @body { newExpiryDate }
 */
exports.overrideExpiry = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { newExpiryDate } = req.body;
  if (!newExpiryDate) return next(new ErrorResponse('newExpiryDate required', 400));

  const customer = await Customer.findById(id).populate('subscription.packageId');
  if (!customer) return next(new ErrorResponse('Customer not found', 404));
  if (customer.subscription.status === 'suspended') return next(new ErrorResponse('Subscription paused, first resume it.', 400));

  if(customer.isChild && customer.shared.expiryWithParent){
    return next(new ErrorResponse('This is a child and shares expiry with parent, you can only override from parent.', 400))
  }

  const oldExpiry = customer.subscription.expiresAt;

  // Parse the input date string and set time to 12:00:00 UTC
  let newExpiry = new Date(newExpiryDate);
  // newExpiry.setHours(newExpiry.getHours() - 3);
  if (isNaN(newExpiry.getTime())) return next(new ErrorResponse('Invalid date', 400));

  const now = new Date();
  const wasActive = customer.subscription.status === 'active' ;
  const willBeActive = newExpiry > now;

  // Update MongoDB expiry first
  customer.subscription.expiresAt = newExpiry;

  let radiusChanged = false;
  let disconnectNeeded = false;
  const radiusService = require('../services/radiusService');
  const packageDoc = customer.subscription.packageId;
  const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();

  // Handle RADIUS state change only if needed
  if (willBeActive && !wasActive) {
    // Reactivate: enable RADIUS account
    customer.subscription.status = 'active';
    if (!customer.subscription.activatedAt) customer.subscription.activatedAt = now;
    console.log(`🔄 [overrideExpiry] Reactivating ${customer.accountId} -> enable RADIUS`);
    const radResult = await radiusService.enableAccount(customer.pppoe.username, groupName);
    if (!radResult.success) {
      console.error(`❌ RADIUS enable failed: ${radResult.error}`);
    } else {
      radiusChanged = true;
      disconnectNeeded = true;
    }
  } else if (!willBeActive && wasActive) {
    // Deactivate: disable RADIUS account
    const customerPackage = await Package.findById(customer.subscription.packageId);

    if(customerPackage){
      const hasBalance = customer.billing.balance >= customerPackage.price;

      if(hasBalance){
        customer.waitingForSession = true;
        
      }
    }
    customer.subscription.status = 'expired';
    console.log(`🔄 [overrideExpiry] Deactivating ${customer.accountId} -> disable RADIUS`);
    const radResult = await radiusService.disableAccount(customer.pppoe.username);
    await radiusService.addPendingActivation(customer.pppoe.username); 
    if (!radResult.success) {
      console.error(`❌ RADIUS disable failed: ${radResult.error}`);
    } else {
      radiusChanged = true;
      disconnectNeeded = true;
    }
  } else {
    // No status change
    const customerPackage = await Package.findById(customer.subscription.packageId);

    if(customerPackage){
      const hasBalance = customer.billing.balance >= customerPackage.price;

      if(hasBalance){
        customer.waitingForSession = true;
        await customer.save();
      }
    }
    console.log(`ℹ️ [overrideExpiry] No status change for ${customer.accountId}; expiry updated only.`);
  }

  customer.notes.push({
    note: `Customer expiry OVERRIDEN to ${newExpiry}.`,
    addedBy: req.user?._id || req.customerId || "system",
    addedAt: new Date(),
  });

  // Save MongoDB changes
  await customer.save();

  // Propagate to children
if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
  await propagateToChildren(customer, {
    newExpiry: customer.subscription.expiresAt,
    newStatus: customer.subscription.status,
    radiusAction: customer.subscription.status === 'active' ? 'enable' : 'disable'
  });
}

  // If RADIUS state changed, kill the active session to force re-authentication
  if (disconnectNeeded) {
    console.log(`🔌 [overrideExpiry] Disconnecting active session for ${customer.pppoe.username}`);
    const killResult = await radiusService.killUserSession(customer.pppoe.username);
    if (!killResult.success) {
      console.error(`⚠️ Session disconnect failed: ${killResult.error}. User may need to reconnect manually.`);
    } else {
      console.log(`✅ Session disconnected successfully`);
    }
  }

  // Log the action
  await SystemLog.create({
    eventType: 'expiry_override',
    severity: 'info',
    regionCode: customer.regionCode,
    entityType: 'customer',
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Expiry overridden: ${oldExpiry.toISOString()} → ${newExpiry.toISOString()}. Status: ${customer.subscription.status}. RADIUS changed: ${radiusChanged}, disconnected: ${disconnectNeeded}`,
    details: { oldExpiry, newExpiry, wasActive, willBeActive, radiusChanged, disconnectNeeded },
    triggeredBy: req.session.userId,
    success: true
  });

  res.json({
    success: true,
    message: `Expiry date updated. Customer is now ${customer.subscription.status}.`,
    data: { expiresAt: newExpiry, status: customer.subscription.status }
  });
});
/**
 * Extend expiry by a few days (free, recorded to deduct later)
 * @route POST /api/customers/:id/extend-expiry
 * @body { days } - max 3 days
 */
exports.extendExpiry = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { days } = req.body;
  if (!days || days <= 0 || days > 3) {
    return next(new ErrorResponse('Days must be between 1 and 3', 400));
  }

  const customer = await Customer.findById(id).populate('subscription.packageId');
  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  if (customer.isChild && customer.shared?.expiryWithParent) {
    return next(new ErrorResponse("Cannot extend expiry on a child account that shares expiry with parent.", 400));
  }

  const oldStatus = customer.subscription.status;

  if (oldStatus === "expired") {
    return next(new ErrorResponse('Only active accounts can receive an extension.', 400));
  }

  if (oldStatus === "suspended") {
    return next(new ErrorResponse('Account paused, First resume to continue.', 400));
  }


  const oldExpiry = customer.subscription.expiresAt;
  const now = new Date();
  const wasExpired = oldStatus === 'expired';

  // Record free extension days (to be deducted on next renewal)
  customer.freeExtensionDays = (customer.freeExtensionDays || 0) + days;
  
  // Extend expiry
  let baseExpiry = oldExpiry;
  if (wasExpired && oldExpiry < now) {
    // If already expired, start counting from now
    baseExpiry = now;
  }
  const newExpiry = new Date(baseExpiry.getTime() + days * 24 * 60 * 60 * 1000);
  if(newExpiry <= customer.subscription.expiresAt){
    return next(new ErrorResponse('Extension date must be after current expiry date', 400));

  }



  customer.subscription.expiresAt = newExpiry;

  // If the customer was expired, reactivate
  const willBeActive = newExpiry > now;
  if (willBeActive && wasExpired) {
    customer.subscription.status = 'active';
    if (!customer.subscription.activatedAt) customer.subscription.activatedAt = now;
  } else if (!willBeActive && !wasExpired) {
    // Should not happen because days > 0 and newExpiry > now always, but keep check
    customer.subscription.status = 'expired';
  }

  customer.notes.push({
    note: `Customer extended by a ${days} days grace period, new expiry is ${newExpiry}`,
    addedBy: req.user?._id || req.customerId || "system",
    addedAt: new Date(),
  });

  await customer.save();

  // Propagate to children
if (customer.sharedExpiry && customer.sharedExpiry.length > 0) {
  await propagateToChildren(customer, {
    newExpiry: customer.subscription.expiresAt,
    newStatus: customer.subscription.status,
    radiusAction: customer.subscription.status === 'active' ? 'enable' : 'disable'
  });
}

  // RADIUS update if status changed
  const radiusService = require('../services/radiusService');
  const packageDoc = customer.subscription.packageId;
  if (wasExpired && customer.subscription.status === 'active') {
    // Reactivate RADIUS
    const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
    const radiusResult = await radiusService.enableAccount(customer.pppoe.username, groupName);
    if (!radiusResult.success) {
      console.error('RADIUS enable failed on extension:', radiusResult.error);
    }
  } else if (!wasExpired && customer.subscription.status === 'expired') {
    // Disable RADIUS
    const radiusResult = await radiusService.disableAccount(customer.pppoe.username);
    if (!radiusResult.success) {
      console.error('RADIUS disable failed on extension:', radiusResult.error);
    }
  }

  await SystemLog.create({
    eventType: 'expiry_extension',
    severity: 'info',
    regionCode: customer.regionCode,
    entityType: 'customer',
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Expiry extended by ${days} day(s) (free). New balance: ${customer.freeExtensionDays} day(s) to deduct later. Status: ${customer.subscription.status}.`,
    details: {
      daysAdded: days,
      totalFreeDaysAccumulated: customer.freeExtensionDays,
      oldExpiry,
      newExpiry,
      oldStatus,
      newStatus: customer.subscription.status
    },
    triggeredBy: req.session.userId,
    success: true
  });

  res.json({
    success: true,
    message: `Expiry extended by ${days} day(s). Total free days accumulated: ${customer.freeExtensionDays}. Customer is now ${customer.subscription.status}.`,
    data: {
      expiresAt: newExpiry,
      freeExtensionDays: customer.freeExtensionDays,
      status: customer.subscription.status
    }
  });
});



// @desc    Get customers with positive wallet balance (> 0)
// @route   GET /api/customers/positive-balance
// @access  Private (Admin or manager)
exports.getCustomersPositiveBalance = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 15,
    search,
    sortBy = "balance",
    sortOrder = "desc",
  } = req.query;

  const query = { ...req.regionFilter, isActive: true, "billing.balance": { $gt: 0 } };

  if (search) {
    query.$or = [
      { accountId: { $regex: search, $options: "i" } },
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search, $options: "i" } },
    ];
  }

  const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

  const customers = await Customer.find(query)
    .populate("subscription.packageId", "packageName price")
    .populate("siteId", "name regionCode")
    .select("accountId firstName lastName phoneNumber billing.balance subscription.status subscription.packageId siteId")
    .sort(sort)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const total = await Customer.countDocuments(query);

  res.status(200).json({
    success: true,
    message: "Customers with positive balance retrieved",
    data: {
      customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get customers with negative wallet balance (< 0)
// @route   GET /api/customers/negative-balance
// @access  Private (Admin or manager)
exports.getCustomersNegativeBalance = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 15,
    search,
    sortBy = "balance",
    sortOrder = "asc",   // show most negative first
  } = req.query;

  const query = { ...req.regionFilter, isActive: true, "billing.balance": { $lt: 0 } };

  if (search) {
    query.$or = [
      { accountId: { $regex: search, $options: "i" } },
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search, $options: "i" } },
    ];
  }

  const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

  const customers = await Customer.find(query)
    .populate("subscription.packageId", "packageName price")
    .populate("siteId", "name regionCode")
    .select("accountId firstName lastName phoneNumber billing.balance subscription.status subscription.packageId siteId")
    .sort(sort)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const total = await Customer.countDocuments(query);

  res.status(200).json({
    success: true,
    message: "Customers with negative balance retrieved",
    data: {
      customers,
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
 * @desc    Add expense (deduct from wallet) – installation, relocation, etc.
 * @route   POST /api/customers/:id/expense
 * @access  Private (Admin only)
 */
exports.addExpense = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { amount, reason, category } = req.body;

  if (!amount || amount <= 0) {
    return next(new ErrorResponse("Positive amount is required", 400));
  }
  if (!reason) {
    return next(new ErrorResponse("Reason for expense is required", 400));
  }

  const customer = await Customer.findById(id);
  if (!customer) return next(new ErrorResponse("Customer not found", 404));

  // Region access check
  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  const oldBalance = customer.billing?.balance || 0;
  const newBalance = oldBalance - amount;

  // 1. Create Transaction (negative, type EXPENSE)
  const transaction = await Transaction.create({
    type: "EXPENSE",
    customerType: "pppoe", // or could be hotspot, but we handle generically
    customerId: customer._id,
    accountId: customer.accountId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    regionCode: customer.regionCode,
    siteId: customer.siteId,
    amount: -amount,  // negative
    description: `${category ? category.toUpperCase() : "EXPENSE"}: ${reason}`,
    paymentMethod: "wallet", 
    status: "completed",
    metadata: {
      reason,
      category: category || "other",
      deductedBy: req.session.userId,
    },
  });

  // 2. Update customer balance
  if (!customer.billing) customer.billing = {};
  customer.billing.balance = newBalance;
  await customer.save();

  // 3. Add note
  customer.notes.push({
    note: `Expense: ${reason} (${category || "other"}) - KES ${amount}. Balance: KES ${oldBalance} → KES ${newBalance}`,
    addedBy: req.session.userId,
    addedAt: new Date(),
  });
  await customer.save();

  // 4. System log
  await SystemLog.create({
    eventType: "expense_deducted",
    severity: "info",
    regionCode: customer.regionCode,
    entityType: "customer",
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Expense of KES ${amount} deducted from wallet. Reason: ${reason}`,
    details: { amount, oldBalance, newBalance, reason, category },
    triggeredBy: req.session.userId,
    success: true,
    relatedTransactionId: transaction._id,
  });

  res.status(200).json({
    success: true,
    message: `KES ${amount} deducted from ${customer.accountId} for ${reason}`,
    data: {
      customerId: customer._id,
      accountId: customer.accountId,
      newBalance,
      transactionId: transaction._id,
    },
  });
});

exports.getSyncJobStatus = asyncHandler(async (req, res, next) => {  // ← add 'next'
  const job = await RadiusSyncJob.findById(req.params.jobId);
  if (!job) return next(new ErrorResponse('Job not found', 404));
  res.json({
    success: true,
    data: {
      status: job.status,
      total: job.total,
      processed: job.processed,
      created: job.created,
      updatedGroup: job.updatedGroup,
      disabled: job.disabled,
      errors: job.errors.slice(0, 100),
      finishedAt: job.finishedAt
    }
  });
});

/**
 * @desc    Sync customers to RADIUS (create missing, update groups, disable expired)
 * @route   POST /api/customers/sync-to-radius
 * @access  Private (Admin only)
 * @body    { dryRun?: boolean, regionCode?: string, fixGroups?: boolean }
 */
exports.syncCustomersToRadius = asyncHandler(async (req, res, next) => {
  const { dryRun = false, regionCode, fixGroups = true } = req.body;

  // Build query to count customers (don't load them all yet)
  let query = {};
  if (regionCode) query.regionCode = regionCode;
  else if (req.regionFilter?.regionCode) query.regionCode = req.regionFilter.regionCode;

  const total = await Customer.countDocuments(query);
  if (total === 0) {
    return res.status(200).json({ success: true, message: 'No customers to sync', data: { total: 0 } });
  }

  // Create a job record
  const job = await RadiusSyncJob.create({
    status: 'pending',
    total,
    dryRun,
    regionCode: regionCode || req.regionFilter?.regionCode || 'all',
    fixGroups,
    triggeredBy: req.session.userId,
  });

  // Start background processing (non-blocking)
  const { processSyncJobInBackground } = require("../services/radiusSyncWorker");
  processSyncJobInBackground(job._id, query, { dryRun, fixGroups });

  res.status(202).json({
    success: true,
    message: 'Sync job started. Use /api/radius-sync/jobs/:jobId to check status.',
    data: { jobId: job._id, total }
  });
});

// @desc    Bulk import customers from JSON (preserve all fields)
// @route   POST /api/customers/bulk-import
// @access  Private (admin or super admin)
exports.bulkImportCustomers = asyncHandler(async (req, res, next) => {
  const customersData = req.body;
  if (!Array.isArray(customersData) || customersData.length === 0) {
    return next(new ErrorResponse('Request body must be a non-empty array of customers', 400));
  }

  const results = {
    total: customersData.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  const radiusService = require('../services/radiusService');

  for (let i = 0; i < customersData.length; i++) {
    const raw = customersData[i];
    let errorMsg = null;

    try {
      // 1. Required fields
      const requiredFields = {
        accountId: raw.accountId,
        firstName: raw.firstName,
        lastName: raw.lastName,
        phoneNumber: raw.phoneNumber,
        siteId: raw.siteId,
        city: raw.city,
        subLocation: raw.subLocation,
        localArea: raw.localArea,
        pppoeUsername: raw.pppoe?.username,
        pppoePassword: raw.pppoe?.password,
        packageId: raw.subscription?.packageId,
      };
      
      for (const [field, value] of Object.entries(requiredFields)) {
        if (!value) throw new Error(`Missing required field: ${field}`);
      }

      const packageId = raw.subscription.packageId;

      // 2. Region filter check
      if (req.regionFilter.regionCode && raw.regionCode !== req.regionFilter.regionCode) {
        throw new Error(`Region mismatch: customer region ${raw.regionCode} not allowed`);
      }

      // 3. Site validation
      const site = await Site.findById(raw.siteId);
      if (!site) throw new Error(`Site not found: ${raw.siteId}`);
      if (req.regionFilter.regionCode && site.regionCode !== req.regionFilter.regionCode) {
        throw new Error(`Site ${raw.siteId} not in allowed region`);
      }

      // 4. Package validation
      const packageDoc = await Package.findById(packageId);
      if (!packageDoc) throw new Error(`Package not found: ${packageId}`);
      if (packageDoc.siteId.toString() !== raw.siteId.toString()) {
        throw new Error(`Package ${packageId} does not belong to site ${raw.siteId}`);
      }
      if (packageDoc.packageType !== 'ppp') {
        throw new Error(`Package ${packageId} is not PPPoE type`);
      }

      // 5. Detect if this is a child account (accountId contains a hyphen)
      const isChild = raw.isChild || (raw.accountId && raw.accountId.includes('-'));
      let parentAccountId = null;
      let parentCustomer = null;

      if (isChild) {
        // Extract parent account ID: everything before the last hyphen
        const lastHyphenIndex = raw.accountId.lastIndexOf('-');
        if (lastHyphenIndex === -1) {
          throw new Error(`Child account ${raw.accountId} must contain a hyphen (e.g., SKN1234-01)`);
        }
        parentAccountId = raw.accountId.substring(0, lastHyphenIndex);
        parentCustomer = await Customer.findOne({ accountId: parentAccountId, isChild: false });
        if (!parentCustomer) {
          throw new Error(`Parent account ${parentAccountId} not found for child ${raw.accountId}`);
        }
        // Inherit region and site from parent if not explicitly provided (optional but safe)
        if (!raw.regionCode) raw.regionCode = parentCustomer.regionCode;
        if (!raw.siteId) raw.siteId = parentCustomer.siteId.toString();
        // For child accounts, phone number does NOT have to be unique (skip all checks)
      }

      // 6. Account ID uniqueness (check across both primary and child, but child IDs are unique by definition)
      const existingByAccount = await Customer.findOne({ accountId: raw.accountId });
      if (existingByAccount) {
        throw new Error(`Account ID ${raw.accountId} already exists`);
      }

      // 7. Phone number uniqueness – only for primary accounts
      const formattedPhone = formatPhoneNumber(raw.phoneNumber);
      if (!isChild) {
        const existingPhone = await Customer.findOne({
          phoneNumber: formattedPhone,
          regionCode: site.regionCode,
          isChild: false
        });
        if (existingPhone) {
          throw new Error(`Phone number ${formattedPhone} already exists in region ${site.regionCode}`);
        }

        // Alternate phone if present
        let formattedAlt = null;
        if (raw.alternatePhoneNumber) {
          formattedAlt = formatPhoneNumber(raw.alternatePhoneNumber);
          const existingAlt = await Customer.findOne({
            phoneNumber: formattedAlt,
            regionCode: site.regionCode,
            isChild: false
          });
          if (existingAlt) {
            throw new Error(`Alternate phone ${formattedAlt} already registered in region ${site.regionCode}`);
          }
        }
      }

      // 8. Prepare customer data
      const now = new Date();
      const customerData = {
        accountId: raw.accountId,
        regionCode: raw.regionCode || site.regionCode,
        siteId: raw.siteId,
        firstName: raw.firstName,
        lastName: raw.lastName,
        email: raw.email || '',
        phoneNumber: formattedPhone,
        alternatePhoneNumber: raw.alternatePhoneNumber ? formatPhoneNumber(raw.alternatePhoneNumber) : undefined,
        city: raw.city,
        subLocation: raw.subLocation,
        localArea: raw.localArea,
        location: raw.location || {},
        isChild: isChild,
        parentAccount: isChild ? parentCustomer._id : undefined,
        pppoe: {
          username: raw.pppoe.username,
          password: raw.pppoe.password,
          siteIp: raw.pppoe.siteIp || null,
          staticIp: raw.pppoe.staticIp || null,
          macAddress: raw.pppoe.macAddress || null,
        },
        nasIp: raw.nasIp || null,
        cpe: {
          serialNumber: raw.cpe?.serialNumber || '',
          macAddress: raw.cpe?.macAddress || '',
          model: raw.cpe?.model || '',
          wifiName: raw.cpe?.wifiName || '',
          wifiPassword: raw.cpe?.wifiPassword || '',
        },
        subscription: {
          packageId: packageId,
          status: raw.subscription.status || 'active',
          activatedAt: raw.subscription.activatedAt ? new Date(raw.subscription.activatedAt) : now,
          expiresAt: raw.subscription.expiresAt ? new Date(raw.subscription.expiresAt) : calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit),
          autoRenew: raw.subscription.autoRenew ?? true,
          pausedAt: raw.subscription.pausedAt ? new Date(raw.subscription.pausedAt) : null,
          pausedPeriod: raw.subscription.pausedPeriod || 0,
        },
        suspensionSource: raw.suspensionSource || null,
        fupEnabled: (raw.fupEnabled !== undefined) ? raw.fupEnabled : (packageDoc.fup?.enabled || false),
        burst: raw.burst || { enabled: false },
        freeExtensionDays: raw.freeExtensionDays || 0,
        maxFreeExtensionDays: raw.maxFreeExtensionDays || 3,
        billing: {
          balance: raw.billing?.balance || 0,
          discountEnabled: raw.billing?.discountEnabled || false,
          discountAmount: raw.billing?.discountAmount || 0,
        },
        connectionStatus: raw.connectionStatus || {
          status: 'offline',
          currentIp: null,
          currentMac: null,
          lastChecked: null,
          lastOnline: null,
          lastOffline: null,
        },
        isActive: raw.isActive !== undefined ? raw.isActive : true,
        paymentCounter: raw.paymentCounter || 0,
        renewals: raw.renewals || [],
        notes: [
          ...(raw.notes || []),
          {
            note: isChild 
              ? `Imported child account via bulk upload from JSON (parent: ${parentAccountId})`
              : `Imported via bulk upload from JSON`,
            addedBy: req.user?._id || req.session.userId,
            createdAt: now,
          },
        ],
        createdBy: raw.createdBy || req.user?._id || req.session.userId,
        createdAt: raw.createdAt ? new Date(raw.createdAt) : now,
        updatedAt: now,
      };

      const customer = await Customer.create(customerData);

      // 9. Update site coverage (non-critical)
      try {
        await site.addCityIfNotExists(customer.city);
        await site.addSubLocationIfNotExists(customer.city, customer.subLocation);
        await site.addLocalAreaIfNotExists(customer.city, customer.subLocation, customer.localArea);
      } catch (err) {
        console.warn(`Site coverage update failed for ${customer.accountId}:`, err.message);
      }

      // 10. Create RADIUS account (for primary accounts only? Child accounts may also need RADIUS)
      //    Even child accounts need PPPoE credentials, so we always create.
      const radiusResult = await radiusService.createAccount(customer, packageDoc);
      if (!radiusResult.success) {
        console.error(`RADIUS creation failed for ${customer.accountId}: ${radiusResult.error}`);
        results.errors.push({
          index: i,
          accountId: customer.accountId,
          error: `Customer created but RADIUS failed: ${radiusResult.error}`,
        });
      } else {
        const billingStart = customer.subscription.activatedAt;
        await radiusService.setBillingCycleStart(customer.pppoe.username, billingStart);
      }

      // 11. System log
      await SystemLog.create({
        eventType: 'admin_action',
        severity: 'info',
        regionCode: customer.regionCode,
        entityType: 'customer',
        entityId: customer._id,
        accountId: customer.accountId,
        message: `Bulk import: ${isChild ? 'child' : 'primary'} customer ${customer.accountId} created${isChild ? ` (parent: ${parentAccountId})` : ''}`,
        triggeredBy: req.user?._id || req.session.userId,
        success: true,
      });

      results.succeeded++;
    } catch (err) {
      errorMsg = err.message;
      results.failed++;
      results.errors.push({
        index: i,
        accountId: raw.accountId || 'unknown',
        error: errorMsg,
      });
    }
  }

  res.status(200).json({
    success: true,
    message: `Bulk import completed: ${results.succeeded} succeeded, ${results.failed} failed`,
    data: results,
  });
});


// ticketController.js or wherever you have getTicketsByCustomer
exports.getTicketsByCustomer = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 5 } = req.query;
  const customerId = req.params.id;

 

  if (!customerId) {
    return next(new ErrorResponse("customerId is required", 400));
  }

  const parsedPage = parseInt(page, 10);
  const parsedLimit = parseInt(limit, 10);
  const skip = (parsedPage - 1) * parsedLimit;

  const filter = { customerId };

  // Get total count for pagination
  const total = await Ticket.countDocuments(filter);

  // Fetch paginated tickets
  const tickets = await Ticket.find(filter)
    .populate("assignedTo", "firstName lastName")
    .populate("createdBy.userId", "firstName lastName")
    .populate("updates.addedBy", "firstName lastName")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parsedLimit);

  res.status(200).json({
    success: true,
    data: {
      tickets,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit),
      },
    },
  });
});


/**
 * @desc    Sync a single customer to RADIUS (create, update group, fix FUP)
 * @route   POST /api/customers/:id/sync-to-radius
 * @access  Private (Admin only)
 * @body    { dryRun?: boolean, fixGroups?: boolean }
 */
// ─── SIMPLIFIED SYNC TO RADIUS ───────────────────────────────────────────────
// POST /api/customers/:id/sync-radius
// Body: none (or optional, but we ignore)
// ------------------------------------------------------------------------------
exports.syncSingleCustomerToRadius = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // 1. Find customer with package details
  const customer = await Customer.findById(id).populate('subscription.packageId');
  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  // Region access check (if you have region filtering)
  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this customer', 403));
  }

  const username = customer.pppoe?.username;
  if (!username) {
    return next(new ErrorResponse('No PPPoE username found for this customer', 400));
  }

  // 2. Determine if account should be active
  const now = new Date();
  const sub = customer.subscription;
  const isActive = sub?.status === 'active' && sub?.expiresAt && new Date(sub.expiresAt) > now;

  // 3. Get the group name (if active)
  let groupName = null;
  if (isActive && sub?.packageId) {
    // Convert package name to RADIUS group name (uppercase, underscores)
    groupName = sub.packageId.packageName.replace(/\s+/g, '_').toUpperCase();
  }

  // 4. Call the appropriate RADIUS method
  const radiusService = require('../services/radiusService');
  let result;

  if (isActive && groupName) {
    // Enable account – this will remove DISABLED and set the correct group
    result = await radiusService.enableAccount(username, groupName);
  } else {
    // Disable account – this will set DISABLED (priority 10) while preserving the original group
    result = await radiusService.disableAccount(username);
  }

  if (!result.success) {
    // Log error and return
    await SystemLog.create({
      eventType: 'radius_sync_single',
      severity: 'error',
      regionCode: customer.regionCode,
      entityType: 'customer',
      entityId: customer._id,
      accountId: customer.accountId,
      message: `RADIUS sync failed for ${username}: ${result.error || 'Unknown error'}`,
      success: false,
    });
    return next(new ErrorResponse(`RADIUS sync failed: ${result.error || 'Unknown error'}`, 500));
  }

  // 5. Log success
  await SystemLog.create({
    eventType: 'radius_sync_single',
    severity: 'info',
    regionCode: customer.regionCode,
    entityType: 'customer',
    entityId: customer._id,
    accountId: customer.accountId,
    message: `RADIUS sync completed: ${username} → ${isActive ? 'ENABLED' : 'DISABLED'}`,
    success: true,
  });

  // 6. Optionally add a note to the customer
  customer.notes.push({
    note: `RADIUS account ${isActive ? 'enabled' : 'disabled'} via sync.`,
    addedBy: req.user?._id || 'system',
    addedAt: new Date(),
  });
  await customer.save();

  res.status(200).json({
    success: true,
    message: `Customer ${username} ${isActive ? 'enabled' : 'disabled'} in RADIUS.`,
    data: {
      username,
      status: isActive ? 'active' : 'inactive',
      groupName: isActive ? groupName : 'DISABLED',
    },
  });
});


// @desc    Add a retention/customer care record
// @route   POST /api/customers/:id/retention
// @access  Private (Admin only)
exports.addRetentionRecord = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const customer = await Customer.findById(id);
  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  // Region access check
  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied', 403));
  }

  // Extract retention data from request body
  const {
    callDate,
    callStatus,
    failureReason,
    callType,
    serviceSatisfaction,
    retentionOutcome,
    routerCollection,
    description,
    accountAction,
    actionDate,
  } = req.body;

  // Build retention object
  const retentionData = {
    callDate: callDate || new Date(),
    calledBy: req.user?._id || req.session?.userId,
    callStatus,
  };

  // Add conditional fields based on callStatus and callType
  if (callStatus === 'failed') {
    if (!failureReason) return next(new ErrorResponse('failureReason is required when callStatus is "failed"', 400));
    retentionData.failureReason = failureReason;
    // description is optional for failed calls
    if (description) retentionData.description = description;
  } else if (callStatus === 'successful') {
    if (!callType) return next(new ErrorResponse('callType is required when callStatus is "successful"', 400));
    retentionData.callType = callType;
    if (!description) return next(new ErrorResponse('description is required for successful calls', 400));
    retentionData.description = description;

    if (callType === 'service_follow_up') {
      if (!serviceSatisfaction) return next(new ErrorResponse('serviceSatisfaction required for service_follow_up', 400));
      retentionData.serviceSatisfaction = serviceSatisfaction;
    } else if (callType === 'retention') {
      if (!retentionOutcome) return next(new ErrorResponse('retentionOutcome required for retention call', 400));
      retentionData.retentionOutcome = retentionOutcome;

      if (retentionOutcome === 'changed_provider') {
        if (!routerCollection || !routerCollection.status) {
          return next(new ErrorResponse('routerCollection.status required when retentionOutcome is "changed_provider"', 400));
        }
        retentionData.routerCollection = {
          status: routerCollection.status,
          scheduledDate: routerCollection.scheduledDate,
          collectedDate: routerCollection.collectedDate,
          collectedBy: routerCollection.collectedBy,
        };
      }
    } else {
      return next(new ErrorResponse('Invalid callType', 400));
    }
  } else {
    return next(new ErrorResponse('callStatus must be "successful" or "failed"', 400));
  }

  // Account action (optional)
  if (accountAction && accountAction !== 'none') {
    if (!actionDate) return next(new ErrorResponse('actionDate required when accountAction is specified', 400));
    retentionData.accountAction = accountAction;
    retentionData.actionDate = actionDate;
  } else {
    retentionData.accountAction = 'none';
  }

  // Push to customer's retention array
  customer.retention.push(retentionData);
  await customer.save();

  // System log
  await SystemLog.create({
    eventType: 'retention_record',
    severity: 'info',
    regionCode: customer.regionCode,
    entityType: 'customer',
    entityId: customer._id,
    accountId: customer.accountId,
    message: `Retention record added for ${customer.accountId}`,
    details: { callStatus, callType, retentionOutcome, accountAction },
    triggeredBy: req.user?._id || req.session?.userId,
    success: true,
  });

  res.status(201).json({
    success: true,
    message: 'Retention record added successfully',
    data: customer.retention[customer.retention.length - 1],
  });
});


// @desc    Get customer retention records
// @route   GET /api/customers/:id/retention
// @access  Private
exports.getCustomerRetention = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const customer = await Customer.findById(id).select('retention regionCode accountId');
  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  // Region access check
  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied', 403));
  }

  // Paginate retention array (reverse chronological)
  const retention = customer.retention || [];
  const sorted = [...retention].sort((a, b) => new Date(b.callDate) - new Date(a.callDate));
  const start = (parseInt(page) - 1) * parseInt(limit);
  const end = start + parseInt(limit);
  const paginated = sorted.slice(start, end);

  // Populate calledBy names (if needed)
  const Admin = require('../models/Admin');
  const User = require('../models/User');
  const userIds = paginated.map(r => r.calledBy).filter(id => id);
  const admins = await Admin.find({ _id: { $in: userIds } }).select('firstName lastName');
  const users = await User.find({ _id: { $in: userIds } }).select('firstName lastName');
  const nameMap = new Map();
  admins.forEach(a => nameMap.set(a._id.toString(), `${a.firstName} ${a.lastName}`));
  users.forEach(u => nameMap.set(u._id.toString(), `${u.firstName} ${u.lastName}`));

  const enriched = paginated.map(r => ({
    ...r.toObject(),
    calledByName: nameMap.get(r.calledBy?.toString()) || 'Unknown',
  }));

  res.status(200).json({
    success: true,
    data: {
      records: enriched,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: retention.length,
        pages: Math.ceil(retention.length / parseInt(limit)),
      },
    },
  });
});



/**
 * @desc    Sync RADIUS accounts for customers where accountId != pppoe.username
 *          Creates/updates a RADIUS user named accountId that mirrors the pppoe.username user.
 * @route   POST /api/customers/sync-mismatched-usernames
 * @access  Private (Admin only)
 * @body    { dryRun?: boolean, regionCode?: string }
 */
exports.syncMismatchedUsernames = asyncHandler(async (req, res, next) => {
  const { dryRun = false, regionCode } = req.body;

  // Build region filter
  let query = {};
  if (regionCode) {
    query.regionCode = regionCode;
  } else if (req.regionFilter?.regionCode) {
    query.regionCode = req.regionFilter.regionCode;
  }

  // Find customers where accountId is NOT equal to pppoe.username
  // Also ensure both fields exist and are strings
  const customers = await Customer.find(query)
    .populate('subscription.packageId')
    .populate('siteId')
    .lean();

  const mismatched = customers.filter(c =>
    c.accountId && c.pppoe?.username &&
    c.accountId !== c.pppoe.username
  );

  console.log(`[syncMismatchedUsernames] Found ${mismatched.length} mismatched customers`);

  const radiusService = require('../services/radiusService');
  const results = {
    totalFound: mismatched.length,
    processed: 0,
    created: 0,
    updated: 0,
    errors: [],
    details: []
  };

  for (const customer of mismatched) {
    const oldUsername = customer.pppoe.username;
    const newUsername = customer.accountId;

    try {
      // Get existing RADIUS data for the pppoe.username
      const connection = await radiusService.getConnection();

      // 1. Password
      const [passwordRows] = await connection.query(
        `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password'`,
        [oldUsername]
      );
      if (passwordRows.length === 0) {
        results.errors.push({
          accountId: customer.accountId,
          error: `No Cleartext-Password for ${oldUsername}`
        });
        connection.release();
        continue;
      }
      const password = passwordRows[0].value;

      // 2. MAC binding
      const [macRows] = await connection.query(
        `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Calling-Station-Id'`,
        [oldUsername]
      );
      const macAddress = macRows.length ? macRows[0].value : null;

      // 3. FUP (Max-Monthly-Traffic)
      const [fupRows] = await connection.query(
        `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Max-Monthly-Traffic'`,
        [oldUsername]
      );
      const fupQuota = fupRows.length ? fupRows[0].value : null;

      // 4. Expiration
      const [expiryRows] = await connection.query(
        `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Expiration'`,
        [oldUsername]
      );
      const expiration = expiryRows.length ? expiryRows[0].value : null;

      // 5. Group
      const [groupRows] = await connection.query(
        `SELECT groupname FROM radusergroup WHERE username = ? ORDER BY priority LIMIT 1`,
        [oldUsername]
      );
      const groupName = groupRows.length ? groupRows[0].groupname : 'DISABLED';

      // 6. Billing cycle start
      const [cycleRows] = await connection.query(
        `SELECT cycle_start FROM user_billing_cycle WHERE username = ?`,
        [oldUsername]
      );
      const cycleStart = cycleRows.length ? cycleRows[0].cycle_start : null;

      if (!dryRun) {
        // Begin transaction
        await connection.beginTransaction();

        // Delete any existing entries for newUsername (to clean slate)
        await connection.query(`DELETE FROM radcheck WHERE username = ?`, [newUsername]);
        await connection.query(`DELETE FROM radusergroup WHERE username = ?`, [newUsername]);
        await connection.query(`DELETE FROM radreply WHERE username = ?`, [newUsername]);
        await connection.query(`DELETE FROM user_billing_cycle WHERE username = ?`, [newUsername]);

        // Insert password
        await connection.query(
          `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)`,
          [newUsername, password]
        );

        // Insert MAC binding if exists
        if (macAddress) {
          await connection.query(
            `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Calling-Station-Id', '==', ?)`,
            [newUsername, macAddress]
          );
        }

        // Insert FUP if exists
        if (fupQuota) {
          await connection.query(
            `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Max-Monthly-Traffic', ':=', ?)`,
            [newUsername, fupQuota]
          );
        }

        // Insert Expiration if exists
        if (expiration) {
          await connection.query(
            `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Expiration', ':=', ?)`,
            [newUsername, expiration]
          );
        }

        // Insert group
        await connection.query(
          `INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)`,
          [newUsername, groupName]
        );

        // Insert billing cycle start if exists
        if (cycleStart) {
          await connection.query(
            `INSERT INTO user_billing_cycle (username, cycle_start) VALUES (?, ?)`,
            [newUsername, cycleStart]
          );
        }

        await connection.commit();
        results.updated++;
        results.details.push({
          accountId: customer.accountId,
          action: 'updated',
          oldUsername,
          newUsername
        });
      } else {
        results.details.push({
          accountId: customer.accountId,
          action: 'would update',
          oldUsername,
          newUsername
        });
      }

      connection.release();
      results.processed++;

    } catch (err) {
      console.error(`Sync error for ${customer.accountId}:`, err);
      results.errors.push({
        accountId: customer.accountId,
        error: err.message
      });
    }
  }

  // Log system event
  await SystemLog.create({
    eventType: 'radius_sync_mismatched',
    severity: 'info',
    regionCode: regionCode || req.regionFilter?.regionCode || 'all',
    entityType: 'system',
    message: `Mismatched username sync completed: ${results.processed} processed, ${results.updated} updated, ${results.created} created`,
    details: results,
    triggeredBy: req.session.userId,
    success: true
  });

  res.status(200).json({
    success: true,
    message: dryRun ? 'Dry run completed' : 'Mismatched customers synced to RADIUS',
    data: results
  });
});


/**
 * @desc    Get customer daily data usage for graph display
 * @route   GET /api/customers/:id/data-usage
 * @access  Private
 * @query   days, dateFrom, dateTo
 */
exports.getCustomerDataUsage = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id)
    .select('firstName lastName accountId pppoe regionCode')
    .lean();

  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  // Region access check
  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied', 403));
  }

  const username = customer.pppoe?.username;
  if (!username) return next(new ErrorResponse('Customer has no PPPoE username', 400));

  const { days, dateFrom, dateTo } = req.query;

  const radiusService = require('../services/radiusService');
  const result = await radiusService.getCustomerDailyUsage(username, {
    days:     days     ? parseInt(days) : 30,
    dateFrom: dateFrom || null,
    dateTo:   dateTo   || null
  });

  if (!result.success) return next(new ErrorResponse(result.error, 500));

  res.status(200).json({
    success: true,
    customer: {
      id:        customer._id,
      name:      `${customer.firstName} ${customer.lastName}`,
      accountId: customer.accountId,
      username
    },
    summary: result.summary,
    data:    result.data
  });
});


/**
 * @desc    Add a note to a customer
 * @route   POST /api/customers/:id/notes
 * @access  Private
 * @body    { note: string }
 */
exports.addCustomerNotes = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { note } = req.body;

  // Validate note content
  if (!note || !note.trim()) {
    return next(new ErrorResponse("Note content is required", 400));
  }

  // Find the customer
  const customer = await Customer.findById(id);
  if (!customer) {
    return next(new ErrorResponse("Customer not found", 404));
  }

  // Region access check
  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse("Access denied to this customer", 403));
  }

  // Push the note
  customer.notes.push({
    note: note.trim(),
    addedBy: req.user?._id || req.session?.userId || "system",
    addedAt: new Date(),
  });

  await customer.save();

  res.status(201).json({
    success: true,
    message: "Note added successfully",
    data: customer.notes,
  });
});


// @desc    Get vouchers for a customer (by accountId in prefix)
// @route   GET /api/customers/:id/vouchers
// @access  Private
exports.getCustomerVouchers = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  // Region access check
  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this customer', 403));
  }

  const accountId = customer.accountId;
  // Match prefixes that end with '-{accountId}' exactly
  const prefixRegex = new RegExp(`^[A-Z]{4}-${accountId}$`);

  const vouchers = await Voucher.find({
    prefix: { $regex: prefixRegex },
    // Optionally, we can exclude those created before a certain date? No.
  })
    .populate('packageId', 'packageName')
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: vouchers,
  });
});