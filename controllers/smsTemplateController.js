const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const SmsTemplate = require('../models/SmsTemplate');

// @desc    Get all SMS templates
// @route   GET /api/sms-templates
// @access  Private/Admin
exports.getTemplates = asyncHandler(async (req, res) => {
  const templates = await SmsTemplate.find().sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: templates });
});

// @desc    Get single SMS template
// @route   GET /api/sms-templates/:id
// @access  Private/Admin
exports.getTemplate = asyncHandler(async (req, res, next) => {
  const template = await SmsTemplate.findById(req.params.id);
  if (!template) return next(new ErrorResponse('Template not found', 404));
  res.status(200).json({ success: true, data: template });
});

// @desc    Create new SMS template
// @route   POST /api/sms-templates
// @access  Private/Admin
exports.createTemplate = asyncHandler(async (req, res) => {
  const { key, name, subject, body, placeholders, isActive, description } = req.body;
  const existing = await SmsTemplate.findOne({ key });
  if (existing) return next(new ErrorResponse('Template key already exists', 400));
  const template = await SmsTemplate.create({
    key, name, subject, body, placeholders: placeholders || ['customerName'], isActive, description
  });
  res.status(201).json({ success: true, data: template });
});

// @desc    Update SMS template
// @route   PUT /api/sms-templates/:id
// @access  Private/Admin
exports.updateTemplate = asyncHandler(async (req, res, next) => {
  let template = await SmsTemplate.findById(req.params.id);
  if (!template) return next(new ErrorResponse('Template not found', 404));
  template = await SmsTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  res.status(200).json({ success: true, data: template });
});

// @desc    Delete SMS template
// @route   DELETE /api/sms-templates/:id
// @access  Private/Admin
exports.deleteTemplate = asyncHandler(async (req, res, next) => {
  const template = await SmsTemplate.findById(req.params.id);
  if (!template) return next(new ErrorResponse('Template not found', 404));
  await template.remove();
  res.status(200).json({ success: true, message: 'Template deleted' });
});