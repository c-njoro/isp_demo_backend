const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const { getResourceNotFoundMessage } = require('../utils/errorMessages');
const OLT = require('../models/OLT');
const ONU = require('../models/ONU');
const Site = require('../models/Site');
const SystemLog = require('../models/SystemLog');
const oltService = require('../services/olt');

// ============================================
// OLT CRUD OPERATIONS
// ============================================

/**
 * @desc    Get all OLTs
 * @route   GET /api/olts
 * @access  Private
 */
exports.getOlts = asyncHandler(async (req, res, next) => {
  const { siteId, status, isActive = 'true', brand } = req.query;

  const query = { ...req.regionFilter };

  if (siteId) query.siteId = siteId;
  if (status) query.status = status;
  if (brand) query.brand = brand.toLowerCase();
  if (isActive) query.isActive = isActive === 'true';
console.log("Did")
  const olts = await OLT.find(query)
    .populate('siteId', 'name regionCode location')
    .populate('routerId', 'name ip tunnelIp vpnConnected')
    .select('-password')
    .sort({ name: 1 });

  res.status(200).json({
    success: true,
    message: 'OLTs retrieved successfully',
    data: {
      count: olts.length,
      olts
    }
  });
});

/**
 * @desc    Get single OLT with statistics
 * @route   GET /api/olts/:id
 * @access  Private
 */
exports.getOlt = asyncHandler(async (req, res, next) => {
  const olt = await OLT.findById(req.params.id)
    .populate('siteId', 'name regionCode location')
    .populate('routerId', 'name ip tunnelIp vpnConnected vpnLastSeen')
    .select('-password');

  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  // Get ONU counts
  const onuCount = await ONU.countDocuments({ oltId: olt._id, isActive: true });
  const onlineOnuCount = await ONU.countDocuments({ 
    oltId: olt._id, 
    status: 'online',
    isActive: true 
  });
  const offlineOnuCount = await ONU.countDocuments({ 
    oltId: olt._id, 
    status: { $in: ['offline', 'los'] },
    isActive: true 
  });

  res.status(200).json({
    success: true,
    message: 'OLT retrieved successfully',
    data: {
      ...olt.toObject(),
      statistics: {
        totalOnus: onuCount,
        onlineOnus: onlineOnuCount,
        offlineOnus: offlineOnuCount,
        utilization: ((onuCount / olt.totalCapacity) * 100).toFixed(2)
      }
    }
  });
});

/**
 * @desc    Create new OLT
 * @route   POST /api/olts
 * @access  Private (admin only)
 */
exports.createOlt = asyncHandler(async (req, res, next) => {
  // MINIMAL INPUT ONLY. Everything technical (model, firmwareVersion,
  // ponPorts, chassis stats) is deliberately NOT accepted from the
  // request body here — those are discovered by testing the connection
  // right after creation, not typed in by whoever is filling the form.
  // regionCode is also not accepted directly; it's derived from the
  // selected Site, since asking someone to retype a code that already
  // exists on the Site record is an unnecessary and error-prone field.
  const { name, description, siteId, routerId, ip, port, username, password, brand } = req.body;

  // Validate required fields — this is the FULL required set, intentionally short.
  if (!name || !siteId || !routerId || !ip || !username || !password || !brand) {
    return next(new ErrorResponse(
      'Please provide all required fields: name, siteId, routerId, ip, username, password, brand',
      400
    ));
  }

  // Validate brand
  if (!oltService.isVendorSupported(brand)) {
    return next(new ErrorResponse(
      `Unsupported OLT brand: ${brand}. Supported brands: ${oltService.getSupportedVendors().join(', ')}`,
      400
    ));
  }

  // Check if site exists — regionCode is derived from here, not user input.
  const site = await Site.findById(siteId);
  if (!site) {
    return next(new ErrorResponse(getResourceNotFoundMessage('Site'), 404));
  }

  // Check if router exists and actually belongs to this site
  const Router = require('../models/Router');
  const router = await Router.findById(routerId);
  if (!router) {
    return next(new ErrorResponse(getResourceNotFoundMessage('Router'), 404));
  }
  if (router.site.toString() !== site._id.toString()) {
    return next(new ErrorResponse(
      'Selected router does not belong to the selected site',
      400
    ));
  }

  // Check region access — using the site's own regionCode, since the
  // user never supplies one directly anymore.
  if (req.regionFilter.regionCode && site.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied: OLT region does not match your access', 403));
  }

  // Check if OLT with same IP already exists
  const existingOlt = await OLT.findOne({ ip });
  if (existingOlt) {
    return next(new ErrorResponse(`OLT with IP ${ip} already exists`, 400));
  }

  // Set default port based on brand, only if not explicitly provided.
  // Most users won't supply a port at all — this just picks a sane
  // default per vendor (22 for Huawei/SSH-style, 23 for ZTE/Telnet-style)
  // rather than asking the form to explain port numbers to anyone.
  let defaultPort = port;
  if (!defaultPort) {
    defaultPort = brand.toLowerCase() === 'zte' ? 23 : 23; // both telnet-only on this fleet today — see oltService notes
  }

  // Create OLT with ONLY what's known right now. model, serialNumber,
  // firmwareVersion, ponPorts, etc. are left at schema defaults — they
  // get filled in below once the connection test runs, not guessed here.
  const olt = await OLT.create({
    name,
    description,
    siteId,
    routerId,
    regionCode: site.regionCode,
    ip,
    port: defaultPort,
    username,
    password,
    brand: brand.toLowerCase(),
    apiType: 'telnet',
    status: 'unknown',
    createdBy: req.session.userId,
    installedAt: new Date(),
    installedBy: req.session.userId
  });

  // Log creation
  await SystemLog.create({
    eventType: 'olt_created',
    severity: 'info',
    regionCode: olt.regionCode,
    entityType: 'olt',
    entityId: olt._id,
    message: `OLT ${olt.name} created at site ${site.name}`,
    details: {
      oltId: olt._id,
      oltName: olt.name,
      brand: olt.brand,
      siteId: site._id,
      siteName: site.name,
      routerId: router._id,
      routerName: router.name,
      ip: olt.ip
    },
    triggeredBy: req.session.userId,
    success: true
  });

  // Immediately attempt a connection test, in the background relative to
  // the response — we don't make the admin wait on this and we don't
  // block creation if the OLT happens to be unreachable right now (e.g.
  // network/route not finished being set up yet — see onboarding guide).
  // Result gets persisted onto the OLT record either way, so the detail
  // page can show real status without the user re-triggering anything.
  testAndSyncOlt(olt._id).catch((err) => {
    console.error(`Background connection test failed for OLT ${olt._id}:`, err.message);
  });

  // Don't send password in response
  olt.password = undefined;

  res.status(201).json({
    success: true,
    message: 'OLT created. Testing connection in the background — check the OLT detail page for live status.',
    data: olt
  });
});

/**
 * Shared helper: test connectivity to an OLT and backfill whatever
 * structured fields the test reveals (currently: status, lastOnline,
 * lastChecked, and the raw firmware/version string). Called automatically
 * right after creation, and also available as a standalone "refresh"
 * action via POST /api/olts/:id/test-connection for the detail page.
 *
 * NOTE: getSystemInfo() currently returns raw, unparsed CLI text — no
 * structured model/ponPorts parser exists yet for either vendor. We only
 * set what we can honestly claim to know: connectivity status and the
 * raw version string. Anything claiming to auto-fill ponPorts/model today
 * would be guessing, not data.
 */
async function testAndSyncOlt(oltId) {
  const olt = await OLT.findById(oltId).select('+password');
  if (!olt) return { success: false, message: 'OLT not found' };

  const result = await oltService.testConnection(olt);

  if (!result.success) {
    olt.status = 'unreachable';
    olt.lastChecked = new Date();
    await olt.save();
    return { success: false, message: result.message, error: result.error, olt };
  }

  olt.status = 'online';
  olt.lastOnline = new Date();
  olt.lastChecked = new Date();
  olt.firmwareVersion = result.version || olt.firmwareVersion;
  await olt.save();

  return { success: true, message: result.message, olt };
}

/**
 * @desc    Update OLT
 * @route   PUT /api/olts/:id
 * @access  Private (admin only)
 */
exports.updateOlt = asyncHandler(async (req, res, next) => {
  let olt = await OLT.findById(req.params.id);

  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  const {
    name,
    description,
    siteId,
    routerId,
    ip,
    port,
    username,
    password,
    brand,
    model,
    serialNumber,
    firmwareVersion,
    ponPorts,
    maxOnusPerPort,
    location,
    contactPerson,
    vlanRange,
    managementVlan,
    monitoring,
    isActive
  } = req.body;

  // Validate brand if being changed
  if (brand && !oltService.isVendorSupported(brand)) {
    return next(new ErrorResponse(
      `Unsupported OLT brand: ${brand}. Supported brands: ${oltService.getSupportedVendors().join(', ')}`,
      400
    ));
  }

  // Check if IP is being changed and if it conflicts
  if (ip && ip !== olt.ip) {
    const existingOlt = await OLT.findOne({ ip, _id: { $ne: olt._id } });
    if (existingOlt) {
      return next(new ErrorResponse(`OLT with IP ${ip} already exists`, 400));
    }
  }

  // If routerId is being changed, validate it exists and belongs to the
  // OLT's site (using the new siteId if that's also being changed in this
  // same request, otherwise the OLT's existing siteId).
  if (routerId && routerId !== olt.routerId?.toString()) {
    const Router = require('../models/Router');
    const router = await Router.findById(routerId);
    if (!router) {
      return next(new ErrorResponse(getResourceNotFoundMessage('Router'), 404));
    }
    const effectiveSiteId = siteId || olt.siteId;
    if (router.site.toString() !== effectiveSiteId.toString()) {
      return next(new ErrorResponse(
        'Selected router does not belong to the selected site',
        400
      ));
    }
  }

  // If siteId is being changed without an explicit routerId change, verify
  // the OLT's existing router still belongs to the new site — otherwise
  // the OLT would end up pointing at a router from the wrong site.
  if (siteId && siteId !== olt.siteId?.toString() && !routerId) {
    const Router = require('../models/Router');
    const currentRouter = await Router.findById(olt.routerId);
    if (currentRouter && currentRouter.site.toString() !== siteId.toString()) {
      return next(new ErrorResponse(
        `OLT's current router belongs to a different site. Provide a new routerId that belongs to the new site.`,
        400
      ));
    }
  }

  // Update fields
  if (name) olt.name = name;
  if (description !== undefined) olt.description = description;
  if (siteId) olt.siteId = siteId;
  if (routerId) olt.routerId = routerId;
  if (ip) olt.ip = ip;
  if (port) olt.port = port;
  if (username) olt.username = username;
  if (password) olt.password = password;
  if (brand) olt.brand = brand.toLowerCase();
  if (model) olt.model = model;
  if (serialNumber) olt.serialNumber = serialNumber;
  if (firmwareVersion) olt.firmwareVersion = firmwareVersion;
  if (ponPorts) olt.ponPorts = ponPorts;
  if (maxOnusPerPort) olt.maxOnusPerPort = maxOnusPerPort;
  if (location) olt.location = location;
  if (contactPerson) olt.contactPerson = contactPerson;
  if (vlanRange) olt.vlanRange = vlanRange;
  if (managementVlan) olt.managementVlan = managementVlan;
  if (monitoring) olt.monitoring = { ...olt.monitoring, ...monitoring };
  if (typeof isActive !== 'undefined') olt.isActive = isActive;

  olt.updatedBy = req.session.userId;

  await olt.save();

  // Log update
  await SystemLog.create({
    eventType: 'olt_updated',
    severity: 'info',
    regionCode: olt.regionCode,
    entityType: 'olt',
    entityId: olt._id,
    message: `OLT ${olt.name} updated`,
    triggeredBy: req.session.userId,
    success: true
  });

  // Don't send password in response
  olt.password = undefined;

  res.status(200).json({
    success: true,
    message: 'OLT updated successfully',
    data: olt
  });
});

/**
 * @desc    Delete OLT
 * @route   DELETE /api/olts/:id
 * @access  Private (admin only)
 */
exports.deleteOlt = asyncHandler(async (req, res, next) => {
  const olt = await OLT.findById(req.params.id);

  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  // Check if OLT has active ONUs
  const onuCount = await ONU.countDocuments({ oltId: olt._id, isActive: true });
  if (onuCount > 0) {
    return next(new ErrorResponse(
      `Cannot delete OLT with ${onuCount} active ONUs. Please deactivate or remove ONUs first.`,
      400
    ));
  }

  await olt.deleteOne();

  // Log deletion
  await SystemLog.create({
    eventType: 'olt_deleted',
    severity: 'warning',
    regionCode: olt.regionCode,
    entityType: 'olt',
    entityId: olt._id,
    message: `OLT ${olt.name} deleted`,
    triggeredBy: req.session.userId,
    success: true
  });

  res.status(200).json({
    success: true,
    message: 'OLT deleted successfully'
  });
});

// ============================================
// OLT CONNECTION & STATUS
// ============================================

/**
 * @desc    Test OLT connection
 * @route   GET /api/olts/:id/test-connection
 * @access  Private
 */
exports.testConnection = asyncHandler(async (req, res, next) => {
  // Get OLT with password
  const olt = await OLT.findById(req.params.id).select('+password');

  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  console.log(`\n🔌 Testing connection to ${olt.brand.toUpperCase()} OLT: ${olt.name}`);

  // Test connection — this now does real discovery (version + board/slot
  // detection), not just a bare connectivity check. See huawei.js's
  // testConnection for what "discovered" actually contains.
  const result = await oltService.testConnection(olt);

  const changes = {};

  if (result.success) {
    olt.status = 'online';
    olt.lastOnline = new Date();
    olt.lastChecked = new Date();

    if (result.version && result.version !== 'unknown' && result.version !== olt.firmwareVersion) {
      changes.firmwareVersion = { from: olt.firmwareVersion, to: result.version };
      olt.firmwareVersion = result.version;
    }

    // Compare discovered gponSlots against what's currently saved —
    // only write and log if something actually changed, per "compare
    // what we have saved vs what we get, then update" requirement.
    // This is what makes ONU listing/discovery actually safe to run
    // (see huawei.js getAllOnus/getUnconfiguredOnus, which now refuse
    // to run a blind sweep without gponSlots set).
    if (result.discovered?.gponSlots) {
      const discoveredSlots = [...result.discovered.gponSlots].sort();
      const currentSlots = [...(olt.gponSlots || [])].sort();
      const slotsChanged = JSON.stringify(discoveredSlots) !== JSON.stringify(currentSlots);

      if (slotsChanged) {
        changes.gponSlots = { from: currentSlots, to: discoveredSlots };
        olt.gponSlots = discoveredSlots;
      }
    }

    // Persist the full board list too — useful on the detail page to
    // show real chassis info (control board, uplink board, etc.), not
    // just which slots are GPON.
    if (result.discovered?.boards) {
      olt.stats = olt.stats || {};
      olt.stats.slotsTotal = result.discovered.boards.length;
      olt.stats.slotsOccupied = result.discovered.boards.filter(b => b.boardName).length;
      olt.discoveredBoards = result.discovered.boards;
    }
  } else {
    olt.status = 'offline';
    olt.lastChecked = new Date();
  }

  await olt.save();

  // Log test — including what actually changed, if anything, so there's
  // a real audit trail of when discovery updated stored OLT facts.
  await SystemLog.create({
    eventType: 'olt_connection_test',
    severity: result.success ? 'info' : 'warning',
    regionCode: olt.regionCode,
    entityType: 'olt',
    entityId: olt._id,
    message: `Connection test ${result.success ? 'successful' : 'failed'} for OLT ${olt.name}${Object.keys(changes).length ? ' (discovered changes: ' + Object.keys(changes).join(', ') + ')' : ''}`,
    details: {
      result: {
        success: result.success,
        version: result.version,
        error: result.error
      },
      changes,
      brand: olt.brand
    },
    triggeredBy: req.session.userId,
    success: result.success
  });

  res.status(200).json({
    success: true,
    message: result.message,
    data: {
      connected: result.success,
      version: result.version,
      vendor: result.vendor || olt.brand,
      oltStatus: olt.status,
      lastChecked: olt.lastChecked,
      gponSlots: olt.gponSlots,
      boards: olt.discoveredBoards || [],
      changes
    }
  });
});

/**
 * @desc    Get OLT system information
 * @route   GET /api/olts/:id/system-info
 * @access  Private
 */
exports.getSystemInfo = asyncHandler(async (req, res, next) => {
  const olt = await OLT.findById(req.params.id).select('+password');

  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  console.log(`\n📊 Getting system info for ${olt.brand.toUpperCase()} OLT: ${olt.name}`);

  const result = await oltService.getSystemInfo(olt);

  if (!result.success) {
    return next(new ErrorResponse(`Failed to get system info: ${result.error}`, 500));
  }

  res.status(200).json({
    success: true,
    message: 'System information retrieved successfully',
    data: {
      oltName: olt.name,
      brand: olt.brand,
      systemInfo: result.data
    }
  });
});

/**
 * @desc    Get PON ports status
 * @route   GET /api/olts/:id/pon-ports
 * @access  Private
 */
exports.getPonPorts = asyncHandler(async (req, res, next) => {
  const olt = await OLT.findById(req.params.id).select('+password');

  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  console.log(`\n📡 Getting PON ports for ${olt.brand.toUpperCase()} OLT: ${olt.name}`);

  const result = await oltService.getPonPorts(olt);

  if (!result.success) {
    return next(new ErrorResponse(`Failed to get PON ports: ${result.error}`, 500));
  }

  // Get ONU count per port
  const portsWithCounts = await Promise.all(
    result.ports.map(async (port, index) => {
      const onuCount = await ONU.countDocuments({ 
        oltId: olt._id, 
        ponPort: index,
        isActive: true
      });

      return {
        ...port,
        portNumber: index,
        onuCount,
        capacity: olt.maxOnusPerPort,
        available: olt.maxOnusPerPort - onuCount
      };
    })
  );

  res.status(200).json({
    success: true,
    message: 'PON ports retrieved successfully',
    data: {
      oltName: olt.name,
      totalPorts: olt.ponPorts,
      ports: portsWithCounts
    }
  });
});

// ============================================
// ONU OPERATIONS
// ============================================

/**
 * @desc    Get all ONUs on OLT
 * @route   GET /api/olts/:id/onus
 * @access  Private
 */
exports.getOnus = asyncHandler(async (req, res, next) => {
  const olt = await OLT.findById(req.params.id).select('+password');

  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  const { source = 'database', ponPort } = req.query;

  let onus = [];

  if (source === 'device') {
    // Get ONUs directly from OLT device
    console.log(`\n📡 Getting ONUs from ${olt.brand.toUpperCase()} OLT device: ${olt.name}`);

    let result;
    if (ponPort !== undefined) {
      result = await oltService.getOnusOnPort(olt, parseInt(ponPort));
    } else {
      result = await oltService.getAllOnus(olt);
    }

    if (!result.success) {
      return next(new ErrorResponse(`Failed to get ONUs from device: ${result.error}`, 500));
    }

    onus = result.onus;

  } else {
    // Get ONUs from database
    const query = { oltId: olt._id };
    if (ponPort !== undefined) {
      query.ponPort = parseInt(ponPort);
    }

    onus = await ONU.find(query)
      .populate('customerId', 'firstName lastName accountId phoneNumber')
      .sort({ ponPort: 1, onuId: 1 })
      .lean();
  }

  res.status(200).json({
    success: true,
    message: `ONUs retrieved from ${source}`,
    data: {
      oltName: olt.name,
      source,
      count: onus.length,
      onus
    }
  });
});

/**
 * @desc    Get unconfigured ONUs (discovered but not authorized)
 * @route   GET /api/olts/:id/unconfigured-onus
 * @access  Private
 */
exports.getUnconfiguredOnus = asyncHandler(async (req, res, next) => {
  const olt = await OLT.findById(req.params.id).select('+password');

  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  console.log(`\n🔍 Discovering unconfigured ONUs on ${olt.brand.toUpperCase()} OLT: ${olt.name}`);

  const result = await oltService.getUnconfiguredOnus(olt);

  if (!result.success) {
    return next(new ErrorResponse(`Failed to discover ONUs: ${result.error}`, 500));
  }

  // Check which ONUs are already in database
  const unconfiguredWithStatus = await Promise.all(
    result.onus.map(async (onu) => {
      const existingOnu = await ONU.findOne({ 
        serialNumber: onu.serialNumber 
      });

      return {
        ...onu,
        existsInDatabase: !!existingOnu,
        onuId: existingOnu?._id,
        customerId: existingOnu?.customerId
      };
    })
  );

  res.status(200).json({
    success: true,
    message: 'Unconfigured ONUs retrieved successfully',
    data: {
      oltName: olt.name,
      count: unconfiguredWithStatus.length,
      onus: unconfiguredWithStatus
    }
  });
});

/**
 * @desc    Get ONU details from device
 * @route   GET /api/olts/:id/onus/:ponPort/:onuId
 * @access  Private
 */
exports.getOnuDetails = asyncHandler(async (req, res, next) => {
  const olt = await OLT.findById(req.params.id).select('+password');

  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  const { ponPort, onuId } = req.params;

  console.log(`\n🔍 Getting ONU details: ${olt.name} - Port ${ponPort}, ONU ${onuId}`);

  const result = await oltService.getOnuDetails(
    olt, 
    parseInt(ponPort), 
    parseInt(onuId)
  );

  if (!result.success) {
    return next(new ErrorResponse(`Failed to get ONU details: ${result.error}`, 500));
  }

  // Get optical power
  const powerResult = await oltService.getOnuOpticalPower(
    olt,
    parseInt(ponPort),
    parseInt(onuId)
  );

  res.status(200).json({
    success: true,
    message: 'ONU details retrieved successfully',
    data: {
      oltName: olt.name,
      ponPort: parseInt(ponPort),
      onuId: parseInt(onuId),
      details: result.data,
      opticalPower: powerResult.success ? {
        rxPower: powerResult.rxPower,
        txPower: powerResult.txPower
      } : null
    }
  });
});

/**
 * @desc    Find best available PON port
 * @route   GET /api/olts/:id/available-port
 * @access  Private
 */
exports.findAvailablePort = asyncHandler(async (req, res, next) => {
  const olt = await OLT.findById(req.params.id);

  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  console.log(`\n🔍 Finding available PON port on ${olt.name}`);

  // Get ONU count per port
  const portUtilization = [];

  for (let port = 0; port < olt.ponPorts; port++) {
    const onuCount = await ONU.countDocuments({
      oltId: olt._id,
      ponPort: port,
      isActive: true
    });

    portUtilization.push({
      port,
      onuCount,
      capacity: olt.maxOnusPerPort,
      available: olt.maxOnusPerPort - onuCount,
      utilizationPercent: ((onuCount / olt.maxOnusPerPort) * 100).toFixed(2)
    });
  }

  // Sort by lowest utilization
  portUtilization.sort((a, b) => a.onuCount - b.onuCount);

  const bestPort = portUtilization[0];

  if (bestPort.available === 0) {
    return next(new ErrorResponse('No available ports. All ports are at capacity.', 400));
  }

  res.status(200).json({
    success: true,
    message: 'Available port found',
    data: {
      recommendedPort: bestPort.port,
      availableSlots: bestPort.available,
      currentOnus: bestPort.onuCount,
      capacity: bestPort.capacity,
      allPorts: portUtilization
    }
  });
});

/**
 * @desc    Test connection with credentials (for OLT onboarding)
 * @route   POST /api/olts/test-credentials
 * @access  Private
 */
exports.testCredentials = asyncHandler(async (req, res, next) => {
  const { ip, port, username, password, brand } = req.body;

  if (!ip || !username || !password || !brand) {
    return next(new ErrorResponse('Please provide ip, username, password, and brand', 400));
  }

  // Validate brand
  if (!oltService.isVendorSupported(brand)) {
    return next(new ErrorResponse(
      `Unsupported OLT brand: ${brand}. Supported brands: ${oltService.getSupportedVendors().join(', ')}`,
      400
    ));
  }

  console.log(`\n🔌 Testing credentials for ${brand.toUpperCase()} OLT at ${ip}`);

  // Create temporary OLT object
  const tempOlt = {
    name: 'Test Connection',
    brand: brand.toLowerCase(),
    ip,
    port: port || (brand.toLowerCase() === 'zte' ? 23 : 22),
    username,
    password
  };

  const result = await oltService.testConnection(tempOlt);

  res.status(200).json({
    success: true,
    message: result.message,
    data: {
      connected: result.success,
      vendor: result.vendor || brand,
      version: result.version,
      error: result.error
    }
  });
});

/**
 * @desc    Authorize an autofind ONU using Skylink custom baseline profiles
 * @route   POST /api/olts/:id/authorize-skylink
 * @access  Private
 */
exports.authorizeOnuSkylink = asyncHandler(async (req, res, next) => {
  const { ponPort, sn, desc, mgmtVlan, lineProfileId, serviceProfileId } = req.body;

  if (ponPort === undefined || !sn || !desc || !mgmtVlan) {
    return next(new ErrorResponse('Please provide ponPort, sn, desc, and mgmtVlan', 400));
  }

  // 1. Fetch OLT document (including password for the Netmiko session)
  const olt = await OLT.findById(req.params.id).select('+password');
  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT', req.params.id), 404));
  }

  console.log(`🚀 [Skylink Engine] Starting authorization for SN ${sn} on OLT ${olt.name}`);

  // 2. Fire the hardware provisioning steps on the OLT.
  // lineProfileId/serviceProfileId are optional overrides — defaults inside
  // authorizeNewOnuSkylink use the SkyLink baseline line profile and the
  // adaptive service profile (matches any ONT model, avoids POTS-count mismatches).
  const provisionResult = await oltService.authorizeNewOnuSkylink(olt, {
    ponPort: parseInt(ponPort, 10),
    sn,
    desc,
    mgmtVlan: parseInt(mgmtVlan, 10),
    ...(lineProfileId !== undefined && { lineProfileId: parseInt(lineProfileId, 10) }),
    ...(serviceProfileId !== undefined && { serviceProfileId: parseInt(serviceProfileId, 10) })
  });

  if (!provisionResult.success) {
    return next(new ErrorResponse(`Hardware Provisioning Failed: ${provisionResult.error}`, 500));
  }

  // 3. Save the synchronized reality into your Mongo collections.
  // Upsert on serialNumber rather than blind create — a SN can legitimately be
  // re-authorized (deleted from OLT and re-added, moved to a different port,
  // re-registered after a factory reset) without colliding with a stale record.
  const newOnu = await ONU.findOneAndUpdate(
    { serialNumber: sn },
    {
      oltId: olt._id,
      siteId: olt.siteId,
      regionCode: olt.regionCode,
      ponPort: parseInt(ponPort, 10),
      onuId: provisionResult.onuId,
      serialNumber: sn,
      brand: 'huawei',
      notes: desc,
      servicePortIndex: provisionResult.servicePortIndex,
      managementIp: provisionResult.managementIp || undefined,
      vlan: parseInt(mgmtVlan, 10),
      status: 'offline', // flips to 'online' once TR-069 informs / DHCP completes
      authStatus: 'authorized',
      authorizedAt: new Date()
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  // 4. Log the system modification activity
  await SystemLog.create({
    eventType: "admin_action",
    severity: "info",
    regionCode: olt.regionCode,
    entityType: "onu",
    entityId: newOnu._id,
    
    message: provisionResult.managementIp
      ? `Onu authorised, record created, management IP ${provisionResult.managementIp} assigned`
      : `Onu authorised and record created (management IP pending DHCP)`,
    triggeredBy: req.session.userId,
    success: true,
  });


  res.status(201).json({
    success: true,
    message: 'ONU successfully authorized and management framework deployed',
    data: newOnu
  });
});

module.exports = exports;