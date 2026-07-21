const express = require('express');
const router = express.Router();
const {
  getNotifications,
  getUnreadCount,
  getNotification,
  markAsRead,
  markAsUnread,
  markAllAsRead,
  markAllAsUnread,
  markManyAsRead,
  deleteNotification,
  clearAllNotifications,
  broadcast,
} = require('../controllers/notificationController');
const { protect, adminOnly } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// User routes
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.get('/:id', getNotification);
router.patch('/:id/read', markAsRead);
router.patch('/:id/unread', markAsUnread);
router.patch('/mark-all-read', markAllAsRead);
router.patch('/mark-all-unread', markAllAsUnread);
router.patch('/mark-many-read', markManyAsRead);
router.delete('/clear-all', clearAllNotifications);
router.delete('/:id', deleteNotification);


// Admin broadcast (admin only)
router.post('/broadcast', adminOnly, broadcast);

module.exports = router;