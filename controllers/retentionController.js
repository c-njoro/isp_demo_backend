const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Admin = require('../models/Admin');
const mongoose = require('mongoose');

/**
 * Helper: Build filter for retention entries based on query parameters.
 * @param {Object} query - req.query
 * @param {ObjectId} userId - optional (for filtering by calledBy)
 * @returns {Object} - MongoDB aggregation match stage for `retention` entries
 */
function buildRetentionMatchStage(query, userId = null) {
  const match = {};

  if (userId) match['retention.calledBy'] = userId;

  if (query.callStatus) match['retention.callStatus'] = query.callStatus;
  if (query.callType) match['retention.callType'] = query.callType;
  if (query.retentionOutcome) match['retention.retentionOutcome'] = query.retentionOutcome;
  if (query.serviceSatisfaction) match['retention.serviceSatisfaction'] = query.serviceSatisfaction;
  if (query.routerCollectionStatus) match['retention.routerCollection.status'] = query.routerCollectionStatus;
  if (query.accountAction) match['retention.accountAction'] = query.accountAction;

  // Date range
  if (query.startDate || query.endDate) {
    match['retention.callDate'] = {};
    if (query.startDate) match['retention.callDate'].$gte = new Date(query.startDate);
    if (query.endDate) match['retention.callDate'].$lte = new Date(query.endDate);
  }

  return match;
}

async function getAllStaff() {
  const User = require('../models/User');
  const Admin = require('../models/Admin');
  const [users, admins] = await Promise.all([
    User.find({ isActive: true }).select('_id firstName lastName'),
    Admin.find({ isActive: true }).select('_id firstName lastName')
  ]);
  const staff = [
    ...users.map(u => ({ _id: u._id, name: `${u.firstName} ${u.lastName}`, type: 'user' })),
    ...admins.map(a => ({ _id: a._id, name: `${a.firstName} ${a.lastName}`, type: 'admin' }))
  ];
  return staff;
}

/**
 * Helper: Populate calledBy names for an array of retention records.
 * @param {Array} records - retention records (each has calledBy ObjectId)
 * @returns {Promise<Array>} - records with calledByName added
 */
async function populateCalledByNames(records) {
  const userIds = [...new Set(records.map(r => r.calledBy).filter(id => id))];
  const admins = await Admin.find({ _id: { $in: userIds } }).select('firstName lastName');
  const users = await User.find({ _id: { $in: userIds } }).select('firstName lastName');
  const nameMap = new Map();
  admins.forEach(a => nameMap.set(a._id.toString(), `${a.firstName} ${a.lastName}`));
  users.forEach(u => nameMap.set(u._id.toString(), `${u.firstName} ${u.lastName}`));

  return records.map(record => ({
    ...record,
    calledByName: nameMap.get(record.calledBy?.toString()) || 'Unknown',
  }));
}

// ============================================
// 1. Get logged-in user's own retention records (with filters & pagination)
// ============================================
exports.getMyRetentionRecords = asyncHandler(async (req, res, next) => {
  const userId = req.user._id; // assuming req.user is set from auth middleware
  const {
    page = 1,
    limit = 20,
    callStatus,
    callType,
    retentionOutcome,
    serviceSatisfaction,
    routerCollectionStatus,
    accountAction,
    startDate,
    endDate,
  } = req.query;

  const match = buildRetentionMatchStage(
    { callStatus, callType, retentionOutcome, serviceSatisfaction, routerCollectionStatus, accountAction, startDate, endDate },
    userId
  );

  // Aggregation pipeline
  const pipeline = [
    { $match: { 'retention.0': { $exists: true } } }, // has at least one retention
    { $unwind: '$retention' },
    { $match: match },
    { $sort: { 'retention.callDate': -1 } },
    {
      $lookup: {
        from: 'customers',
        localField: '_id',
        foreignField: '_id',
        as: 'customerInfo',
      },
    },
    { $unwind: { path: '$customerInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        retentionId: '$retention._id',
        callDate: '$retention.callDate',
        calledBy: '$retention.calledBy',
        callStatus: '$retention.callStatus',
        failureReason: '$retention.failureReason',
        callType: '$retention.callType',
        serviceSatisfaction: '$retention.serviceSatisfaction',
        retentionOutcome: '$retention.retentionOutcome',
        routerCollection: '$retention.routerCollection',
        description: '$retention.description',
        accountAction: '$retention.accountAction',
        actionDate: '$retention.actionDate',
        customer: {
          accountId: '$customerInfo.accountId',
          name: { $concat: ['$customerInfo.firstName', ' ', '$customerInfo.lastName'] },
          phoneNumber: '$customerInfo.phoneNumber',
          city: '$customerInfo.city',
          subLocation: '$customerInfo.subLocation',
          localArea: '$customerInfo.localArea',
        },
      },
    },
  ];

  const totalPipeline = [...pipeline, { $count: 'total' }];
  const totalResult = await Customer.aggregate(totalPipeline);
  const total = totalResult.length ? totalResult[0].total : 0;

  const records = await Customer.aggregate([
    ...pipeline,
    { $skip: (parseInt(page) - 1) * parseInt(limit) },
    { $limit: parseInt(limit) },
  ]);

  // Populate calledByName
  const enriched = await populateCalledByNames(records);

  res.status(200).json({
    success: true,
    data: enriched,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
  });
});

// ============================================
// 2. Analytics for logged-in user (based on their retention records)
// ============================================
exports.getMyRetentionAnalytics = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { startDate, endDate } = req.query;

  const match = { 'retention.calledBy': userId };
  if (startDate || endDate) {
    match['retention.callDate'] = {};
    if (startDate) match['retention.callDate'].$gte = new Date(startDate);
    if (endDate) match['retention.callDate'].$lte = new Date(endDate);
  }

  const pipeline = [
    { $match: { 'retention.0': { $exists: true } } },
    { $unwind: '$retention' },
    { $match: match },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        successfulCalls: { $sum: { $cond: [{ $eq: ['$retention.callStatus', 'successful'] }, 1, 0] } },
        failedCalls: { $sum: { $cond: [{ $eq: ['$retention.callStatus', 'failed'] }, 1, 0] } },
        // For successful calls, breakdown by callType
        followUpCalls: { $sum: { $cond: [{ $eq: ['$retention.callType', 'service_follow_up'] }, 1, 0] } },
        retentionCalls: { $sum: { $cond: [{ $eq: ['$retention.callType', 'retention'] }, 1, 0] } },
        // Retention outcomes
        renewed: { $sum: { $cond: [{ $eq: ['$retention.retentionOutcome', 'renewed'] }, 1, 0] } },
        toRenew: { $sum: { $cond: [{ $eq: ['$retention.retentionOutcome', 'to_renew'] }, 1, 0] } },
        changedProvider: { $sum: { $cond: [{ $eq: ['$retention.retentionOutcome', 'changed_provider'] }, 1, 0] } },
        // Service satisfaction
        satisfied: { $sum: { $cond: [{ $eq: ['$retention.serviceSatisfaction', 'satisfied'] }, 1, 0] } },
        averagelySatisfied: { $sum: { $cond: [{ $eq: ['$retention.serviceSatisfaction', 'averagely_satisfied'] }, 1, 0] } },
        notSatisfied: { $sum: { $cond: [{ $eq: ['$retention.serviceSatisfaction', 'not_satisfied'] }, 1, 0] } },
        // Router collection status
        routerPending: { $sum: { $cond: [{ $eq: ['$retention.routerCollection.status', 'pending'] }, 1, 0] } },
        routerScheduled: { $sum: { $cond: [{ $eq: ['$retention.routerCollection.status', 'scheduled'] }, 1, 0] } },
        routerCollected: { $sum: { $cond: [{ $eq: ['$retention.routerCollection.status', 'collected'] }, 1, 0] } },
        routerRefused: { $sum: { $cond: [{ $eq: ['$retention.routerCollection.status', 'refused'] }, 1, 0] } },
      },
    },
  ];

  const result = await Customer.aggregate(pipeline);
  const stats = result[0] || {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    followUpCalls: 0,
    retentionCalls: 0,
    renewed: 0,
    toRenew: 0,
    changedProvider: 0,
    satisfied: 0,
    averagelySatisfied: 0,
    notSatisfied: 0,
    routerPending: 0,
    routerScheduled: 0,
    routerCollected: 0,
    routerRefused: 0,
  };

  // Calculate percentages
  const successRate = stats.totalCalls > 0 ? (stats.successfulCalls / stats.totalCalls) * 100 : 0;
  const retentionSuccessRate = stats.retentionCalls > 0 ? (stats.renewed / stats.retentionCalls) * 100 : 0;
  const followUpSatisfactionRate = stats.followUpCalls > 0 ? ((stats.satisfied + stats.averagelySatisfied) / stats.followUpCalls) * 100 : 0;

  res.status(200).json({
    success: true,
    data: {
      summary: stats,
      rates: {
        successRate: successRate.toFixed(2),
        retentionSuccessRate: retentionSuccessRate.toFixed(2),
        followUpSatisfactionRate: followUpSatisfactionRate.toFixed(2),
      },
    },
  });
});

// ============================================
// 3. Admin: Get all retention records (across users) with filters and pagination
// ============================================
exports.getAllRetentionRecords = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    calledBy,
    callStatus,
    callType,
    retentionOutcome,
    serviceSatisfaction,
    routerCollectionStatus,
    accountAction,
    startDate,
    endDate,
  } = req.query;

  const match = {};

  if (calledBy) {
    try {
      match['retention.calledBy'] = new mongoose.Types.ObjectId(calledBy);
    } catch (err) {
      return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
    }
  }

  if (callStatus) match['retention.callStatus'] = callStatus;
  if (callType) match['retention.callType'] = callType;
  if (retentionOutcome) match['retention.retentionOutcome'] = retentionOutcome;
  if (serviceSatisfaction) match['retention.serviceSatisfaction'] = serviceSatisfaction;
  if (routerCollectionStatus) match['retention.routerCollection.status'] = routerCollectionStatus;
  if (accountAction) match['retention.accountAction'] = accountAction;

  if (startDate || endDate) {
    match['retention.callDate'] = {};
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      match['retention.callDate'].$gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      match['retention.callDate'].$lte = end;
    }
  }

  const pipeline = [
    { $match: { 'retention.0': { $exists: true } } },
    { $unwind: '$retention' },
    { $match: match },
    { $sort: { 'retention.callDate': -1 } },
    {
      $lookup: {
        from: 'customers',
        localField: '_id',
        foreignField: '_id',
        as: 'customerInfo',
      },
    },
    { $unwind: { path: '$customerInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        retentionId: '$retention._id',
        callDate: '$retention.callDate',
        calledBy: '$retention.calledBy',
        callStatus: '$retention.callStatus',
        failureReason: '$retention.failureReason',
        callType: '$retention.callType',
        serviceSatisfaction: '$retention.serviceSatisfaction',
        retentionOutcome: '$retention.retentionOutcome',
        routerCollection: '$retention.routerCollection',
        description: '$retention.description',
        accountAction: '$retention.accountAction',
        actionDate: '$retention.actionDate',
        customer: {
          accountId: '$customerInfo.accountId',
          name: { $concat: ['$customerInfo.firstName', ' ', '$customerInfo.lastName'] },
          phoneNumber: '$customerInfo.phoneNumber',
          city: '$customerInfo.city',
          subLocation: '$customerInfo.subLocation',
          localArea: '$customerInfo.localArea',
        },
      },
    },
  ];

  const totalPipeline = [...pipeline, { $count: 'total' }];
  const totalResult = await Customer.aggregate(totalPipeline);
  const total = totalResult.length ? totalResult[0].total : 0;

  const records = await Customer.aggregate([
    ...pipeline,
    { $skip: (parseInt(page) - 1) * parseInt(limit) },
    { $limit: parseInt(limit) },
  ]);

  const enriched = await populateCalledByNames(records);

  res.status(200).json({
    success: true,
    data: enriched,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
  });
});


// ============================================
// 4. Admin: Employee performance analytics (by user)
// ============================================
exports.getEmployeeRetentionAnalytics = asyncHandler(async (req, res, next) => {
  const { startDate, endDate } = req.query;

  // Build date filter for retention records
  const dateFilter = {};
  if (startDate || endDate) {
    dateFilter['retention.callDate'] = {};
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      dateFilter['retention.callDate'].$gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter['retention.callDate'].$lte = end;
    }
  }

  // Get all staff
  const allStaff = await getAllStaff();

  // Get retention aggregation for all staff who have records (non-zero)
  const matchStage = { 'retention.0': { $exists: true } };
  if (startDate || endDate) {
    matchStage['retention.callDate'] = dateFilter['retention.callDate'];
  }

  const pipeline = [
    { $match: matchStage },
    { $unwind: '$retention' },
    { $match: dateFilter },
    {
      $group: {
        _id: '$retention.calledBy',
        totalCalls: { $sum: 1 },
        successfulCalls: { $sum: { $cond: [{ $eq: ['$retention.callStatus', 'successful'] }, 1, 0] } },
        failedCalls: { $sum: { $cond: [{ $eq: ['$retention.callStatus', 'failed'] }, 1, 0] } },
        followUpCalls: { $sum: { $cond: [{ $eq: ['$retention.callType', 'service_follow_up'] }, 1, 0] } },
        retentionCalls: { $sum: { $cond: [{ $eq: ['$retention.callType', 'retention'] }, 1, 0] } },
        renewed: { $sum: { $cond: [{ $eq: ['$retention.retentionOutcome', 'renewed'] }, 1, 0] } },
        toRenew: { $sum: { $cond: [{ $eq: ['$retention.retentionOutcome', 'to_renew'] }, 1, 0] } },
        changedProvider: { $sum: { $cond: [{ $eq: ['$retention.retentionOutcome', 'changed_provider'] }, 1, 0] } },
        satisfied: { $sum: { $cond: [{ $eq: ['$retention.serviceSatisfaction', 'satisfied'] }, 1, 0] } },
        averagelySatisfied: { $sum: { $cond: [{ $eq: ['$retention.serviceSatisfaction', 'averagely_satisfied'] }, 1, 0] } },
        notSatisfied: { $sum: { $cond: [{ $eq: ['$retention.serviceSatisfaction', 'not_satisfied'] }, 1, 0] } },
      },
    },
  ];

  const stats = await Customer.aggregate(pipeline);
  const statsMap = new Map();
  stats.forEach(s => statsMap.set(s._id.toString(), s));

  // Build result for all staff, filling zeros
  const employees = allStaff.map(staff => {
    const s = statsMap.get(staff._id.toString()) || {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      followUpCalls: 0,
      retentionCalls: 0,
      renewed: 0,
      toRenew: 0,
      changedProvider: 0,
      satisfied: 0,
      averagelySatisfied: 0,
      notSatisfied: 0,
    };
    const successRate = s.totalCalls > 0 ? (s.successfulCalls / s.totalCalls) * 100 : 0;
    const retentionSuccessRate = s.retentionCalls > 0 ? (s.renewed / s.retentionCalls) * 100 : 0;
    const followUpSatisfactionRate = s.followUpCalls > 0 ? ((s.satisfied + s.averagelySatisfied) / s.followUpCalls) * 100 : 0;
    return {
      userId: staff._id,
      name: staff.name,
      role: staff.type,
      totalCalls: s.totalCalls,
      successfulCalls: s.successfulCalls,
      failedCalls: s.failedCalls,
      followUpCalls: s.followUpCalls,
      retentionCalls: s.retentionCalls,
      renewed: s.renewed,
      toRenew: s.toRenew,
      changedProvider: s.changedProvider,
      satisfied: s.satisfied,
      averagelySatisfied: s.averagelySatisfied,
      notSatisfied: s.notSatisfied,
      successRate,
      retentionSuccessRate,
      followUpSatisfactionRate,
    };
  });

  // Calculate overall totals
  const totals = employees.reduce((acc, emp) => {
    acc.totalCalls += emp.totalCalls;
    acc.successfulCalls += emp.successfulCalls;
    acc.failedCalls += emp.failedCalls;
    acc.retentionCalls += emp.retentionCalls;
    acc.renewed += emp.renewed;
    acc.toRenew += emp.toRenew;
    acc.changedProvider += emp.changedProvider;
    acc.satisfied += emp.satisfied;
    acc.averagelySatisfied += emp.averagelySatisfied;
    acc.notSatisfied += emp.notSatisfied;
    return acc;
  }, {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    retentionCalls: 0,
    renewed: 0,
    toRenew: 0,
    changedProvider: 0,
    satisfied: 0,
    averagelySatisfied: 0,
    notSatisfied: 0,
  });

  const overallSuccessRate = totals.totalCalls > 0 ? (totals.successfulCalls / totals.totalCalls) * 100 : 0;
  const overallRetentionSuccessRate = totals.retentionCalls > 0 ? (totals.renewed / totals.retentionCalls) * 100 : 0;
  const overallFollowUpSatisfaction = totals.followUpCalls > 0 ? ((totals.satisfied + totals.averagelySatisfied) / totals.followUpCalls) * 100 : 0;

  res.status(200).json({
    success: true,
    data: {
      employees,
      totals: {
        ...totals,
        overallSuccessRate: overallSuccessRate.toFixed(2),
        overallRetentionSuccessRate: overallRetentionSuccessRate.toFixed(2),
        overallFollowUpSatisfaction: overallFollowUpSatisfaction.toFixed(2),
      },
    },
  });
});