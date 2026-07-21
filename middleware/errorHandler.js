// middleware/errorHandler.js
const SystemLog = require('../models/SystemLog');
const fs = require('fs');
const path = require('path');
const { formatPhoneNumber } = require('../utils/phoneHelpers');


// Custom error class
class ErrorResponse extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ─── Error Notification Function ─────────────────────────────────────────────
async function sendErrorNotification(err, req) {
  // Check if notifications are enabled
  if (process.env.ERROR_NOTIFICATIONS_ENABLED !== 'true') return;

  // Check if we should notify in this environment
  const allowedEnvs = (process.env.ERROR_NOTIFICATION_ENV || 'production').split(',');
  const currentEnv = process.env.NODE_ENV || 'development';
  if (!allowedEnvs.includes(currentEnv)) return;

  // Only notify for server errors (500) or critical issues (status >= 500)
  const statusCode = err.statusCode || 500;
  if (statusCode < 500) return;

  const errorMessage = err.message || 'Unknown error';
  const stack = err.stack || 'No stack trace';
  const method = req.method;
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  // Build notification content
  const title = `🚨 Server Error (${statusCode})`;
  const shortMessage = `ISP Error: ${statusCode} ${errorMessage} (${method} ${url})`;

  try {
    const { notifyAdmin } = require('../services/notificationService');
    const Admin = require('../models/Admin');

    // Determine recipients from environment
    let adminIds = [];

    if (process.env.ERROR_ALERT_ADMIN_IDS) {
      adminIds = process.env.ERROR_ALERT_ADMIN_IDS.split(',').map(id => id.trim());
    }

    if (adminIds.length === 0) {
      console.warn('[errorHandler] No admin IDs configured for error notifications');
      return;
    }

    // Fetch admins by ID
    const admins = await Admin.find({ _id: { $in: adminIds } }).select('phoneNumber');
    if (admins.length === 0) {
      console.warn('[errorHandler] No admins found with the provided IDs');
      return;
    }

    // Get channels from environment
    const channels = (process.env.ERROR_NOTIFICATION_CHANNELS || 'sms,whatsapp').split(',');

    // Send notification to each admin
    for (const admin of admins) {
      if (!admin.phoneNumber) continue;
      const formattedPhone = formatPhoneNumber(admin.phoneNumber);

      try {
        // Send using the notification service (this will handle SMS and WhatsApp)
        const { sendNotification } = require('../services/notificationService');

        await sendNotification({
          regionCode: req.user?.regionCode || 'SYSTEM',
          recipientType: 'admin',
          recipientId: admin._id,
          type: 'alert',
          title,
          message: shortMessage,
          data: {
            statusCode,
            method,
            url,
            ip,
            stack: stack.slice(0, 500),
            fullError: errorMessage,
            timestamp: new Date().toISOString(),
          },
          channels: channels,
          triggeredBy: null, // system triggered
          triggeredByModel: 'Admin',
        });

        console.log(`[errorHandler] Notification sent to admin ${admin._id}`);
      } catch (notifyError) {
        console.error('[errorHandler] Failed to send notification:', notifyError.message);
      }
    }
  } catch (error) {
    console.error('[errorHandler] Error in sendErrorNotification:', error.message);
    // Don't re-throw - we don't want notification failures to break the error response
  }
}

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error(err);

  // Send error notification (async – we don't wait for it)
  sendErrorNotification(err, req).catch((notifyErr) => {
    console.error('[errorHandler] Async notification error:', notifyErr.message);
  });

  let error = err;

  // Handle invalid ObjectId
  if (err.name === 'CastError' && err.path === '_id') {
    let modelName = 'Resource';
    if (err.model) {
      modelName = err.model.modelName || modelName;
    } else {
      const match = err.message.match(/for model "(\w+)"/);
      if (match) {
        modelName = match[1];
      }
    }
    error = new ErrorResponse(`${modelName} not found`, 404);
  }

  // Duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    error = new ErrorResponse(`Duplicate value entered for ${field}`, 400);
  }

  // Validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors)
      .map(val => val.message)
      .join(', ');
    error = new ErrorResponse(message, 400);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { ErrorResponse, errorHandler };