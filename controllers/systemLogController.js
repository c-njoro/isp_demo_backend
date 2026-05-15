const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const SystemLog = require('../models/SystemLog');

/**
 * @desc    Get all system logs with filtering and pagination
 * @route   GET /api/system-logs
 * @access  Private (admin only)
 */
exports.getSystemLogs = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 50,
    eventType,
    severity,
    entityType,
    entityId,
    accountId,
    regionCode,
    success,
    startDate,
    endDate,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  // Build query
  const query = {};

  // Apply region filter (if user is region-specific)
  if (req.regionFilter?.regionCode) {
    query.regionCode = req.regionFilter.regionCode;
  }

  // Filter by event type
  if (eventType) {
    query.eventType = eventType;
  }

  // Filter by severity
  if (severity) {
    query.severity = severity;
  }

  // Filter by entity type
  if (entityType) {
    query.entityType = entityType;
  }

  // Filter by specific entity ID
  if (entityId) {
    query.entityId = entityId;
  }

  // Filter by account ID
  if (accountId) {
    query.accountId = { $regex: accountId, $options: 'i' };
  }

  // Filter by region code (if provided in query)
  if (regionCode) {
    query.regionCode = regionCode;
  }

  // Filter by success/failure
  if (success !== undefined) {
    query.success = success === 'true';
  }

  // Filter by date range
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(endDate);
    }
  }

  // Search in message
  if (search) {
    query.message = { $regex: search, $options: 'i' };
  }

  // Count total documents
  const total = await SystemLog.countDocuments(query);

  // Build sort object
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Execute query with pagination
  const logs = await SystemLog.find(query)
    .sort(sort)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .populate('relatedTransactionId', 'amount status transactionId')
    .populate('relatedPaymentId', 'amount status receiptNumber')
    .lean();

  // Calculate pagination info
  const pages = Math.ceil(total / parseInt(limit));

  res.status(200).json({
    success: true,
    message: 'System logs retrieved successfully',
    data: {
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages,
        hasMore: parseInt(page) < pages
      }
    }
  });
});

/**
 * @desc    Get a single system log by ID
 * @route   GET /api/system-logs/:id
 * @access  Private (admin only)
 */
exports.getSystemLog = asyncHandler(async (req, res, next) => {
  const log = await SystemLog.findById(req.params.id)
    .populate('relatedTransactionId')
    .populate('relatedPaymentId');

  if (!log) {
    return next(new ErrorResponse('System log not found', 404));
  }

  // Check region access
  if (req.regionFilter?.regionCode && log.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this log', 403));
  }

  res.status(200).json({
    success: true,
    message: 'System log retrieved successfully',
    data: log
  });
});

/**
 * @desc    Get system logs statistics/summary
 * @route   GET /api/system-logs/stats
 * @access  Private (admin only)
 */
exports.getSystemLogStats = asyncHandler(async (req, res, next) => {
  const { startDate, endDate, regionCode } = req.query;

  // Build match query
  const matchQuery = {};

  // Apply region filter
  if (req.regionFilter?.regionCode) {
    matchQuery.regionCode = req.regionFilter.regionCode;
  } else if (regionCode) {
    matchQuery.regionCode = regionCode;
  }

  // Apply date filter
  if (startDate || endDate) {
    matchQuery.createdAt = {};
    if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
    if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
  }

  // Aggregate statistics
  const stats = await SystemLog.aggregate([
    { $match: matchQuery },
    {
      $facet: {
        // Total counts
        totalCounts: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              successful: { $sum: { $cond: ['$success', 1, 0] } },
              failed: { $sum: { $cond: ['$success', 0, 1] } }
            }
          }
        ],
        
        // By event type
        byEventType: [
          {
            $group: {
              _id: '$eventType',
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ],
        
        // By severity
        bySeverity: [
          {
            $group: {
              _id: '$severity',
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } }
        ],
        
        // By region
        byRegion: [
          {
            $group: {
              _id: '$regionCode',
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } }
        ],
        
        // Recent errors
        recentErrors: [
          { $match: { success: false } },
          { $sort: { createdAt: -1 } },
          { $limit: 10 },
          {
            $project: {
              eventType: 1,
              message: 1,
              severity: 1,
              createdAt: 1,
              error: 1
            }
          }
        ],
        
        // Activity over time (last 7 days)
        activityTimeline: [
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
              },
              count: { $sum: 1 },
              errors: { $sum: { $cond: ['$success', 0, 1] } }
            }
          },
          { $sort: { _id: -1 } },
          { $limit: 7 }
        ]
      }
    }
  ]);

  const result = stats[0];

  res.status(200).json({
    success: true,
    message: 'System log statistics retrieved successfully',
    data: {
      summary: result.totalCounts[0] || { total: 0, successful: 0, failed: 0 },
      byEventType: result.byEventType,
      bySeverity: result.bySeverity,
      byRegion: result.byRegion,
      recentErrors: result.recentErrors,
      activityTimeline: result.activityTimeline.reverse()
    }
  });
});

/**
 * @desc    Get logs for a specific entity
 * @route   GET /api/system-logs/entity/:entityType/:entityId
 * @access  Private (admin only)
 */
exports.getEntityLogs = asyncHandler(async (req, res, next) => {
  const { entityType, entityId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const query = {
    entityType,
    entityId
  };

  // Apply region filter
  if (req.regionFilter?.regionCode) {
    query.regionCode = req.regionFilter.regionCode;
  }

  const total = await SystemLog.countDocuments(query);

  const logs = await SystemLog.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .lean();

  const pages = Math.ceil(total / parseInt(limit));

  res.status(200).json({
    success: true,
    message: 'Entity logs retrieved successfully',
    data: {
      entityType,
      entityId,
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages
      }
    }
  });
});

/**
 * @desc    Get logs by account ID
 * @route   GET /api/system-logs/account/:accountId
 * @access  Private (admin only)
 */
exports.getAccountLogs = asyncHandler(async (req, res, next) => {
  const { accountId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const query = { accountId };

  // Apply region filter
  if (req.regionFilter?.regionCode) {
    query.regionCode = req.regionFilter.regionCode;
  }

  const total = await SystemLog.countDocuments(query);

  const logs = await SystemLog.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .lean();

  const pages = Math.ceil(total / parseInt(limit));

  res.status(200).json({
    success: true,
    message: 'Account logs retrieved successfully',
    data: {
      accountId,
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages
      }
    }
  });
});

/**
 * @desc    Delete old system logs (cleanup)
 * @route   DELETE /api/system-logs/cleanup
 * @access  Private (super_admin only)
 */
exports.cleanupOldLogs = asyncHandler(async (req, res, next) => {
  const { olderThan = 90 } = req.query; // Default: delete logs older than 90 days

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - parseInt(olderThan));

  const result = await SystemLog.deleteMany({
    createdAt: { $lt: cutoffDate }
  });

  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'info',
    entityType: 'admin',
    message: `System logs cleanup: Deleted ${result.deletedCount} logs older than ${olderThan} days`,
    details: {
      deletedCount: result.deletedCount,
      cutoffDate,
      olderThanDays: olderThan
    },
    triggeredBy: req.session.userId,
    success: true
  });

  res.status(200).json({
    success: true,
    message: 'Old system logs deleted successfully',
    data: {
      deletedCount: result.deletedCount,
      cutoffDate
    }
  });
});

/**
 * @desc    Export system logs to CSV
 * @route   GET /api/system-logs/export
 * @access  Private (admin only)
 */
exports.exportSystemLogs = asyncHandler(async (req, res, next) => {
  const {
    eventType,
    severity,
    startDate,
    endDate,
    regionCode
  } = req.query;

  // Build query
  const query = {};

  if (req.regionFilter?.regionCode) {
    query.regionCode = req.regionFilter.regionCode;
  } else if (regionCode) {
    query.regionCode = regionCode;
  }

  if (eventType) query.eventType = eventType;
  if (severity) query.severity = severity;

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const logs = await SystemLog.find(query)
    .sort({ createdAt: -1 })
    .limit(10000) // Limit export to 10k records
    .lean();

  // Convert to CSV
  const csv = convertLogsToCSV(logs);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=system-logs-${Date.now()}.csv`);
  res.status(200).send(csv);
});

// Helper function to convert logs to CSV
function convertLogsToCSV(logs) {
  if (logs.length === 0) return 'No logs found';

  const headers = [
    'Date',
    'Event Type',
    'Severity',
    'Region',
    'Entity Type',
    'Entity ID',
    'Account ID',
    'Message',
    'Success',
    'Triggered By'
  ];

  const rows = logs.map(log => [
    new Date(log.createdAt).toISOString(),
    log.eventType,
    log.severity,
    log.regionCode || '',
    log.entityType || '',
    log.entityId || '',
    log.accountId || '',
    `"${(log.message || '').replace(/"/g, '""')}"`, // Escape quotes
    log.success ? 'Yes' : 'No',
    log.triggeredBy || ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  return csvContent;
}