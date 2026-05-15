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

  const olts = await OLT.find(query)
    .populate('siteId', 'siteName regionCode location')
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
    .populate('siteId', 'siteName regionCode location router')
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
  const {
    name,
    description,
    siteId,
    regionCode,
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
    monitoring
  } = req.body;

  // Validate required fields
  if (!name || !siteId || !regionCode || !ip || !username || !password || !brand) {
    return next(new ErrorResponse(
      'Please provide all required fields: name, siteId, regionCode, ip, username, password, brand', 
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

  // Check if site exists
  const site = await Site.findById(siteId);
  if (!site) {
    return next(new ErrorResponse(getResourceNotFoundMessage('Site'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && site.regionCode !== regionCode.toUpperCase()) {
    return next(new ErrorResponse('Access denied: OLT region does not match your access', 403));
  }

  // Check if OLT with same IP already exists
  const existingOlt = await OLT.findOne({ ip });
  if (existingOlt) {
    return next(new ErrorResponse(`OLT with IP ${ip} already exists`, 400));
  }

  // Check if serial number already exists (if provided)
  if (serialNumber) {
    const existingSerial = await OLT.findOne({ serialNumber });
    if (existingSerial) {
      return next(new ErrorResponse(`OLT with serial number ${serialNumber} already exists`, 400));
    }
  }

  // Set default port based on brand
  let defaultPort = port || 22;
  if (brand.toLowerCase() === 'zte' && !port) {
    defaultPort = 23; // ZTE often uses Telnet
  }

  // Create OLT
  const olt = await OLT.create({
    name,
    description,
    siteId,
    regionCode: regionCode.toUpperCase(),
    ip,
    port: defaultPort,
    username,
    password,
    brand: brand.toLowerCase(),
    model,
    serialNumber,
    firmwareVersion,
    ponPorts: ponPorts || 16,
    maxOnusPerPort: maxOnusPerPort || 128,
    location,
    contactPerson,
    vlanRange,
    managementVlan,
    monitoring: monitoring || {
      enabled: true,
      interval: 300,
      alertOnOffline: true
    },
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
    message: `OLT ${olt.name} created at site ${site.siteName}`,
    details: {
      oltId: olt._id,
      oltName: olt.name,
      brand: olt.brand,
      siteId: site._id,
      siteName: site.siteName,
      ip: olt.ip
    },
    triggeredBy: req.session.userId,
    success: true
  });

  // Don't send password in response
  olt.password = undefined;

  res.status(201).json({
    success: true,
    message: 'OLT created successfully',
    data: olt
  });
});

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

  // Update fields
  if (name) olt.name = name;
  if (description !== undefined) olt.description = description;
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

  // Test connection using vendor-specific service
  const result = await oltService.testConnection(olt);

  // Update OLT status
  if (result.success) {
    olt.status = 'online';
    olt.lastOnline = new Date();
    olt.lastChecked = new Date();
    if (result.version) {
      olt.firmwareVersion = result.version;
    }
  } else {
    olt.status = 'offline';
    olt.lastChecked = new Date();
  }

  await olt.save();

  // Log test
  await SystemLog.create({
    eventType: 'olt_connection_test',
    severity: result.success ? 'info' : 'warning',
    regionCode: olt.regionCode,
    entityType: 'olt',
    entityId: olt._id,
    message: `Connection test ${result.success ? 'successful' : 'failed'} for OLT ${olt.name}`,
    details: {
      result,
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
      lastChecked: olt.lastChecked
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

module.exports = exports;