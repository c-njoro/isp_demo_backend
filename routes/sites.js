// routes/sites.js
const express = require('express');
const router = express.Router();
const {
  getSites,
  getSite,
  createSite,
  updateSite,
  deleteSite,
} = require('../controllers/siteController');
const { protect, applyRegionFilter, adminOnly } = require('../middleware/auth');

router.use(protect);
router.use(applyRegionFilter);

router.route('/')
  .get(getSites)
  .post(adminOnly, createSite);

router.route('/:id')
  .get(adminOnly, getSite)
  .put(adminOnly, updateSite)
  .delete(adminOnly, deleteSite);

module.exports = router;