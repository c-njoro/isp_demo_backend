const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const { generateReceipt, generateStatement, generateSubscriptionReceipt } = require('../services/documentGenerationService');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const SystemLog = require('../models/SystemLog');

// @desc    Generate receipt for a payment
// @route   GET /api/documents/receipt/:paymentId
// @access  Private
exports.getReceipt = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  const payment = await Payment.findById(paymentId).populate('customerId');
  if (!payment) return next(new ErrorResponse('Payment not found', 404));

  // Region access check
  if (req.regionFilter?.regionCode && payment.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied', 403));
  }

  try {
    const pdfBuffer = await generateReceipt(paymentId);
    const filename = `receipt_${payment.mpesaReceiptNumber || payment.stkID || payment._id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);

    // Log action
    await SystemLog.create({
      eventType: 'document_generated',
      severity: 'info',
      regionCode: payment.regionCode,
      entityType: 'payment',
      entityId: payment._id,
      accountId: payment.accountId,
      message: `Receipt generated for payment ${payment._id}`,
      triggeredBy: req.user?._id || req.session?.userId,
      success: true
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return next(new ErrorResponse('Failed to generate receipt', 500));
  }
});

// @desc    Generate statement for a customer
// @route   GET /api/documents/statement/:customerId
// @query   start (ISO date), end (ISO date)
// @access  Private
exports.getStatement = asyncHandler(async (req, res, next) => {
  const { customerId } = req.params;
  const { start, end } = req.query;

  if (!start || !end) {
    return next(new ErrorResponse('Start and end dates are required', 400));
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return next(new ErrorResponse('Invalid date format', 400));
  }
  if (startDate > endDate) {
    return next(new ErrorResponse('Start date must be before end date', 400));
  }

  const customer = await Customer.findById(customerId);
  if (!customer) return next(new ErrorResponse('Customer not found', 404));

  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied', 403));
  }

  try {
    const pdfBuffer = await generateStatement(customerId, startDate, endDate);
    const filename = `statement_${customer.accountId}_${startDate.toISOString().slice(0,10)}_${endDate.toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);

    // Log action
    await SystemLog.create({
      eventType: 'document_generated',
      severity: 'info',
      regionCode: customer.regionCode,
      entityType: 'customer',
      entityId: customer._id,
      accountId: customer.accountId,
      message: `Statement generated for ${customer.accountId} (${startDate.toISOString().slice(0,10)} – ${endDate.toISOString().slice(0,10)})`,
      triggeredBy: req.user?._id || req.session?.userId,
      success: true
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return next(new ErrorResponse('Failed to generate statement', 500));
  }
});


// @desc    Generate receipt for a specific subscription transaction
// @route   GET /api/documents/subscription-receipt/:transactionId
// @access  Private
exports.getSubscriptionReceipt = asyncHandler(async (req, res, next) => {
    const { transactionId } = req.params;
  
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) return next(new ErrorResponse('Transaction not found', 404));
    if (transaction.type.toLowerCase() !== 'subscription') {
      return next(new ErrorResponse('Transaction is not a valid subscription type', 400));
    }
  
    try {
      const pdfBuffer = await generateSubscriptionReceipt(transactionId);
      const filename = `subscription_receipt_${transaction._id}.pdf`;
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
    } catch (error) {
      return next(new ErrorResponse(error.message, 500));
    }
  });