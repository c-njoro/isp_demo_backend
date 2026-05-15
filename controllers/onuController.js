const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const { getResourceNotFoundMessage } = require('../utils/errorMessages');
const ONU = require('../models/ONU');
const OLT = require('../models/OLT');
const Customer = require('../models/Customer');
const SystemLog = require('../models/SystemLog');
const oltService = require('../services/olt');

// ============================================
// ONU CRUD OPERATIONS
// ============================================

/**
 * @desc    Get all ONUs with filters
 * @route   GET /api/onus
 * @access  Private
 */
exports.getOnus = asyncHandler(async (req, res, next) => {
  const {
    oltId,
    siteId,
    customerId,
    status,
    isProvisioned,
    isActive,
    ponPort,
    search,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  const query = { ...req.regionFilter };

  if (oltId) query.oltId = oltId;
  if (siteId) query.siteId = siteId;
  if (customerId) query.customerId = customerId;
  if (status) query.status = status;
  if (isProvisioned !== undefined) query.isProvisioned = isProvisioned === 'true';
  if (isActive !== undefined) query.isActive = isActive === 'true';
  if (ponPort) query.ponPort = parseInt(ponPort);

  if (search) {
    query.$or = [
      { serialNumber: { $regex: search, $options: 'i' } },
      { macAddress: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } },
      { customerPhone: { $regex: search, $options: 'i' } },
      { accountId: { $regex: search, $options: 'i' } }
    ];
  }

  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  const onus = await ONU.find(query)
    .populate('oltId', 'name ip brand model')
    .populate('customerId', 'firstName lastName accountId phoneNumber')
    .populate('siteId', 'siteName')
    .sort(sort)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .lean();

  const total = await ONU.countDocuments(query);

  res.status(200).json({
    success: true,
    message: 'ONUs retrieved successfully',
    data: {
      onus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

/**
 * @desc    Get single ONU by ID
 * @route   GET /api/onus/:id
 * @access  Private
 */
exports.getOnu = asyncHandler(async (req, res, next) => {
  const onu = await ONU.findById(req.params.id)
    .populate('oltId', 'name ip brand model ponPorts')
    .populate('customerId', 'firstName lastName accountId phoneNumber email location')
    .populate('siteId', 'siteName regionCode');

  if (!onu) {
    return next(new ErrorResponse(getResourceNotFoundMessage('ONU'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && onu.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ONU', 403));
  }

  res.status(200).json({
    success: true,
    message: 'ONU retrieved successfully',
    data: onu
  });
});

/**
 * @desc    Create/Provision new ONU
 * @route   POST /api/onus
 * @access  Private
 */
exports.createOnu = asyncHandler(async (req, res, next) => {
  const {
    oltId,
    customerId,
    serialNumber,
    ponPort,
    onuId,
    vlan,
    brand,
    model,
    description
  } = req.body;

  // Validate required fields
  if (!oltId || !serialNumber || !ponPort || !onuId || !vlan) {
    return next(new ErrorResponse(
      'Please provide all required fields: oltId, serialNumber, ponPort, onuId, vlan',
      400
    ));
  }

  // Get OLT with password
  const olt = await OLT.findById(oltId).select('+password');
  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  // Check if serial number already exists
  const existingOnu = await ONU.findOne({ serialNumber: serialNumber.toUpperCase() });
  if (existingOnu) {
    return next(new ErrorResponse('ONU with this serial number already exists', 400));
  }

  // Check if position (ponPort + onuId) is already occupied
  const existingPosition = await ONU.findOne({
    oltId,
    ponPort: parseInt(ponPort),
    onuId: parseInt(onuId),
    isActive: true
  });
  if (existingPosition) {
    return next(new ErrorResponse(
      `Position PON ${ponPort}/${onuId} is already occupied`,
      400
    ));
  }

  // Get customer if provided
  let customer = null;
  if (customerId) {
    customer = await Customer.findById(customerId);
    if (!customer) {
      return next(new ErrorResponse(getResourceNotFoundMessage('Customer'), 404));
    }
  }

  console.log(`\n🔧 Provisioning ONU on ${olt.brand.toUpperCase()} OLT: ${olt.name}`);
  console.log(`   Serial: ${serialNumber}`);
  console.log(`   Position: PON ${ponPort}/${onuId}`);

  let provisionResult = null;

  try {
    // Authorize ONU on OLT device
    const authResult = await oltService.authorizeOnu(
      olt,
      serialNumber.toUpperCase(),
      parseInt(ponPort),
      parseInt(onuId)
    );

    if (!authResult.success) {
      throw new Error(`OLT authorization failed: ${authResult.error || 'Unknown error'}`);
    }

    console.log('✅ ONU authorized on OLT device');

    // Provision full configuration
    provisionResult = await oltService.provisionOnu(olt, {
      serialNumber: serialNumber.toUpperCase(),
      ponPort: parseInt(ponPort),
      onuId: parseInt(onuId),
      vlanId: parseInt(vlan),
      description: description || (customer ? `${customer.firstName} ${customer.lastName}` : 'ONU')
    });

    if (!provisionResult.success) {
      console.warn(`⚠️  Provisioning warning: ${provisionResult.error}`);
    } else {
      console.log('✅ ONU provisioned with configuration');
    }

  } catch (error) {
    console.error('❌ OLT operation failed:', error.message);
    return next(new ErrorResponse(
      `Failed to provision ONU on OLT: ${error.message}`,
      500
    ));
  }

  // Create ONU record in database
  const onu = await ONU.create({
    oltId,
    siteId: olt.siteId,
    regionCode: olt.regionCode,
    customerId: customerId || null,
    serialNumber: serialNumber.toUpperCase(),
    ponPort: parseInt(ponPort),
    onuId: parseInt(onuId),
    vlan: parseInt(vlan),
    brand: brand || 'unknown',
    model: model || 'unknown',
    status: 'online',
    authStatus: 'authorized',
    isProvisioned: true,
    isActive: true,
    customerName: customer ? `${customer.firstName} ${customer.lastName}` : null,
    customerPhone: customer?.phoneNumber || null,
    accountId: customer?.accountId || null,
    installedAt: new Date(),
    installedBy: req.session.userId,
    createdBy: req.session.userId
  });

  // Log creation
  await SystemLog.create({
    eventType: 'onu_created',
    severity: 'info',
    regionCode: onu.regionCode,
    entityType: 'onu',
    entityId: onu._id,
    message: `ONU ${serialNumber} provisioned on ${olt.name} at PON ${ponPort}/${onuId}`,
    details: {
      onuId: onu._id,
      serialNumber,
      oltId: olt._id,
      oltName: olt.name,
      ponPort,
      onuId: parseInt(onuId),
      customerId
    },
    triggeredBy: req.session.userId,
    success: true
  });

  await onu.populate('oltId customerId');

  res.status(201).json({
    success: true,
    message: 'ONU created and provisioned successfully',
    data: onu
  });
});

/**
 * @desc    Update ONU
 * @route   PUT /api/onus/:id
 * @access  Private
 */
exports.updateOnu = asyncHandler(async (req, res, next) => {
  let onu = await ONU.findById(req.params.id);

  if (!onu) {
    return next(new ErrorResponse(getResourceNotFoundMessage('ONU'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && onu.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ONU', 403));
  }

  const {
    customerId,
    vlan,
    bandwidth,
    brand,
    model,
    location,
    installation,
    notes,
    isActive
  } = req.body;

  let updateOnDevice = false;
  const olt = await OLT.findById(onu.oltId).select('+password');

  // Update VLAN if changed
  if (vlan && vlan !== onu.vlan) {
    console.log(`\n🔧 Updating VLAN on ${olt.brand.toUpperCase()} OLT`);
    
    try {
      const result = await oltService.setOnuVlan(
        olt,
        onu.ponPort,
        onu.onuId,
        parseInt(vlan)
      );

      if (result.success) {
        onu.vlan = parseInt(vlan);
        console.log('✅ VLAN updated on device');
      } else {
        console.warn(`⚠️  VLAN update failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ VLAN update error:', error.message);
    }
  }

  // Update bandwidth if provided
  if (bandwidth) {
    console.log(`\n🔧 Updating bandwidth on ${olt.brand.toUpperCase()} OLT`);
    
    try {
      const result = await oltService.setOnuBandwidth(
        olt,
        onu.ponPort,
        onu.onuId,
        {
          upstreamMbps: bandwidth.upload,
          downstreamMbps: bandwidth.download
        }
      );

      if (result.success) {
        onu.bandwidth = bandwidth;
        console.log('✅ Bandwidth updated on device');
      } else {
        console.warn(`⚠️  Bandwidth update failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Bandwidth update error:', error.message);
    }
  }

  // Update other fields
  if (customerId) {
    const customer = await Customer.findById(customerId);
    if (customer) {
      onu.customerId = customerId;
      onu.customerName = `${customer.firstName} ${customer.lastName}`;
      onu.customerPhone = customer.phoneNumber;
      onu.accountId = customer.accountId;
    }
  }

  if (brand) onu.brand = brand;
  if (model) onu.model = model;
  if (location) onu.location = { ...onu.location, ...location };
  if (installation) onu.installation = { ...onu.installation, ...installation };
  if (notes) onu.notes = notes;
  if (typeof isActive !== 'undefined') onu.isActive = isActive;

  onu.updatedBy = req.session.userId;
  await onu.save();

  // Log update
  await SystemLog.create({
    eventType: 'onu_updated',
    severity: 'info',
    regionCode: onu.regionCode,
    entityType: 'onu',
    entityId: onu._id,
    message: `ONU ${onu.serialNumber} updated`,
    triggeredBy: req.session.userId,
    success: true
  });

  await onu.populate('oltId customerId');

  res.status(200).json({
    success: true,
    message: 'ONU updated successfully',
    data: onu
  });
});

/**
 * @desc    Delete/Remove ONU
 * @route   DELETE /api/onus/:id
 * @access  Private
 */
exports.deleteOnu = asyncHandler(async (req, res, next) => {
  const onu = await ONU.findById(req.params.id);

  if (!onu) {
    return next(new ErrorResponse(getResourceNotFoundMessage('ONU'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && onu.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ONU', 403));
  }

  const olt = await OLT.findById(onu.oltId).select('+password');
  if (!olt) {
    return next(new ErrorResponse('Associated OLT not found', 404));
  }

  console.log(`\n🗑️  Removing ONU from ${olt.brand.toUpperCase()} OLT: ${olt.name}`);
  console.log(`   Serial: ${onu.serialNumber}`);
  console.log(`   Position: PON ${onu.ponPort}/${onu.onuId}`);

  // Deauthorize on OLT device
  try {
    const result = await oltService.deauthorizeOnu(olt, onu.ponPort, onu.onuId);
    
    if (result.success) {
      console.log('✅ ONU deauthorized from OLT device');
    } else {
      console.warn(`⚠️  Deauthorization warning: ${result.error}`);
    }
  } catch (error) {
    console.error('❌ Deauthorization failed:', error.message);
    // Continue with database deletion even if device operation fails
  }

  // Delete from database
  await onu.deleteOne();

  // Log deletion
  await SystemLog.create({
    eventType: 'onu_deleted',
    severity: 'warning',
    regionCode: onu.regionCode,
    entityType: 'onu',
    entityId: onu._id,
    message: `ONU ${onu.serialNumber} removed from ${olt.name}`,
    details: {
      serialNumber: onu.serialNumber,
      oltId: olt._id,
      oltName: olt.name,
      ponPort: onu.ponPort,
      onuId: onu.onuId
    },
    triggeredBy: req.session.userId,
    success: true
  });

  res.status(200).json({
    success: true,
    message: 'ONU removed successfully'
  });
});

// ============================================
// ONU OPERATIONS
// ============================================

/**
 * @desc    Reboot ONU
 * @route   POST /api/onus/:id/reboot
 * @access  Private
 */
exports.rebootOnu = asyncHandler(async (req, res, next) => {
  const onu = await ONU.findById(req.params.id);

  if (!onu) {
    return next(new ErrorResponse(getResourceNotFoundMessage('ONU'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && onu.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ONU', 403));
  }

  const olt = await OLT.findById(onu.oltId).select('+password');
  if (!olt) {
    return next(new ErrorResponse('Associated OLT not found', 404));
  }

  console.log(`\n🔄 Rebooting ONU on ${olt.brand.toUpperCase()} OLT`);
  console.log(`   Serial: ${onu.serialNumber}`);
  console.log(`   Position: PON ${onu.ponPort}/${onu.onuId}`);

  try {
    const result = await oltService.rebootOnu(olt, onu.ponPort, onu.onuId);

    if (!result.success) {
      throw new Error(result.error || 'Reboot failed');
    }

    console.log('✅ ONU reboot command sent');

    // Update ONU status
    onu.status = 'offline';
    onu.lastOffline = new Date();
    await onu.save();

    // Log reboot
    await SystemLog.create({
      eventType: 'onu_reboot',
      severity: 'info',
      regionCode: onu.regionCode,
      entityType: 'onu',
      entityId: onu._id,
      message: `ONU ${onu.serialNumber} rebooted`,
      triggeredBy: req.session.userId,
      success: true
    });

    res.status(200).json({
      success: true,
      message: 'ONU reboot command sent successfully'
    });

  } catch (error) {
    console.error('❌ Reboot failed:', error.message);
    return next(new ErrorResponse(`Failed to reboot ONU: ${error.message}`, 500));
  }
});

/**
 * @desc    Get ONU status from device
 * @route   GET /api/onus/:id/status
 * @access  Private
 */
exports.getOnuStatus = asyncHandler(async (req, res, next) => {
  const onu = await ONU.findById(req.params.id)
    .populate('oltId', 'name ip brand')
    .populate('customerId', 'firstName lastName accountId');

  if (!onu) {
    return next(new ErrorResponse(getResourceNotFoundMessage('ONU'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && onu.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ONU', 403));
  }

  const olt = await OLT.findById(onu.oltId).select('+password');
  if (!olt) {
    return next(new ErrorResponse('Associated OLT not found', 404));
  }

  console.log(`\n📊 Getting ONU status from ${olt.brand.toUpperCase()} OLT`);
  console.log(`   Serial: ${onu.serialNumber}`);

  try {
    // Get detailed status
    const detailsResult = await oltService.getOnuDetails(
      olt,
      onu.ponPort,
      onu.onuId
    );

    // Get optical power
    const powerResult = await oltService.getOnuOpticalPower(
      olt,
      onu.ponPort,
      onu.onuId
    );

    // Update ONU record with fresh data
    if (powerResult.success) {
      onu.signal = {
        rxPower: powerResult.rxPower ? `${powerResult.rxPower} dBm` : null,
        txPower: powerResult.txPower ? `${powerResult.txPower} dBm` : null
      };
      onu.lastSeen = new Date();
      await onu.save();
    }

    res.status(200).json({
      success: true,
      message: 'ONU status retrieved successfully',
      data: {
        onu: {
          id: onu._id,
          serialNumber: onu.serialNumber,
          ponPort: onu.ponPort,
          onuId: onu.onuId,
          status: onu.status,
          customer: onu.customerId
        },
        device: {
          details: detailsResult.data,
          opticalPower: powerResult.success ? {
            rxPower: powerResult.rxPower,
            txPower: powerResult.txPower
          } : null
        },
        olt: {
          name: olt.name,
          brand: olt.brand
        }
      }
    });

  } catch (error) {
    console.error('❌ Status retrieval failed:', error.message);
    return next(new ErrorResponse(`Failed to get ONU status: ${error.message}`, 500));
  }
});

/**
 * @desc    Synchronize ONU status with device
 * @route   POST /api/onus/:id/sync
 * @access  Private
 */
exports.syncOnuStatus = asyncHandler(async (req, res, next) => {
  const onu = await ONU.findById(req.params.id);

  if (!onu) {
    return next(new ErrorResponse(getResourceNotFoundMessage('ONU'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && onu.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ONU', 403));
  }

  const olt = await OLT.findById(onu.oltId).select('+password');
  if (!olt) {
    return next(new ErrorResponse('Associated OLT not found', 404));
  }

  console.log(`\n🔄 Syncing ONU status from ${olt.brand.toUpperCase()} OLT`);

  try {
    // Get details from device
    const detailsResult = await oltService.getOnuDetails(
      olt,
      onu.ponPort,
      onu.onuId
    );

    // Get optical power
    const powerResult = await oltService.getOnuOpticalPower(
      olt,
      onu.ponPort,
      onu.onuId
    );

    // Update database record
    onu.status = detailsResult.success ? 'online' : 'offline';
    onu.lastSeen = new Date();

    if (detailsResult.success) {
      onu.lastOnline = new Date();
    }

    if (powerResult.success) {
      onu.signal = {
        rxPower: powerResult.rxPower ? `${powerResult.rxPower} dBm` : null,
        txPower: powerResult.txPower ? `${powerResult.txPower} dBm` : null
      };
    }

    await onu.save();

    console.log('✅ ONU status synchronized');

    res.status(200).json({
      success: true,
      message: 'ONU status synchronized successfully',
      data: {
        status: onu.status,
        signal: onu.signal,
        lastSeen: onu.lastSeen
      }
    });

  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    return next(new ErrorResponse(`Failed to sync ONU: ${error.message}`, 500));
  }
});

/**
 * @desc    Bulk sync all ONUs on an OLT
 * @route   POST /api/onus/bulk-sync/:oltId
 * @access  Private (admin only)
 */
exports.bulkSyncOnus = asyncHandler(async (req, res, next) => {
  const { oltId } = req.params;

  const olt = await OLT.findById(oltId).select('+password');
  if (!olt) {
    return next(new ErrorResponse(getResourceNotFoundMessage('OLT'), 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && olt.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this OLT', 403));
  }

  console.log(`\n🔄 Bulk syncing ONUs from ${olt.brand.toUpperCase()} OLT: ${olt.name}`);

  // Get ONUs from database
  const dbOnus = await ONU.find({ oltId: olt._id, isActive: true });

  console.log(`   Found ${dbOnus.length} ONUs in database`);

  // Get ONUs from device
  const deviceResult = await oltService.getAllOnus(olt);

  if (!deviceResult.success) {
    return next(new ErrorResponse(`Failed to get ONUs from device: ${deviceResult.error}`, 500));
  }

  console.log(`   Found ${deviceResult.onus.length} ONUs on device`);

  const syncResults = {
    synced: 0,
    errors: 0,
    notFound: 0
  };

  // Sync each ONU
  for (const dbOnu of dbOnus) {
    const deviceOnu = deviceResult.onus.find(
      d => d.serialNumber === dbOnu.serialNumber
    );

    if (deviceOnu) {
      try {
        // Get optical power
        const powerResult = await oltService.getOnuOpticalPower(
          olt,
          dbOnu.ponPort,
          dbOnu.onuId
        );

        dbOnu.status = deviceOnu.status || 'online';
        dbOnu.lastSeen = new Date();
        dbOnu.lastOnline = new Date();

        if (powerResult.success) {
          dbOnu.signal = {
            rxPower: powerResult.rxPower ? `${powerResult.rxPower} dBm` : null,
            txPower: powerResult.txPower ? `${powerResult.txPower} dBm` : null
          };
        }

        await dbOnu.save();
        syncResults.synced++;
      } catch (error) {
        console.error(`❌ Sync error for ${dbOnu.serialNumber}:`, error.message);
        syncResults.errors++;
      }
    } else {
      // ONU not found on device - mark as offline
      dbOnu.status = 'offline';
      dbOnu.lastOffline = new Date();
      await dbOnu.save();
      syncResults.notFound++;
    }
  }

  console.log(`✅ Bulk sync complete: ${syncResults.synced} synced, ${syncResults.errors} errors, ${syncResults.notFound} not found`);

  res.status(200).json({
    success: true,
    message: 'Bulk sync completed',
    data: {
      oltName: olt.name,
      totalOnus: dbOnus.length,
      results: syncResults
    }
  });
});

/**
 * @desc    Get ONU statistics by site
 * @route   GET /api/onus/stats/site/:siteId
 * @access  Private
 */
exports.getOnuStatsBySite = asyncHandler(async (req, res, next) => {
  const { siteId } = req.params;

  const stats = await ONU.aggregate([
    { $match: { siteId: require('mongoose').Types.ObjectId(siteId), isActive: true } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const total = await ONU.countDocuments({ siteId, isActive: true });

  const formattedStats = {
    total,
    byStatus: {}
  };

  stats.forEach(stat => {
    formattedStats.byStatus[stat._id] = stat.count;
  });

  res.status(200).json({
    success: true,
    message: 'ONU statistics retrieved successfully',
    data: formattedStats
  });
});

module.exports = exports;