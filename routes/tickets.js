const express = require('express');
const router = express.Router();
const {
  getTickets,
  getTicket,
  createTicket,
  updateTicket,
  assignTicket,
  transferTicket,
  addUpdate,
  changeStatus,
  resolveTicket,
  closeTicket,
  addFeedback,
  getTicketStatistics,
  deleteTicket
} = require('../controllers/ticketController');
const { protect, applyRegionFilter, adminOnly } = require('../middleware/auth');

router.use(protect);
router.use(applyRegionFilter);

router.route('/').get(getTickets).post(createTicket);
router.get('/stats', adminOnly,  getTicketStatistics);

router.route('/:id').get(getTicket).put(updateTicket).delete(deleteTicket);
router.put('/:id/assign', assignTicket);
router.put('/:id/transfer', transferTicket);
router.post('/:id/updates', addUpdate);
router.put('/:id/status', changeStatus);
router.put('/:id/resolve', resolveTicket);
router.put('/:id/close', closeTicket);
router.post('/:id/feedback', addFeedback);

module.exports = router;