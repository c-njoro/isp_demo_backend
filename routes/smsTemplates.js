const express = require('express');
const router = express.Router();

const {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = require('../controllers/smsTemplateController');
const { protect, applyRegionFilter, adminOnly } = require('../middleware/auth');


router.route('/')
  .get(protect, getTemplates)
  .post(protect, createTemplate);

router.route('/:id')
  .get(protect, getTemplate)
  .put(protect, updateTemplate)
  .delete(protect, deleteTemplate);

module.exports = router;