const Notification = require('../models/Notification');
const { notifyRole } = require('../services/notificationService');
const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');

// GET /api/notifications – get current user's notifications
exports.getNotifications = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, isRead, type } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const filter = { recipientId: req.user._id, recipientModel: 'Admin' };
  if (isRead !== undefined) filter.isRead = isRead === 'true';
  if (type) filter.type = type;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('triggeredBy', 'firstName lastName'),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...filter, isRead: false }),
  ]);

  res.json({
    success: true,
    unreadCount,
    notifications,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
  });
});

// GET /api/notifications/unread-count
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({
    recipientId: req.user._id,
    recipientModel: 'Admin',
    isRead: false,
  });
  res.json({ success: true, unreadCount: count });
});

// GET /api/notifications/:id
exports.getNotification = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipientId: req.user._id },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  ).populate('triggeredBy', 'firstName lastName');
  if (!notification) return next(new ErrorResponse('Notification not found', 404));
  res.json({ success: true, notification });
});

// PATCH /api/notifications/:id/read
exports.markAsRead = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipientId: req.user._id },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  );
  if (!notification) return next(new ErrorResponse('Notification not found', 404));
  res.json({ success: true, notification });
});

// PATCH /api/notifications/:id/unread
exports.markAsUnread = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipientId: req.user._id },
    { $set: { isRead: false, readAt: null } },
    { new: true }
  );
  if (!notification) return next(new ErrorResponse('Notification not found', 404));
  res.json({ success: true, notification });
});

// PATCH /api/notifications/mark-all-read
exports.markAllAsRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { recipientId: req.user._id, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  res.json({ success: true, updated: result.modifiedCount });
});

// PATCH /api/notifications/mark-all-unread
exports.markAllAsUnread = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { recipientId: req.user._id, isRead: true },
    { $set: { isRead: false, readAt: null } }
  );
  res.json({ success: true, updated: result.modifiedCount });
});

// PATCH /api/notifications/mark-many-read
exports.markManyAsRead = asyncHandler(async (req, res, next) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return next(new ErrorResponse('ids array is required', 400));
  }
  const result = await Notification.updateMany(
    { _id: { $in: ids }, recipientId: req.user._id, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  res.json({ success: true, updated: result.modifiedCount });
});

// DELETE /api/notifications/:id
exports.deleteNotification = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    recipientId: req.user._id,
  });
  if (!notification) return next(new ErrorResponse('Notification not found', 404));
  res.json({ success: true, message: 'Notification deleted' });
});

// DELETE /api/notifications/clear-all
exports.clearAllNotifications = asyncHandler(async (req, res) => {
  const result = await Notification.deleteMany({ recipientId: req.user._id });
  res.json({ success: true, deleted: result.deletedCount });
});

// POST /api/notifications/broadcast (admin only)
exports.broadcast = asyncHandler(async (req, res, next) => {
  const { role, title, message, channels = ['in-app'], type = 'system' } = req.body;
  if (!role || !title || !message) {
    return next(new ErrorResponse('role, title, and message are required', 400));
  }

  const result = await notifyRole({
    regionCode: req.user.regionCode,
    role,
    type,
    title,
    message,
    channels,
    triggeredBy: req.user._id,
    triggeredByModel: 'Admin',
  });

  res.status(201).json({
    success: true,
    sent: result.channelResults?.length || 0,
    errors: result.errors,
  });
});