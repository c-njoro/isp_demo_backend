const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Transaction = require('../models/Transaction');
const Invoice = require('../models/Invoice');
const UnprocessedPayment = require('../models/UnprocessedPayment');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const Package = require('../models/Package');
const SystemLog = require('../models/SystemLog')

// ============= TRANSACTION CONTROLLER =============

// @desc    Get all transactions
// @route   GET /api/transactions
// @access  Private
exports.getTransactions = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    type,
    status,
    customerId,
    dateFrom,
    dateTo
  } = req.query;

  const query = { ...req.regionFilter };

  if (type) query.type = type;
  if (status) query.status = status;
  if (customerId) query.customerId = customerId;

  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(dateTo);
  }

  const transactions = await Transaction.find(query)
    .populate('packageId', 'packageName')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Transaction.countDocuments(query);

  res.status(200).json({
    success: true,
    message: 'Transactions retrieved successfully',
    data: {
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get single transaction
// @route   GET /api/transactions/:id
// @access  Private
exports.getTransaction = asyncHandler(async (req, res, next) => {
  const transaction = await Transaction.findById(req.params.id)
    .populate('packageId')
    .populate('relatedTransactionId')
    .populate('verifiedBy', 'firstName lastName');

  if (!transaction) {
    return next(new ErrorResponse('Transaction not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && transaction.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this transaction', 403));
  }

  res.status(200).json({
    success: true,
    message: 'Transaction retrieved successfully',
    data: transaction
  });
});

// @desc    Get transaction statistics
// @route   GET /api/transactions/stats
// @access  Private
exports.getTransactionStats = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo } = req.query;

  const match = { ...req.regionFilter };

  if (dateFrom || dateTo) {
    match.createdAt = {};
    if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
    if (dateTo) match.createdAt.$lte = new Date(dateTo);
  }

  const stats = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRevenue: {
          $sum: { $cond: [{ $eq: ['$type', 'MPESA'] }, '$amount', 0] }
        },
        totalTransactions: { $sum: 1 },
        mpesaTransactions: {
          $sum: { $cond: [{ $eq: ['$type', 'MPESA'] }, 1, 0] }
        },
        subscriptionTransactions: {
          $sum: { $cond: [{ $eq: ['$type', 'SUBSCRIPTION'] }, 1, 0] }
        },
        completedTransactions: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        }
      }
    }
  ]);

  res.status(200).json({
    success: true,
    message: 'Transaction statistics retrieved successfully',
    data: stats[0] || {
      totalRevenue: 0,
      totalTransactions: 0,
      mpesaTransactions: 0,
      subscriptionTransactions: 0,
      completedTransactions: 0
    }
  });
});




// ============= INVOICE CONTROLLER =============

// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private
exports.getInvoices = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status,
    customerId,
    dateFrom,
    dateTo
  } = req.query;

  const query = { ...req.regionFilter };

  if (status) query.status = status;
  if (customerId) query.customerId = customerId;

  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(dateTo);
  }

  const invoices = await Invoice.find(query)
    .populate('packageId', 'packageName')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Invoice.countDocuments(query);

  res.status(200).json({
    success: true,
    message: 'Invoices retrieved successfully',
    data: {
      invoices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get single invoice
// @route   GET /api/invoices/:id
// @access  Private
exports.getInvoice = asyncHandler(async (req, res, next) => {
  const invoice = await Invoice.findById(req.params.id)
    .populate('packageId')
    .populate('transactionId')
    .populate('paymentId');

  if (!invoice) {
    return next(new ErrorResponse('Invoice not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && invoice.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this invoice', 403));
  }

  res.status(200).json({
    success: true,
    message: 'Invoice retrieved successfully',
    data: invoice
  });
});

// @desc    Get invoice by invoice number
// @route   GET /api/invoices/number/:invoiceNumber
// @access  Private
exports.getInvoiceByNumber = asyncHandler(async (req, res, next) => {
  const invoice = await Invoice.findOne({ invoiceNumber: req.params.invoiceNumber })
    .populate('packageId')
    .populate('transactionId')
    .populate('paymentId');

  if (!invoice) {
    return next(new ErrorResponse('Invoice not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && invoice.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this invoice', 403));
  }

  res.status(200).json({
    success: true,
    message: 'Invoice retrieved successfully',
    data: invoice
  });
});



// @desc    Get unprocessed payments
// @route   GET /api/unprocessed-payments
// @access  Private
exports.getUnprocessedPayments = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status,
    dateFrom,
    dateTo, 
    search
  } = req.query;

  const query = {};

  if (status) query.status = status;

  //the search should search both receipt number and phone number 
  if (search) query.$or = [
    { receiptNumber: { $regex: search, $options: 'i' } },
    { phoneNumber: { $regex: search, $options: 'i' } }
  ];


  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(dateTo);
  }

  const unprocessedPayments = await UnprocessedPayment.find(query)
  .sort({ createdAt: -1 })
  .limit(limit * 1)
  .skip((page - 1) * limit)
  .populate({
    path: 'matchedWith.id',
    select: 'leadNumber accountId firstName lastName',
    match: {
      _id: { $exists: true } // ensures valid ref
    }
  });

  const total = await UnprocessedPayment.countDocuments(query);


  res.status(200).json({
    success: true,
    message: 'Unprocessed payments retrieved successfully',
    data: {
      unprocessedPayments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});



// @desc    Get all payments
// @route   GET /api/all-payments
// @access  Private
exports.getAllPayments = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status,
    dateFrom,
    dateTo
  } = req.query;

  const query = { ...req.regionFilter };

  if (status) query.status = status;


  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(dateTo);
  }

  const payments = await Payment.find(query).sort({ createdAt: -1 }).limit(limit * 1).skip((page - 1) * limit);


    const total = await Payment.countDocuments(query);


  res.status(200).json({
    success: true,
    message: 'Payments retrieved successfully',
    data: {
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});


// @desc    Generate an invoice
// @route   POST /api/invoices/generate
// @access  Private
/**
 * Generate a sequential invoice number
 * Format: INV-{REGION}-{YEAR}-{0001}
 */
const generateInvoiceNumber = async (regionCode) => {
  const year = new Date().getFullYear();
  const regex = new RegExp(`^INV-${regionCode}-${year}-(\\d{4})$`);

  const lastInvoice = await Invoice.findOne({ invoiceNumber: regex })
    .sort({ invoiceNumber: -1 })
    .select('invoiceNumber')
    .lean();

  let nextSeq = 1;
  if (lastInvoice) {
    const match = lastInvoice.invoiceNumber.match(regex);
    if (match) {
      nextSeq = parseInt(match[1], 10) + 1;
    }
  }

  const paddedSeq = String(nextSeq).padStart(4, '0');
  return `INV-${regionCode}-${year}-${paddedSeq}`;
};

/**
 * @desc    Generate a new invoice (draft)
 * @route   POST /api/invoices
 * @access  Private (admin, accounts)
 */
exports.generateInvoice = asyncHandler(async (req, res, next) => {
  const {
    customerId,
    customerType,           // 'pppoe' or 'hotspot'
    accountId,              // optional if present on customer
    packageId,
    subtotal,
    
    total,
    discount = 0,
    periodStart,
    periodEnd,
    notes
  } = req.body;

  // --- Required field validation ---
  const requiredFields = [
    'customerId', 'customerType', 'packageId',
    'subtotal', 'total', 'periodStart', 'periodEnd'
  ];
  for (const field of requiredFields) {
    if (!req.body[field]) {
      return next(new ErrorResponse(`Missing required field: ${field}`, 400));
    }
  }

  // --- Fetch and validate customer ---
  const customer = await Customer.findById(customerId);
  if (!customer) {
    return next(new ErrorResponse('Customer not found', 404));
  }


  // Region access control (from your regionFilter middleware)
  if (req.regionFilter?.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this customer', 403));
  }

  // --- Fetch and validate package ---
  const pkg = await Package.findById(packageId);
  if (!pkg) {
    return next(new ErrorResponse('Package not found', 404));
  }

  // --- Ensure accountId is present (required by schema) ---
  const finalAccountId = accountId || customer.accountId;
  if (!finalAccountId) {
    return next(new ErrorResponse('Account ID is required and could not be derived from customer', 400));
  }

  // --- Generate unique invoice number ---
  const invoiceNumber = await generateInvoiceNumber(customer.regionCode);

  // --- Create the invoice (status defaults to 'draft') ---
  const invoice = await Invoice.create({
    invoiceNumber,
    regionCode: customer.regionCode,
    customerType,
    customerId: customer._id,
    accountId: finalAccountId,
    customerName: `${customer.firstName}  ${customer.lastName}`,          // adjust field name if different
    customerPhone: customer.phoneNumber,        // adjust if needed
    customerEmail: customer.email,        // adjust if needed
    packageId: pkg._id,
    packageName: pkg.packageName,         // adjust if your package model uses a different field
    subtotal,
    discount,
    total,
    periodStart,
    periodEnd,
    notes,
    generatedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : 'system'
  });

  // --- (Optional) Log the creation event ---
  await SystemLog.create({
    eventType: 'invoice',
    severity: 'info',
    regionCode: invoice.regionCode,
    entityType: 'invoice',
    entityId: invoice._id,
    message: `Invoice generated by ${req.user.firstName} ${req.user.lastName}: ${invoice.invoiceNumber}`,
    triggeredBy: req.session?.userId || req.user?._id,
    success: true
  });

  // --- Populate references for response ---
  await invoice.populate('packageId');

  res.status(201).json({
    success: true,
    message: 'Invoice generated successfully',
    data: invoice
  });
});