const asyncHandler = require("../middleware/asyncHandler");
const { ErrorResponse } = require("../middleware/errorHandler");
const Customer = require("../models/Customer");
const Package = require("../models/Package");
const Site = require("../models/Site");
const Ticket = require("../models/Ticket");
const Router = require("../models/Router");
const Transaction = require("../models/Transaction");
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

// @desc    Get all customers
// @route   GET /api/customers
// @access  Private
// controllers/customerController.js

// controllers/customerController.js (OPTION 2 - Server-side connectivity filtering)

// controllers/customerController.js (FIXED OPTION 2)

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
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  // Build base query
  const query = { ...req.regionFilter };

  if (search) {
    query.$or = [
      { accountId: { $regex: search, $options: "i" } },
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search, $options: "i" } },
    ];
  }
  if (status) query["subscription.status"] = status;
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

  // ========== CONNECTIVITY FILTER - MUST FETCH ALL FIRST ==========
  if (connectivity) {
    console.log(`[CONNECTIVITY FILTER] Fetching ALL customers to filter by: ${connectivity}`);
    
    // CRITICAL: Fetch ALL customers matching other filters (NO pagination limits!)
    const allCustomers = await Customer.find(query)
      .populate("subscription.packageId", "packageName price")
      .populate("siteId", "name regionCode")
      .select("-pppoe.password -cpe.wifiPassword")
      .sort(sort);
      // ⚠️ NO .limit() or .skip() here!

    console.log(`[CONNECTIVITY FILTER] Found ${allCustomers.length} total customers in DB`);

    if (allCustomers.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Customers retrieved successfully",
        data: {
          customers: [],
          pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 },
        },
      });
    }

    // Prepare for bulk RADIUS check
    const usernames = allCustomers.map(c => c.pppoe.username);
    const expectedNasIpMap = {};
    for (const c of allCustomers) {
      if (c.pppoe.siteIp) expectedNasIpMap[c.pppoe.username] = c.pppoe.siteIp;
    }

    console.log(`[CONNECTIVITY FILTER] Checking RADIUS status for ${usernames.length} users...`);

    // Fetch real-time connectivity for ALL customers
    const statuses = await radiusService.getBulkUserConnectionStatus(usernames, expectedNasIpMap);

    // Attach connectivity to each customer
    const customersWithStatus = [];
    for (const customer of allCustomers) {
      const s = statuses[customer.pppoe.username] || {};
      let activeStatus = 'offline';
      
      if (s.isOnline) {
        activeStatus = 'online';
      } else if (s.isOnlineNoInternet) {
        activeStatus = 'online-no-internet';
      }
      
      customer._doc.connectivity = activeStatus;

      // Update cache in background (fire-and-forget)
      if (customer.connectionStatus.status !== activeStatus) {
        customer.connectionStatus.status = activeStatus;
        customer.connectionStatus.lastChecked = new Date();
        customer.connectionStatus.currentIp = s.ipAddress || null;
        customer.connectionStatus.currentNasIp = s.nasIpAddress || null;
        if (s.callingMac) customer.connectionStatus.currentMac = s.callingMac;
        if (s.isOnline) customer.connectionStatus.lastOnline = new Date();
        if (!s.isOnline && !s.isOnlineNoInternet) customer.connectionStatus.lastOffline = new Date();
        
        customer.save({ validateBeforeSave: false }).catch(e =>
          console.error('Failed to update connectionStatus cache:', e.message)
        );
      }

      customersWithStatus.push(customer);
    }

    // NOW filter by the requested connectivity status
    const filteredByConnectivity = customersWithStatus.filter(c => c._doc.connectivity === connectivity);
    
    console.log(`[CONNECTIVITY FILTER] After filtering by '${connectivity}': ${filteredByConnectivity.length} customers matched`);

    // Set total AFTER filtering
    total = filteredByConnectivity.length;

    // Apply pagination to the FILTERED results
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    customers = filteredByConnectivity.slice(startIndex, endIndex);

    console.log(`[CONNECTIVITY FILTER] Returning page ${page}: customers ${startIndex + 1}-${Math.min(endIndex, total)} of ${total}`);

  } else {
    // ========== NO CONNECTIVITY FILTER - NORMAL PAGINATION ==========
    console.log(`[NO CONNECTIVITY FILTER] Using normal pagination`);
    
    // Fetch with standard pagination
    customers = await Customer.find(query)
      .populate("subscription.packageId", "packageName price")
      .populate("siteId", "name regionCode")
      .select("-pppoe.password -cpe.wifiPassword")
      .sort(sort)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    total = await Customer.countDocuments(query);

    if (customers.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Customers retrieved successfully",
        data: {
          customers: [],
          pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 },
        },
      });
    }

    // Fetch connectivity for the paginated results only
    const usernames = customers.map(c => c.pppoe.username);
    const expectedNasIpMap = {};
    for (const c of customers) {
      if (c.pppoe.siteIp) expectedNasIpMap[c.pppoe.username] = c.pppoe.siteIp;
    }

    const statuses = await radiusService.getBulkUserConnectionStatus(usernames, expectedNasIpMap);

    // Attach connectivity to each customer
    for (const customer of customers) {
      const s = statuses[customer.pppoe.username] || {};
      let activeStatus = 'offline';
      
      if (s.isOnline) {
        activeStatus = 'online';
      } else if (s.isOnlineNoInternet) {
        activeStatus = 'online-no-internet';
      }
      
      customer._doc.connectivity = activeStatus;

      // Update cache in background
      if (customer.connectionStatus.status !== activeStatus) {
        customer.connectionStatus.status = activeStatus;
        customer.connectionStatus.lastChecked = new Date();
        customer.connectionStatus.currentIp = s.ipAddress || null;
        customer.connectionStatus.currentNasIp = s.nasIpAddress || null;
        if (s.callingMac) customer.connectionStatus.currentMac = s.callingMac;
        if (s.isOnline) customer.connectionStatus.lastOnline = new Date();
        if (!s.isOnline && !s.isOnlineNoInternet) customer.connectionStatus.lastOffline = new Date();
        
        customer.save({ validateBeforeSave: false }).catch(e =>
          console.error('Failed to update connectionStatus cache:', e.message)
        );
      }
    }
  }

  // Prevent browser caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.status(200).json({
    success: true,
    message: "Customers retrieved successfully",
    data: {
      customers: customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    },
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
  let existing = await Customer.findOne({
    phoneNumber: formattedPhone,
    regionCode: site.regionCode
  });
  if (existing)
    return next(new ErrorResponse("Phone number already registered", 400));

  existing = await Customer.findOne({
    alternatePhoneNumber: formattedPhone,
    regionCode: site.regionCode,
  });
  if (existing)
    return next(new ErrorResponse("Phone number already registered as an alternate.", 400));

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
    fupEnabled: fupEnabled === true && packageDoc.fup?.enabled ? true : false,
    createdBy: req.session.userId,
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
  await radiusService.setBillingCycleStart(customer.pppoe.username, now);

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

  // ============================================
  // PHONE NUMBERS
  // ============================================

  if (phoneNumber) {
    const formattedPhone = formatPhoneNumber(phoneNumber);

    if (formattedPhone !== customer.phoneNumber) {
      // Check duplicates
      const existing = await Customer.findOne({
        phoneNumber,
        isChild: false,
      });

      if (existing) {
        return next(new ErrorResponse("Phone number already registered", 400));
      }

      changes.phoneNumber = { old: customer.phoneNumber, new: formattedPhone };
      customer.phoneNumber = formattedPhone;
    }
  }

  if (alternatePhoneNumber !== undefined) {
    const formattedAltPhone = alternatePhoneNumber
      ? formatPhoneNumber(alternatePhoneNumber)
      : null;
    if (formattedAltPhone !== customer.alternatePhoneNumber) {
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

  if (reason) {
    customer.notes.push({
      note: `Account suspended: ${reason}`,
      addedBy: req.session.userId,
      createdAt: new Date(),
    });
  }

  await customer.save();

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

  // --- Override mode: skip all financial checks ---
  if (override) {
    // Directly update package without any balance/downgrade restrictions
    customer.subscription.packageId = packageId;
    customer.notes.push({
      note: `Package changed from ${oldPackageId} to ${packageId} (OVERRIDE MODE - no financial checks)`,
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
    note: `Package changed from ${oldPackageId} to ${packageId}`,
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

  if (!newPassword || newPassword.length < 8) {
    return next(
      new ErrorResponse("Password must be at least 8 characters", 400),
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

  // Get router for the customer
  try {
    const router = await getRouterForCustomer(customer, false);

    if (router) {
      // Update in Mikrotik
      const mikrotikService = require("../services/mikrotikService");
      const siteObj = buildSiteLikeObjectFromRouter(router);
      const mikrotikResult = await mikrotikService.updatePPPoEPassword(
        siteObj,
        customer.pppoe.username,
        newPassword,
      );

      if (!mikrotikResult.success) {
        console.error(
          "⚠️ Mikrotik password update failed:",
          mikrotikResult.error,
        );
      } else {
        console.log("✅ Mikrotik password updated");
      }
    } else {
      console.warn(
        "⚠️ No router found for this customer, skipping Mikrotik update",
      );
    }
  } catch (routerError) {
    console.error("⚠️ Error getting router:", routerError.message);
  }

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
        [username],
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

  // Helper: format duration (seconds) into human-readable string
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

  const expectedNasIp = customer.pppoe.siteIp || null;

  if (expectedNasIp) {
    const mikrotikService = require("../services/mikroticService");
    const router = await Router.findOne({ ip: expectedNasIp });
    if (router) {
      const testResult = await mikrotikService.testConnection({
        router: {
          ip: expectedNasIp,
          username: router.username,
          password: router.password,
          port: router.apiPort || 8728,
        },
      });
      if (!testResult.success) {
        // Get last session end time for offline duration
        const lastEndTime = await getLastSessionEndTime(customer.pppoe.username);
        const lastSeen = lastEndTime || customer.createdAt;
        let offlineSince = lastSeen;
        let offlineDuration = null;
        if (offlineSince) {
          const offlineMs = Date.now() - new Date(offlineSince).getTime();
          offlineDuration = formatDuration(Math.floor(offlineMs / 1000));
        }

        const offlineSiteData = {
          customerInfo: {
            username: customer.pppoe.username,
            accountId: customer.accountId,
            name: `${customer.firstName} ${customer.lastName}`,
            package: customer.subscription?.packageId?.packageName || "N/A",
          },
          routerInfo: {
            routerIp: expectedNasIp,
            siteName: customer.siteId?.siteName || "Unknown",
          },
          status: "offline",
          connectionInfo: {
            reason: "Router Unreachable",
            ipAddress: null,
            macAddress: customer.cpe?.macAddress || null,
            uptime: null,
            uptimeSeconds: 0,
            offlineSince: offlineSince.toISOString(),
            offlineDuration,
            lastSeen: lastSeen.toISOString(),
            routerBrand: customer.cpe?.model || null,
          },
        };
        return res.status(200).json({ success: true, data: offlineSiteData });
      }
    }
  }

  // Helper to get last session end time from RADIUS


  // Helper to fetch latest auth attempt from the new logging table
  const getLatestAuthAttempt = async (username, authResult = null) => {
    let conn;
    try {
      conn = await radiusService.getConnection();
      
      let query = `SELECT password, calling_station_id, nas_ip_address, auth_result, auth_timestamp 
                   FROM radius_auth_log 
                   WHERE username = ?`;
      const params = [username];
      
      if (authResult) {
        query += ` AND auth_result = ?`;
        params.push(authResult);
      }
      
      query += ` ORDER BY auth_timestamp DESC LIMIT 1`;
      
      const [rows] = await conn.query(query, params);
      
      if (rows.length > 0) {
        let decodedPassword = null;
      
        try {
          decodedPassword = Buffer.from(rows[0].password, "base64").toString("utf8");
        } catch (e) {
          // fallback in case old records are not base64
          decodedPassword = rows[0].password;
        }
      
        return {
          attemptedPassword: decodedPassword,
          timestamp: rows[0].auth_timestamp,
          authResult: rows[0].auth_result,
          callingStationId: rows[0].calling_station_id,
          nasIpAddress: rows[0].nas_ip_address,
        };
      }
    } catch (err) {
      console.error("Error fetching auth attempt:", err);
      return null;
    } finally {
      if (conn) conn.release();
    }
    return null;
  };

  const statusResult = await radiusService.getUserConnectionStatus(
    customer.pppoe.username,
    expectedNasIp,
  );
  if (!statusResult.success) {
    return next(
      new ErrorResponse(`RADIUS query failed: ${statusResult.error}`, 500),
    );
  }

  let routerBrand = null;
  if (statusResult.callingMac) {
    routerBrand = await getMacVendor(statusResult.callingMac);
  } else if (customer.cpe?.macAddress) {
    routerBrand = await getMacVendor(customer.cpe.macAddress);
  }

  // Helper to determine status by IP address
// Helper to determine status by IP address
const getStatusFromIp = (ipAddress) => {
  if (!ipAddress) return 'offline';
  const ipParts = ipAddress.split('.').map(Number);
  if (ipParts.length !== 4) return 'offline';

  // Expired pool: 10.254.254.0/24
  if (ipParts[0] === 10 && ipParts[1] === 254 && ipParts[2] === 254) {
    return 'expired';
  }
  // Wrong password pool: 20.20.0.0/16
  if (ipParts[0] === 20 && ipParts[1] === 20) {
    return 'wrong-password';
  }
  // Non-existent user pool: 30.30.0.0/16
  if (ipParts[0] === 30 && ipParts[1] === 30) {
    return 'non-existent';
  }
  // MAC mismatch pool: 40.40.0.0/16
  if (ipParts[0] === 40 && ipParts[1] === 40) {
    return 'mac-mismatch';
  }

  // Any other IP (including 10.10.x.x or any normal pool) means online
  return 'online';
};

  const statusType = getStatusFromIp(statusResult.ipAddress);

  // Update customer connectionStatus object (still useful for caching)
  if (!customer.connectionStatus) customer.connectionStatus = {};
  customer.connectionStatus.lastChecked = now;
  customer.connectionStatus.currentIp = statusResult.ipAddress || null;
  customer.connectionStatus.currentMac = customer.cpe?.macAddress || null;
  customer.connectionStatus.currentNasIp = statusResult.nasIpAddress || null;

  let responseData = {
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

  if (statusType === "online") {
    // Fully online – update customer record with current online time
    customer.connectionStatus.status = "online";
    customer.connectionStatus.lastOnline = now;
    
    // Save the NAS IP if present
    if (statusResult.nasIpAddress && customer.nasIp !== statusResult.nasIpAddress) {
      customer.pppoe.siteIp = statusResult.nasIpAddress;
      customer.nasIp = statusResult.nasIpAddress;
      await customer.save({ validateBeforeSave: false });
    }
    
    if (customer.connectionStatus.noInternetSince) {
      customer.connectionStatus.noInternetSince = null;
    }
   
    if (customer.cpe.macAddress !== statusResult.callingMac) {
      customer.cpe.macAddress = statusResult.callingMac;
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
          [customer.pppoe.username, statusResult.callingMac.toUpperCase()],
        );
  
        connection.release();
        console.log("✅ RADIUS MAC address updated");
      } catch (radiusError) {
        console.error("⚠️ RADIUS MAC update failed:", radiusError.message);
      }
    }

    await customer.save({ validateBeforeSave: false });

    responseData.status = "online";
    responseData.connectionInfo = {
      ipAddress: statusResult.ipAddress,
      macAddress: statusResult.callingMac || customer.cpe?.macAddress || null,
      uptime: formatDuration(statusResult.sessionTime),
      uptimeSeconds: statusResult.sessionTime,
      onlineSince: statusResult.startTime?.toISOString() || now.toISOString(),
      lastSeen: now.toISOString(),
      nasIpAddress: statusResult.nasIpAddress,
      routerBrand,
    };
    return res.status(200).json({ success: true, data: responseData });
  }

  // Cases: expired, wrong-password, non-existent, mac-mismatch (online but no internet)
  if (
    statusType === "expired" ||
    statusType === "wrong-password" ||
    statusType === "non-existent" ||
    statusType === "mac-mismatch"
  ) {
    customer.connectionStatus.status = "online-no-internet";
    if (!customer.connectionStatus.noInternetSince) {
      customer.connectionStatus.noInternetSince = now;
    }
    if (!customer.connectionStatus.lastOnline) {
      customer.connectionStatus.lastOnline = statusResult.startTime || now;
    }
    await customer.save({ validateBeforeSave: false });

    let reason = "";
    let authFailure = null;
    
    if (statusType === "expired") {
      reason = "Account disabled";
      // No auth failure needed for disabled accounts
    } else if (statusType === "wrong-password") {
      reason = "Wrong password";
      const authAttempt = await getLatestAuthAttempt(customer.pppoe.username, 'wrong_password');
      if (authAttempt) {
        authFailure = {
          attemptedPassword: authAttempt.attemptedPassword,
          timestamp: authAttempt.timestamp,
          message: "Wrong password used",
        };
      }
    } else if (statusType === "non-existent") {
      reason = "User does not exist";
      const authAttempt = await getLatestAuthAttempt(customer.pppoe.username, 'no_user');
      if (authAttempt) {
        authFailure = {
          attemptedPassword: authAttempt.attemptedPassword,
          timestamp: authAttempt.timestamp,
          message: "User does not exist in RADIUS",
        };
      }
    } else if (statusType === "mac-mismatch") {
      reason = "MAC address mismatch";
      // MAC info is already in connectionInfo
    }

    responseData.status = "online-no-internet";
    responseData.connectionInfo = {
      ipAddress: statusResult.ipAddress,
      macAddress: statusResult.callingMac || customer.cpe?.macAddress || null,
      uptime: formatDuration(statusResult.sessionTime),
      uptimeSeconds: statusResult.sessionTime,
      onlineSince: statusResult.startTime?.toISOString() || now.toISOString(),
      lastSeen: now.toISOString(),
      noInternetSince: customer.connectionStatus.noInternetSince.toISOString(),
      reason,
      routerBrand,
      nasIpAddress: statusResult.nasIpAddress,
    };
    
    if (authFailure) {
      responseData.authFailure = authFailure;
    }
    
    if (statusResult.isOnDifferentNas) {
      responseData.connectionInfo.warning = `Active session on different router (${statusResult.nasIpAddress})`;
      responseData.connectionInfo.currentRouterIp = expectedNasIp;
      responseData.connectionInfo.sessionRouterIp = statusResult.nasIpAddress;
    }
    
    return res.status(200).json({ success: true, data: responseData });
  }

  // Offline – no active session. Use RADIUS history for last seen.
  const lastEndTime = await getLastSessionEndTime(customer.pppoe.username);
  const lastSeen = lastEndTime || customer.createdAt;
  let offlineSince = lastSeen; // the moment the last session ended
  let offlineDuration = null;
  if (offlineSince) {
    const offlineMs = Date.now() - new Date(offlineSince).getTime();
    offlineDuration = formatDuration(Math.floor(offlineMs / 1000));
  }

  customer.connectionStatus.status = "offline";
  if (
    !customer.connectionStatus.lastOffline &&
    customer.connectionStatus.lastOnline
  ) {
    customer.connectionStatus.lastOffline = now;
  }
  if (customer.connectionStatus.noInternetSince) {
    customer.connectionStatus.noInternetSince = null;
  }
  
  // Also update customer's lastOnline to the last known session end time for future fallback
  customer.connectionStatus.lastOnline = lastSeen;
  await customer.save({ validateBeforeSave: false });

  // Check if there was a recent auth failure while offline
  const recentAuthAttempt = await getLatestAuthAttempt(customer.pppoe.username);
  let offlineAuthFailure = null;
  if (recentAuthAttempt && recentAuthAttempt.authResult !== 'correct') {
    offlineAuthFailure = {
      attemptedPassword: recentAuthAttempt.attemptedPassword,
      timestamp: recentAuthAttempt.timestamp,
      message: `Last auth attempt failed: ${recentAuthAttempt.authResult}`,
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
    registeredAt: customer.createdAt
  };
  
  if (offlineAuthFailure) {
    responseData.authFailure = offlineAuthFailure;
  }
  
  return res.status(200).json({ success: true, data: responseData });
});


/**
 * @desc    Reset customer MAC address (when ONU is replaced)
 * @route   POST /api/customers/:id/reset-mac
 * @access  Private
 *
 * When a customer's ONU/router is replaced:
 * 1. Keep WiFi name and password
 * 2. Update serial number, MAC address, and model
 * 3. Fetch new info from active PPPoE session
 * 4. Log the change
 */
/**
 * @desc    Reset customer MAC address (when ONU is replaced)
 * @route   POST /api/customers/:id/reset-mac
 * @access  Private
 */
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
exports.createChildAccount = asyncHandler(async (req, res, next) => {
  const { parentId } = req.params;

  // 1. Find parent
  const parent = await Customer.findById(parentId);
  if (!parent) return next(new ErrorResponse("Parent customer not found", 404));
  if (parent.isChild)
    return next(
      new ErrorResponse("Cannot create child under another child", 400),
    );

  // 2. Extract child-specific fields
  const {
    packageId,
    siteId,
    // Location fields (top‑level)
    city,
    subLocation,
    localArea,
    // Override fields
    siteMacAddress,
    clientMacAddress,
    wifiName,
    wifiPassword,
    model,
    serialNumber,
    notes,
    // Optional overrides for personal info
    firstName: overrideFirstName,
    lastName: overrideLastName,
    email: overrideEmail,
    phoneNumber: overridePhone,
    alternatePhoneNumber: overrideAltPhone,
    location: overrideLocation,
  } = req.body;

  // Validate mandatory fields (including location)
  if (
    !packageId ||
    !siteId ||
    !city ||
    !subLocation ||
    !localArea ||
    !clientMacAddress ||
    !wifiName ||
    !wifiPassword ||
    !model ||
    !serialNumber
  ) {
    return next(
      new ErrorResponse(
        "Missing required fields: packageId, siteId, city, subLocation, localArea, clientMacAddress, wifiName, wifiPassword, model, serialNumber",
        400,
      ),
    );
  }

  // 3. Resolve package and site
  const Package = require("../models/Package");
  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) return next(new ErrorResponse("Package not found", 404));

  const site = await Site.findById(siteId);
  if (!site) return next(new ErrorResponse("Site not found", 404));

  if (packageDoc.siteId.toString() !== siteId) {
    return next(new ErrorResponse("Package does not belong to this site", 400));
  }
  if (packageDoc.packageType !== "ppp") {
    return next(new ErrorResponse("Only PPPoE packages allowed", 400));
  }

  // 4. Inherit or override personal info
  const firstName = overrideFirstName || parent.firstName;
  const lastName = overrideLastName || parent.lastName;
  const email = overrideEmail || parent.email;
  const phoneNumber = overridePhone
    ? formatPhoneNumber(overridePhone)
    : parent.phoneNumber;
  const alternatePhoneNumber = overrideAltPhone
    ? formatPhoneNumber(overrideAltPhone)
    : parent.alternatePhoneNumber;
  const location = overrideLocation
    ? { ...parent.location, ...overrideLocation }
    : parent.location;

  // 5. Generate child account ID based on parent
  const childCount = await Customer.countDocuments({
    parentAccount: parent._id,
  });
  const suffix = (childCount + 1).toString().padStart(2, "0");
  const finalAccountId = `${parent.accountId}-${suffix}`;
  const pppoePassword = generatePPPoEPassword();

  // 6. Set subscription as expired (not active)
  const now = new Date();
  const expiresAt = new Date(now.getTime() - 1000); // expired 1 second ago

  // 7. Get primary router for the site (for siteIp)
  // let primaryRouter;
  // try {
  //   primaryRouter = await getPrimaryRouterForSite(siteId);
  // } catch (routerError) {
  //   return next(
  //     new ErrorResponse(
  //       `Cannot create child account: ${routerError.message}`,
  //       500,
  //     ),
  //   );
  // }

  // 8. Create child in database
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
      packageId,
      status: "expired",
      activatedAt: null,
      expiresAt,
      autoRenew: true,
    },
    billing: {
      balance: 0,
    },
    isChild: true,
    parentAccount: parent._id,
    createdBy: req.session.userId,
  });

  // Add note if provided
  if (notes) {
    child.notes.push({
      note: notes,
      addedBy: req.session.userId,
      addedAt: now,
    });
    await child.save();
  }

  // 9. Update site coverage (non‑critical)
  try {
    await site.addCityIfNotExists(child.city);
    await site.addSubLocationIfNotExists(child.city, child.subLocation);
    await site.addLocalAreaIfNotExists(child.city, child.subLocation, child.localArea);
  } catch (err) {
    console.warn(`Site coverage update failed for ${child.accountId}:`, err.message);
  }

  // 10. Create RADIUS account (disabled initially)
  let radiusMessage = "";
  try {
    const radiusService = require("../services/radiusService");
    const radiusResult = await radiusService.createAccount(child, packageDoc);
    if (!radiusResult.success) {
      throw new Error(radiusResult.error);
    }
    // Immediately disable the account (since child is expired)
    const disableResult = await radiusService.disableAccount(child.pppoe.username);
    if (!disableResult.success) {
      console.warn("Could not disable RADIUS account:", disableResult.error);
      radiusMessage = "RADIUS account created but could not be disabled.";
    } else {
      radiusMessage = "RADIUS account created and disabled (child is inactive).";
    }
  } catch (error) {
    console.error("RADIUS account creation failed for child:", error.message);
    radiusMessage = `RADIUS account creation failed: ${error.message}`;
    // Don't fail the whole creation; child is still saved, but log error.
  }

  // 11. Log creation
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
 * @desc    Get child accounts of a parent
 * @route   GET /api/customers/:parentId/children
 * @access  Private
 */
exports.getChildren = asyncHandler(async (req, res, next) => {
  const { parentId } = req.params;

  // Check parent exists and user has access to parent (region filter applied on parent route)
  const parent = await Customer.findById(parentId);
  if (!parent) return next(new ErrorResponse("Parent not found", 404));

  // No region restriction for children – we return all children regardless of region
  const children = await Customer.find({ parentAccount: parentId })
    .populate("subscription.packageId", "packageName")
    .populate("siteId", "siteName")
    .select("-pppoe.password -cpe.wifiPassword");

  res.status(200).json({
    success: true,
    data: children,
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
  const convenienceFee = 1;
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
  const convenienceFee = 1;
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

  const timeOnly = `${target.getHours().toString().padStart(2, "0")}:${target.getMinutes().toString().padStart(2, "0")}`;
  const mobileSasaService = require("../services/mobileSasaService");
  const smsMessage = `Dear ${customer.firstName} ${customer.lastName}, your subscription expiry date has been moved to ${target.toDateString()} at ${timeOnly}. This date will apply for al the following months as long as you pay for your following month's subscription before the current expires. Thankyou.`;

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

  const oldExpiry = customer.subscription.expiresAt;

  // Parse the input date string and set time to 12:00:00 UTC
  let newExpiry = new Date(newExpiryDate);
  if (isNaN(newExpiry.getTime())) return next(new ErrorResponse('Invalid date', 400));

  // Set to noon UTC (12:00:00.000) – consistent across all clients
  newExpiry = new Date(Date.UTC(
    newExpiry.getUTCFullYear(),
    newExpiry.getUTCMonth(),
    newExpiry.getUTCDate(),
    12, 0, 0, 0
  ));

  const now = new Date();
  const wasActive = customer.subscription.status === 'active';
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
    customer.subscription.status = 'expired';
    console.log(`🔄 [overrideExpiry] Deactivating ${customer.accountId} -> disable RADIUS`);
    const radResult = await radiusService.disableAccount(customer.pppoe.username);
    if (!radResult.success) {
      console.error(`❌ RADIUS disable failed: ${radResult.error}`);
    } else {
      radiusChanged = true;
      disconnectNeeded = true;
    }
  } else {
    // No status change
    console.log(`ℹ️ [overrideExpiry] No status change for ${customer.accountId}; expiry updated only.`);
  }

  customer.notes.push({
    note: `Customer expiry OVERRIDEN to ${newExpiry}.`,
    addedBy: req.user?._id || req.customerId || "system",
    addedAt: new Date(),
  });

  // Save MongoDB changes
  await customer.save();

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
    paymentMethod: "cash", // or "wallet_debit"
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



/**
 * @desc    Sync customers to RADIUS (create missing, update groups, disable expired)
 * @route   POST /api/customers/sync-to-radius
 * @access  Private (Admin only)
 * @body    { dryRun?: boolean, regionCode?: string, fixGroups?: boolean }
 */
exports.syncCustomersToRadius = asyncHandler(async (req, res, next) => {
  const { dryRun = false, regionCode, fixGroups = true } = req.body;
  
  // Build region filter (admin may have region restriction)
  let query = {};
  if (regionCode) {
    query.regionCode = regionCode;
  } else if (req.regionFilter?.regionCode) {
    query.regionCode = req.regionFilter.regionCode;
  }
  // If super admin and no regionCode, sync all

  const customers = await Customer.find(query)
    .populate('subscription.packageId')
    .populate('siteId');
  
  const radiusService = require('../services/radiusService');
  const results = {
    total: customers.length,
    processed: 0,
    created: 0,
    updatedGroup: 0,
    disabled: 0,
    errors: [],
    details: []
  };

  for (const customer of customers) {
    try {
      const username = customer.pppoe?.username;
      if (!username) {
        results.errors.push({ accountId: customer.accountId, error: 'No PPPoE username' });
        continue;
      }

      // Determine desired group and enabled status
      const packageDoc = customer.subscription?.packageId;
      const isActive = customer.subscription?.status === 'active' && 
                       new Date(customer.subscription.expiresAt) > new Date();
      let desiredGroup = null;
      let desiredEnabled = false;

      if (isActive && packageDoc) {
        desiredGroup = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
        desiredEnabled = true;
      } else {
        desiredGroup = 'DISABLED';
        desiredEnabled = false;
      }

      // Get current RADIUS state
      let radiusUserExists = false;
      let currentGroup = null;
      let conn;
      try {
        conn = await radiusService.getConnection();
        const [userCheck] = await conn.query(
          'SELECT 1 FROM radcheck WHERE username = ? AND attribute = "Cleartext-Password" LIMIT 1',
          [username]
        );
        radiusUserExists = userCheck.length > 0;

        if (radiusUserExists) {
          const [groupRows] = await conn.query(
            'SELECT groupname FROM radusergroup WHERE username = ? ORDER BY priority LIMIT 1',
            [username]
          );
          currentGroup = groupRows[0]?.groupname || null;
        }
      } finally {
        if (conn) conn.release();
      }

      // If user doesn't exist in RADIUS, create full account
      if (!radiusUserExists) {
        if (!dryRun) {
          const createResult = await radiusService.createAccount(customer, packageDoc);
          if (!createResult.success) {
            results.errors.push({ accountId: customer.accountId, error: `Create failed: ${createResult.error}` });
            continue;
          }
          // If desired group is DISABLED, disable after creation
          if (!desiredEnabled) {
            await radiusService.disableAccount(username);
          }
          results.created++;
          results.details.push({ accountId: customer.accountId, action: 'created', group: desiredGroup });
        } else {
          results.details.push({ accountId: customer.accountId, action: 'would create', group: desiredGroup });
        }
        results.processed++;
        continue;
      }

      // User exists – check group mismatch
      if (fixGroups && currentGroup !== desiredGroup) {
        if (!dryRun) {
          if (desiredEnabled) {
            await radiusService.enableAccount(username, desiredGroup);
          } else {
            await radiusService.disableAccount(username);
          }
          results.updatedGroup++;
          results.details.push({ accountId: customer.accountId, action: 'group updated', from: currentGroup, to: desiredGroup });
        } else {
          results.details.push({ accountId: customer.accountId, action: 'would update group', from: currentGroup, to: desiredGroup });
        }
        results.processed++;
        continue;
      }

      // Also handle FUP attribute (Max-Monthly-Traffic) if package changes
      if (desiredEnabled && packageDoc && packageDoc.fup?.enabled) {
        const quotaBytes = packageDoc.fup.dataThresholdGB * 1024 * 1024 * 1024;
        if (!dryRun) {
          await radiusService.enableFUPForCustomer(username, quotaBytes);
        }
      } else if (desiredEnabled && packageDoc && !packageDoc.fup?.enabled) {
        // Remove FUP if package no longer supports it
        if (!dryRun) {
          await radiusService.disableFUPForCustomer(username);
        }
      }

      // If we reach here, no changes needed
      results.details.push({ accountId: customer.accountId, action: 'already synced', group: currentGroup });
      results.processed++;

    } catch (err) {
      console.error(`Sync error for ${customer.accountId}:`, err);
      results.errors.push({ accountId: customer.accountId, error: err.message });
    }
  }

  // Log system event
  await SystemLog.create({
    eventType: 'radius_sync',
    severity: 'info',
    regionCode: regionCode || req.regionFilter?.regionCode || 'all',
    entityType: 'system',
    message: `RADIUS sync completed: ${results.processed} processed, ${results.created} created, ${results.updatedGroup} updated, ${results.disabled} disabled`,
    details: results,
    triggeredBy: req.session.userId,
    success: true
  });

  res.status(200).json({
    success: true,
    message: `Sync completed (dryRun: ${dryRun})`,
    data: results
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
      // 1. Required fields - adapt to JSON structure
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
        if (!value) {
          throw new Error(`Missing required field: ${field}`);
        }
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

      // 5. Account ID uniqueness
      const existingByAccount = await Customer.findOne({ accountId: raw.accountId });
      if (existingByAccount) {
        throw new Error(`Account ID ${raw.accountId} already exists`);
      }

      // 6. Phone number uniqueness within region
      const formattedPhone = formatPhoneNumber(raw.phoneNumber);
      const existingPhone = await Customer.findOne({
        phoneNumber: formattedPhone,
        regionCode: site.regionCode,
      });
      if (existingPhone) {
        throw new Error(`Phone number ${formattedPhone} already exists in region ${site.regionCode}`);
      }

      // 7. Alternate phone if present
      let formattedAlt = null;
      if (raw.alternatePhoneNumber) {
        formattedAlt = formatPhoneNumber(raw.alternatePhoneNumber);
        const existingAlt = await Customer.findOne({
          phoneNumber: formattedAlt,
          regionCode: site.regionCode,
        });
        if (existingAlt) {
          throw new Error(`Alternate phone ${formattedAlt} already registered`);
        }
      }

      // 8. Prepare customer data – using the nested structure
      const now = new Date();
      const customerData = {
        accountId: raw.accountId,
        regionCode: raw.regionCode || site.regionCode,
        siteId: raw.siteId,
        firstName: raw.firstName,
        lastName: raw.lastName,
        email: raw.email || '',
        phoneNumber: formattedPhone,
        alternatePhoneNumber: formattedAlt,
        city: raw.city,
        subLocation: raw.subLocation,
        localArea: raw.localArea,
        location: raw.location || {},
        isChild: raw.isChild || false,
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
            note: `Imported via bulk upload from JSON`,
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

      // 10. Create RADIUS account
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
        message: `Bulk import: customer ${customer.accountId} created (preserved original data)`,
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
exports.syncSingleCustomerToRadius = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { dryRun = false, fixGroups = true } = req.body;

  const customer = await Customer.findById(id).populate('subscription.packageId').populate('siteId');
  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  // Region access check
  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this customer', 403));
  }

  const username = customer.pppoe?.username;
  if (!username) {
    return next(new ErrorResponse('No PPPoE username found for this customer', 400));
  }

  const radiusService = require('../services/radiusService');
  const result = {
    username,
    accountId: customer.accountId,
    dryRun,
    actions: [],
    errors: []
  };

  try {
    // Determine desired group and enabled status
    const packageDoc = customer.subscription?.packageId;
    const isActive = customer.subscription?.status === 'active' && 
                     new Date(customer.subscription.expiresAt) > new Date();
    let desiredGroup = null;
    let desiredEnabled = false;

    if (isActive && packageDoc) {
      desiredGroup = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
      desiredEnabled = true;
    } else {
      desiredGroup = 'DISABLED';
      desiredEnabled = false;
    }

    // Get current RADIUS state
    let radiusUserExists = false;
    let currentGroup = null;
    let conn;
    try {
      conn = await radiusService.getConnection();
      const [userCheck] = await conn.query(
        'SELECT 1 FROM radcheck WHERE username = ? AND attribute = "Cleartext-Password" LIMIT 1',
        [username]
      );
      radiusUserExists = userCheck.length > 0;

      if (radiusUserExists) {
        const [groupRows] = await conn.query(
          'SELECT groupname FROM radusergroup WHERE username = ? ORDER BY priority LIMIT 1',
          [username]
        );
        currentGroup = groupRows[0]?.groupname || null;
      }
    } finally {
      if (conn) conn.release();
    }

    // If user doesn't exist in RADIUS, create full account
    if (!radiusUserExists) {
      if (!dryRun) {
        const createResult = await radiusService.createAccount(customer, packageDoc);
        if (!createResult.success) {
          throw new Error(`Create failed: ${createResult.error}`);
        }
        // If desired group is DISABLED, disable after creation
        if (!desiredEnabled) {
          await radiusService.disableAccount(username);
        }
        result.actions.push('created RADIUS account');
      } else {
        result.actions.push('would create RADIUS account');
      }
    } 
    // User exists – check group mismatch
    else if (fixGroups && currentGroup !== desiredGroup) {
      if (!dryRun) {
        if (desiredEnabled) {
          await radiusService.enableAccount(username, desiredGroup);
          result.actions.push(`group updated from ${currentGroup} to ${desiredGroup} (enabled)`);
        } else {
          await radiusService.disableAccount(username);
          result.actions.push(`group updated from ${currentGroup} to DISABLED (disabled)`);
        }
      } else {
        result.actions.push(`would update group from ${currentGroup} to ${desiredGroup}`);
      }
    }

    // Handle FUP attribute (Max-Monthly-Traffic) if package changes
    if (desiredEnabled && packageDoc && packageDoc.fup?.enabled) {
      const quotaBytes = packageDoc.fup.dataThresholdGB * 1024 * 1024 * 1024;
      if (!dryRun) {
        await radiusService.enableFUPForCustomer(username, quotaBytes);
        result.actions.push(`FUP enabled (${packageDoc.fup.dataThresholdGB}GB threshold)`);
      } else {
        result.actions.push('would enable FUP');
      }
    } else if (desiredEnabled && packageDoc && !packageDoc.fup?.enabled) {
      if (!dryRun) {
        await radiusService.disableFUPForCustomer(username);
        result.actions.push('FUP disabled (package does not support FUP)');
      } else {
        result.actions.push('would disable FUP');
      }
    }

    if (result.actions.length === 0) {
      result.actions.push('already in sync, no changes needed');
    }

    // Log the sync
    await SystemLog.create({
      eventType: 'radius_sync_single',
      severity: 'info',
      regionCode: customer.regionCode,
      entityType: 'customer',
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Single customer RADIUS sync ${dryRun ? '(dry run) ' : ''}completed: ${result.actions.join(', ')}`,
      details: result,
      triggeredBy: req.session.userId,
      success: true
    });

    customer.notes.push({
      note: `Customer account radius details re-synced.`,
      addedBy: req.user?._id || req.customerId || "system",
      addedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      message: dryRun ? 'Dry run completed. No changes applied.' : 'Customer synced to RADIUS successfully.',
      data: result
    });

  } catch (error) {
    console.error(`Sync error for ${customer.accountId}:`, error);
    result.errors.push(error.message);

    await SystemLog.create({
      eventType: 'radius_sync_single',
      severity: 'error',
      regionCode: customer.regionCode,
      entityType: 'customer',
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Single customer RADIUS sync failed: ${error.message}`,
      details: result,
      triggeredBy: req.session.userId,
      success: false
    });

    return next(new ErrorResponse(`Sync failed: ${error.message}`, 500));
  }
});

