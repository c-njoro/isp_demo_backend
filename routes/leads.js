const express = require('express');
const router = express.Router();
const {
  getLeads,
  getLead,
  createLead,
  updateLead,
  addInteraction,
  assignLead,
  addSiteSurvey,
  convertLead,
  markAsLost,
  getLeadStatistics,
  getFollowUps,
  deleteLead,
  markLeadAsPaid
} = require('../controllers/leadController');
const { protect, applyRegionFilter } = require('../middleware/auth');

router.use(protect);
router.use(applyRegionFilter);

router.route('/').get(getLeads).post(createLead);
router.get('/stats', getLeadStatistics);
router.get('/follow-ups', getFollowUps);

router.route('/:id').get(getLead).put(updateLead).delete(deleteLead);
router.post('/:id/interactions', addInteraction);
router.put('/:id/assign', assignLead);
router.post('/:id/site-survey', addSiteSurvey);
router.post('/:id/convert', convertLead);
router.put('/:id/lost', markAsLost);
router.post('/:id/mark-paid', markLeadAsPaid);

module.exports = router;