const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Transaction = require('../models/Transaction');
const Invoice = require('../models/Invoice');
const UnprocessedPayment = require('../models/UnprocessedPayment');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const Package = require('../models/Package');
const Site = require('../models/Site');
const Router = require('../models/Router');
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
// @desc    Get all payments (completed only)
// @route   GET /api/all-payments
// @access  Private
// @desc    Get all payments (completed only)
// @route   GET /api/all-payments
// @access  Private
// @desc    Get all payments (completed only)
// @route   GET /api/all-payments
// @access  Private
// @desc    Get all payments (completed only) - FIXED VERSION
// @route   GET /api/all-payments
// @access  Private
exports.getAllPayments_Alternative = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status = 'completed',
    dateFrom,
    dateTo,
    search
  } = req.query;

  // Build the base query with region filter and status
  const baseConditions = [];
  
  // Add region filter if present
  if (req.regionFilter && Object.keys(req.regionFilter).length > 0) {
    baseConditions.push(req.regionFilter);
  }

  // Status filter (default completed)
  if (status) {
    baseConditions.push({ status });
  }

  // Date range
  if (dateFrom || dateTo) {
    const dateQuery = {};
    if (dateFrom) dateQuery.$gte = new Date(dateFrom);
    if (dateTo) dateQuery.$lte = new Date(dateTo);
    baseConditions.push({ createdAt: dateQuery });
  }

  // Build final query
  let query = {};
  
  if (search && search.trim()) {
    // Escape regex special characters
    const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = { $regex: safeSearch, $options: 'i' };
    
    // Combine base conditions with search using $and
    query = {
      $and: [
        // All base conditions must match
        ...baseConditions,
        // At least one search field must match
        {
          $or: [
            { mpesaReceiptNumber: searchRegex },
            { stkID: searchRegex },
            { checkoutRequestId: searchRegex },
            { accountId: searchRegex }
          ]
        }
      ]
    };
  } else {
    // No search - just apply base conditions
    if (baseConditions.length > 1) {
      query = { $and: baseConditions };
    } else if (baseConditions.length === 1) {
      query = baseConditions[0];
    }
  }

  console.log('🔍 Payment search query:', JSON.stringify(query, null, 2));

  const payments = await Payment.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

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
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
});


// ============================================================
// ALTERNATIVE SIMPLER APPROACH (if you prefer)
// ============================================================
exports.getAllPayments = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status = 'completed',
    dateFrom,
    dateTo,
    search
  } = req.query;

  // Start with region filter
  const query = { ...req.regionFilter };

  // Status filter (default completed)
  if (status) query.status = status;

  // Date range
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(dateTo);
  }

  // Search: Build separate query if search exists
  if (search && search.trim()) {
    const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = { $regex: safeSearch, $options: 'i' };
    
    // Create a new combined query using $and
    const finalQuery = {
      ...query,  // Keep all existing conditions
      $or: [
        { mpesaReceiptNumber: searchRegex },
        { stkID: searchRegex },
        { checkoutRequestId: searchRegex },
        { accountId: searchRegex }
      ]
    };
    
    // Replace query with the combined version
    Object.keys(query).forEach(key => delete query[key]);
    Object.assign(query, finalQuery);
  }

  console.log('🔍 Payment search query:', JSON.stringify(query, null, 2));

  const payments = await Payment.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

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
        pages: Math.ceil(total / parseInt(limit))
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


// ============= FINANCIAL ANALYSIS =============

/**
 * Helper to get date range from query parameters
 */
function getDateRange(dateFrom, dateTo) {
  const filter = {};
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }
  return filter;
}

/**
 * @desc    Get financial overview
 * @route   GET /api/finances/analysis/overview
 * @access  Private
 * @query   dateFrom, dateTo, customerType (pppoe|hotspot|all)
 */
exports.getFinancialOverview = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo, customerType = 'all' } = req.query;
  const dateFilter = getDateRange(dateFrom, dateTo);
  const regionFilter = req.regionFilter || {};

  // Build match conditions
  const matchConditions = {
    ...regionFilter,
    status: 'completed',
    ...dateFilter,
  };

  if (customerType !== 'all') {
    matchConditions.customerType = customerType;
  }

  const pipeline = [
    { $match: matchConditions },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$amount' },
        totalCount: { $sum: 1 },
        avgAmount: { $avg: '$amount' },
        minAmount: { $min: '$amount' },
        maxAmount: { $max: '$amount' },
        // Count by payment method
        mpesaCount: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'mpesa'] }, 1, 0] } },
        cashCount: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash'] }, 1, 0] } },
        bankCount: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'bank'] }, 1, 0] } },
        // Count by source
        stkCount: { $sum: { $cond: [{ $eq: ['$source', 'stk'] }, 1, 0] } },
        tillCount: { $sum: { $cond: [{ $eq: ['$source', 'till'] }, 1, 0] } },
        manualCount: { $sum: { $cond: [{ $eq: ['$source', 'manual_deposit'] }, 1, 0] } },
      },
    },
  ];

  const result = await Payment.aggregate(pipeline);
  const overview = result.length > 0 ? result[0] : null;

  // Get unique customer count
  const customerCountPipeline = [
    { $match: matchConditions },
    { $group: { _id: '$customerId' } },
    { $count: 'count' },
  ];
  const customerCountResult = await Payment.aggregate(customerCountPipeline);
  const uniqueCustomers = customerCountResult.length > 0 ? customerCountResult[0].count : 0;

  res.status(200).json({
    success: true,
    data: {
      totalRevenue: overview?.totalRevenue || 0,
      totalPayments: overview?.totalCount || 0,
      averageAmount: overview?.avgAmount || 0,
      minAmount: overview?.minAmount || 0,
      maxAmount: overview?.maxAmount || 0,
      uniqueCustomers,
      paymentMethods: {
        mpesa: overview?.mpesaCount || 0,
        cash: overview?.cashCount || 0,
        bank: overview?.bankCount || 0,
      },
      sources: {
        stk: overview?.stkCount || 0,
        till: overview?.tillCount || 0,
        manual: overview?.manualCount || 0,
      },
    },
  });
});

/**
 * @desc    Revenue by region (for PPPoE and overall)
 * @route   GET /api/finances/analysis/by-region
 * @access  Private
 * @query   dateFrom, dateTo, customerType (pppoe|hotspot|all)
 */
exports.getRevenueByRegion = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo, customerType = 'all' } = req.query;
  const dateFilter = getDateRange(dateFrom, dateTo);
  const regionFilter = req.regionFilter || {};

  const matchConditions = {
    ...regionFilter,
    status: 'completed',
    ...dateFilter,
  };

  if (customerType !== 'all') {
    matchConditions.customerType = customerType;
  }

  const pipeline = [
    { $match: matchConditions },
    {
      $group: {
        _id: '$regionCode',
        revenue: { $sum: '$amount' },
        count: { $sum: 1 },
        avgAmount: { $avg: '$amount' },
        // Hotspot vs PPPoE breakdown
        hotspotRevenue: {
          $sum: {
            $cond: [{ $eq: ['$customerType', 'hotspot'] }, '$amount', 0],
          },
        },
        hotspotCount: {
          $sum: {
            $cond: [{ $eq: ['$customerType', 'hotspot'] }, 1, 0],
          },
        },
        pppoeRevenue: {
          $sum: {
            $cond: [{ $eq: ['$customerType', 'pppoe'] }, '$amount', 0],
          },
        },
        pppoeCount: {
          $sum: {
            $cond: [{ $eq: ['$customerType', 'pppoe'] }, 1, 0],
          },
        },
      },
    },
    { $sort: { revenue: -1 } },
  ];

  const results = await Payment.aggregate(pipeline);

  // Get region names from sites
  const regionCodes = results.map((r) => r._id).filter(Boolean);
  const sites = await Site.find({ regionCode: { $in: regionCodes } })
    .select('regionCode name')
    .lean();

  const regionMap = {};
  sites.forEach((s) => {
    if (!regionMap[s.regionCode]) {
      regionMap[s.regionCode] = s.name;
    }
  });

  const enriched = results.map((r) => ({
    regionCode: r._id || 'unknown',
    regionName: regionMap[r._id] || r._id || 'Unknown',
    revenue: r.revenue,
    count: r.count,
    avgAmount: r.avgAmount,
    hotspotRevenue: r.hotspotRevenue,
    hotspotCount: r.hotspotCount,
    pppoeRevenue: r.pppoeRevenue,
    pppoeCount: r.pppoeCount,
  }));

  res.status(200).json({
    success: true,
    data: enriched,
  });
});

/**
 * @desc    Revenue by router (hotspot only)
 * @route   GET /api/finances/analysis/by-router
 * @access  Private
 * @query   dateFrom, dateTo
 */
exports.getRevenueByRouter = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo } = req.query;
  const dateFilter = getDateRange(dateFrom, dateTo);
  const regionFilter = req.regionFilter || {};

  const matchConditions = {
    ...regionFilter,
    status: 'completed',
    customerType: 'hotspot',
    ...dateFilter,
  };

  const pipeline = [
    { $match: matchConditions },
    // Extract nasIp from metadata
    {
      $addFields: {
        nasIp: { $ifNull: ['$metadata.nasIp', null] },
      },
    },
    { $match: { nasIp: { $ne: null } } },
    {
      $group: {
        _id: '$nasIp',
        revenue: { $sum: '$amount' },
        count: { $sum: 1 },
        avgAmount: { $avg: '$amount' },
        // Get a sample router name from the site? We'll look up later.
      },
    },
    { $sort: { revenue: -1 } },
  ];

  const results = await Payment.aggregate(pipeline);

  // Look up router names and site names
  const routerIps = results.map((r) => r._id).filter(Boolean);
  const routers = await Router.find({ ip: { $in: routerIps } })
    .populate('site', 'name')
    .select('ip name site')
    .lean();

  const routerMap = {};
  routers.forEach((r) => {
    routerMap[r.ip] = {
      name: r.name,
      siteName: r.site?.name || 'Unknown',
    };
  });

  const enriched = results.map((r) => ({
    nasIp: r._id,
    routerName: routerMap[r._id]?.name || r._id,
    siteName: routerMap[r._id]?.siteName || 'Unknown',
    revenue: r.revenue,
    count: r.count,
    avgAmount: r.avgAmount,
  }));

  res.status(200).json({
    success: true,
    data: enriched,
  });
});

/**
 * @desc    Monthly revenue trend
 * @route   GET /api/finances/analysis/monthly-trend
 * @access  Private
 * @query   months (number of months to go back), customerType
 */
exports.getMonthlyTrend = asyncHandler(async (req, res, next) => {
  const { months = 12, customerType = 'all' } = req.query;
  const regionFilter = req.regionFilter || {};

  const matchConditions = {
    ...regionFilter,
    status: 'completed',
  };

  if (customerType !== 'all') {
    matchConditions.customerType = customerType;
  }

  const pipeline = [
    { $match: matchConditions },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
        },
        revenue: { $sum: '$amount' },
        count: { $sum: 1 },
        avgAmount: { $avg: '$amount' },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
    // Limit to last X months
    {
      $match: {
        $expr: {
          $gte: [
            { $dateFromParts: { year: '$_id.year', month: '$_id.month', day: 1 } },
            { $dateSubtract: { startDate: new Date(), unit: 'month', amount: parseInt(months) } },
          ],
        },
      },
    },
  ];

  const results = await Payment.aggregate(pipeline);

  const formatted = results.map((r) => ({
    month: `${r._id.year}-${String(r._id.month).padStart(2, '0')}`,
    revenue: r.revenue,
    count: r.count,
    avgAmount: r.avgAmount,
  }));

  res.status(200).json({
    success: true,
    data: formatted,
  });
});

/**
 * @desc    ARPU (Average Revenue Per User) by customer type
 * @route   GET /api/finances/analysis/arpu
 * @access  Private
 * @query   dateFrom, dateTo
 */
exports.getArpu = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo } = req.query;
  const dateFilter = getDateRange(dateFrom, dateTo);
  const regionFilter = req.regionFilter || {};

  const matchConditions = {
    ...regionFilter,
    status: 'completed',
    ...dateFilter,
  };

  // Get total revenue and unique customers per customer type
  const pipeline = [
    { $match: matchConditions },
    {
      $group: {
        _id: '$customerType',
        revenue: { $sum: '$amount' },
        uniqueCustomers: { $addToSet: '$customerId' },
      },
    },
    {
      $project: {
        customerType: '$_id',
        revenue: 1,
        uniqueCustomerCount: { $size: '$uniqueCustomers' },
        arpu: { $divide: ['$revenue', { $size: '$uniqueCustomers' }] },
      },
    },
  ];

  const results = await Payment.aggregate(pipeline);

  const formatted = results.map((r) => ({
    customerType: r.customerType || 'unknown',
    revenue: r.revenue,
    uniqueCustomers: r.uniqueCustomerCount,
    arpu: r.arpu || 0,
  }));

  // Also compute overall
  const overallPipeline = [
    { $match: matchConditions },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$amount' },
        uniqueCustomers: { $addToSet: '$customerId' },
      },
    },
    {
      $project: {
        revenue: 1,
        uniqueCustomerCount: { $size: '$uniqueCustomers' },
        arpu: { $divide: ['$revenue', { $size: '$uniqueCustomers' }] },
      },
    },
  ];

  const overallResult = await Payment.aggregate(overallPipeline);
  const overall = overallResult.length > 0 ? overallResult[0] : null;

  res.status(200).json({
    success: true,
    data: {
      byType: formatted,
      overall: {
        revenue: overall?.revenue || 0,
        uniqueCustomers: overall?.uniqueCustomerCount || 0,
        arpu: overall?.arpu || 0,
      },
    },
  });
});

/**
 * @desc    Period-over-period comparison
 * @route   GET /api/finances/analysis/comparison
 * @access  Private
 * @query   period (month|quarter|year), compareWith (previous|same_period_last_year), customerType
 */
exports.getComparison = asyncHandler(async (req, res, next) => {
  const { period = 'month', compareWith = 'previous', customerType = 'all' } = req.query;
  const regionFilter = req.regionFilter || {};

  // Determine current and comparison date ranges
  const now = new Date();
  let currentStart, currentEnd, compareStart, compareEnd;

  if (period === 'month') {
    // Current: this month to date
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    if (compareWith === 'previous') {
      // Previous month
      compareStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      compareEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    } else {
      // Same month last year
      compareStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      compareEnd = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0, 23, 59, 59);
    }
  } else if (period === 'quarter') {
    // Current quarter
    const currentQuarter = Math.floor(now.getMonth() / 3);
    currentStart = new Date(now.getFullYear(), currentQuarter * 3, 1);
    currentEnd = new Date(now.getFullYear(), currentQuarter * 3 + 3, 0, 23, 59, 59);
    if (compareWith === 'previous') {
      const prevQuarter = currentQuarter - 1;
      const prevYear = prevQuarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const prevQuarterIndex = (prevQuarter + 4) % 4;
      compareStart = new Date(prevYear, prevQuarterIndex * 3, 1);
      compareEnd = new Date(prevYear, prevQuarterIndex * 3 + 3, 0, 23, 59, 59);
    } else {
      compareStart = new Date(now.getFullYear() - 1, currentQuarter * 3, 1);
      compareEnd = new Date(now.getFullYear() - 1, currentQuarter * 3 + 3, 0, 23, 59, 59);
    }
  } else if (period === 'year') {
    currentStart = new Date(now.getFullYear(), 0, 1);
    currentEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    if (compareWith === 'previous') {
      compareStart = new Date(now.getFullYear() - 1, 0, 1);
      compareEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
    } else {
      compareStart = new Date(now.getFullYear() - 1, 0, 1);
      compareEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
    }
  } else {
    return next(new ErrorResponse('Invalid period. Use month, quarter, or year.', 400));
  }

  const baseMatch = {
    ...regionFilter,
    status: 'completed',
  };
  if (customerType !== 'all') baseMatch.customerType = customerType;

  const getPeriodStats = async (start, end) => {
    const match = { ...baseMatch, createdAt: { $gte: start, $lte: end } };
    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$amount' },
          count: { $sum: 1 },
          avgAmount: { $avg: '$amount' },
        },
      },
    ];
    const result = await Payment.aggregate(pipeline);
    return result.length > 0
      ? result[0]
      : { revenue: 0, count: 0, avgAmount: 0 };
  };

  const currentStats = await getPeriodStats(currentStart, currentEnd);
  const compareStats = await getPeriodStats(compareStart, compareEnd);

  const revenueChange = currentStats.revenue - compareStats.revenue;
  const revenueChangePercent = compareStats.revenue > 0
    ? (revenueChange / compareStats.revenue) * 100
    : 0;

  res.status(200).json({
    success: true,
    data: {
      period,
      compareWith,
      currentPeriod: {
        start: currentStart,
        end: currentEnd,
        revenue: currentStats.revenue,
        count: currentStats.count,
        avgAmount: currentStats.avgAmount,
      },
      previousPeriod: {
        start: compareStart,
        end: compareEnd,
        revenue: compareStats.revenue,
        count: compareStats.count,
        avgAmount: compareStats.avgAmount,
      },
      comparison: {
        revenueChange: revenueChange,
        revenueChangePercent: revenueChangePercent,
        countChange: currentStats.count - compareStats.count,
        direction: revenueChange >= 0 ? 'increase' : 'decrease',
      },
    },
  });
});