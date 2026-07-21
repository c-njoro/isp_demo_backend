const Customer = require("../models/Customer");
const { ErrorResponse } = require("../middleware/errorHandler");
const asyncHandler = require("../middleware/asyncHandler");
const operationsService = require("../services/operationsService");
const {getAnUnprocessedPayment, resolvePayment} = require("./paymentControllerKopoKopo")

// ─────────────────────────────────────────────
// INBOUND: Called by the Operations system
// POST /api/v2/inter-system/customers
// ─────────────────────────────────────────────

/**
 * @desc    Allow the Operations system to fetch customers with the same
 *          filters available on the internal getCustomers endpoint.
 * @route   POST /api/v2/inter-system/customers
 * @access  Inter-system only (verifyInterSystemSignature middleware)
 */
exports.getCustomersForOperations = async (req, res) => {
  if (req.body.action !== "get_customers") {
    return res.status(400).json({
      success: false,
      statusCode: 400,
      message: "Invalid action",
    });
  }

  try {
    const {
      page = 1,
      limit = 13,
      search,
      status,
      packageId,
      siteId,
      city,
      subLocation,
      localArea,
      nasIp,
      sortBy = "accountId",
      sortOrder = "asc",
      regionCode,           // Operations can scope by region if needed
    } = req.body;

    // Build query
    const query = {};

    // Region filter — Operations must pass a regionCode or it gets all
    if (regionCode) {
      query.regionCode = regionCode;
    }

    // Status filter — mirrors getCustomers exactly
    if (status === "disabled") {
      query.isActive = false;
    } else if (status) {
      query.isActive = true;
      query["subscription.status"] = status;
    } else {
      query.isActive = true;
    }

    // Search — mirrors the multi-word and single-term logic from getCustomers
    if (search) {
      const cleanSearch = search.trim();
      const terms = cleanSearch.split(/\s+/);

      if (terms.length >= 2) {
        query.$or = [
          {
            $and: terms.map((term, i) => ({
              [i === 0 ? "firstName" : "lastName"]: {
                $regex: term,
                $options: "i",
              },
            })),
          },
          {
            $and: [
              { lastName: { $regex: terms[0], $options: "i" } },
              { firstName: { $regex: terms[1], $options: "i" } },
            ],
          },
          { accountId: { $regex: cleanSearch, $options: "i" } },
          { phoneNumber: { $regex: cleanSearch, $options: "i" } },
          { "pppoe.username": { $regex: cleanSearch, $options: "i" } },
          { city: { $regex: cleanSearch, $options: "i" } },
          { sublocation: { $regex: cleanSearch, $options: "i" } },
          { localArea: { $regex: cleanSearch, $options: "i" } },
        ];
      } else {
        query.$or = [
          { accountId: { $regex: cleanSearch, $options: "i" } },
          { firstName: { $regex: cleanSearch, $options: "i" } },
          { lastName: { $regex: cleanSearch, $options: "i" } },
          { phoneNumber: { $regex: cleanSearch, $options: "i" } },
          { "pppoe.username": { $regex: cleanSearch, $options: "i" } },
          { city: { $regex: cleanSearch, $options: "i" } },
          { sublocation: { $regex: cleanSearch, $options: "i" } },
          { localArea: { $regex: cleanSearch, $options: "i" } },
        ];
      }
    }

    // Field filters — mirrors getCustomers
    if (packageId) query["subscription.packageId"] = packageId;
    if (siteId)    query.siteId = siteId;
    if (city)      query.city = { $regex: city, $options: "i" };
    if (subLocation) query.subLocation = { $regex: subLocation, $options: "i" };
    if (localArea) query.localArea = { $regex: localArea, $options: "i" };
    if (nasIp)     query.nasIp = nasIp;

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [customers, total] = await Promise.all([
      Customer.find(query)
        .populate("subscription.packageId", "packageName price")
        .populate("siteId", "name regionCode")
        // Strip sensitive fields — Operations does not need PPPoE passwords
        .select(
          "-pppoe.password -cpe.wifiPassword"
        )
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Customer.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      data: {
        customers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("[interSystemController] getCustomersForOperations error:", error.message);
    return res.status(500).json({
      success: false,
      statusCode: 500,
      message: "Internal Server Error",
    });
  }
};

// ─────────────────────────────────────────────
// INBOUND: Fetch a single customer by accountId
// POST /api/v2/inter-system/customers/single
// ─────────────────────────────────────────────

/**
 * @desc    Allow the Operations system to fetch a single customer by accountId or _id.
 * @route   POST /api/v2/inter-system/customers/single
 * @access  Inter-system only (verifyInterSystemSignature middleware)
 */
exports.getSingleCustomerForOperations = async (req, res) => {
  if (req.body.action !== "get_customer") {
    return res.status(400).json({
      success: false,
      statusCode: 400,
      message: "Invalid action",
    });
  }

  try {
    const { accountId, customerId } = req.body;

    if (!accountId && !customerId) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: "Provide either accountId or customerId",
      });
    }

    const filter = accountId
      ? { accountId }
      : { _id: customerId };

    const customer = await Customer.findOne(filter)
      .populate("subscription.packageId", "packageName price")
      .populate("siteId", "name regionCode")
      .select("-pppoe.password -cpe.wifiPassword")
      .lean();

    if (!customer) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: "Customer not found",
      });
    }

    return res.status(200).json({
      success: true,
      statusCode: 200,
      data: { customer },
    });
  } catch (error) {
    console.error("[interSystemController] getSingleCustomerForOperations error:", error.message);
    return res.status(500).json({
      success: false,
      statusCode: 500,
      message: "Internal Server Error",
    });
  }
};




/**
 * @desc    Get all leads (paginated, filterable)
 * @route   GET /api/operations/leads
 * @access  Private (Admin only)
 */
exports.getLeads = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, search } = req.query;
  console.log("getLeads called with:", { page, limit, search }); // <-- add

  const result = await operationsService.fetchAllLeads({
    page: parseInt(page),
    limit: parseInt(limit),
    search,
  });

  console.log("fetchAllLeads result:", JSON.stringify(result, null, 2)); // <-- add

  res.json({
    success: true,
    data: result.leads,
    pagination: result.pagination,
  });
});

/**
 * @desc    Get all reports (paginated, filterable)
 * @route   GET /api/operations/reports
 * @access  Private (Admin only)
 */
exports.getReports = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, search } = req.query;
  
  const result = await operationsService.fetchAllReports({
    page: parseInt(page),
    limit: parseInt(limit),
    search,
  });
  
  res.json({
    success: true,
    data: result.reports,
    pagination: result.pagination,
  });
});


exports.getLeadById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!id) return next(new ErrorResponse("Lead ID required", 400));
  const lead = await operationsService.fetchLeadById(parseInt(id));
  if (!lead) return next(new ErrorResponse("Lead not found", 404));
  res.json({ success: true, data: lead });
});

exports.getReportById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!id) return next(new ErrorResponse("Report ID required", 400));
  const report = await operationsService.fetchReportById(parseInt(id));
  if (!report) return next(new ErrorResponse("Report not found", 404));
  res.json({ success: true, data: report });
});


// ─────────────────────────────────────────────
// INBOUND: Get a single unprocessed payment by receipt
// POST /api/v2/inter-system/payments/unprocessed/single
// ─────────────────────────────────────────────

/**
 * @desc    Get a single unprocessed payment by receipt (for Operations)
 * @route   POST /api/v2/inter-system/payments/unprocessed/single
 * @access  Inter-system only (verifyInterSystemSignature middleware)
 *
 * Payload: { receipt: string }  (receipt number)
 * Response: same as GET /api/payments/unprocessed/:receipt
 */
exports.getUnprocessedPaymentForOperations = asyncHandler(async (req, res, next) => {

  if (req.body.action !== "get_unprocessed_payment") {
    return res.status(400).json({
      success: false,
      statusCode: 400,
      message: "Invalid action",
    });
  }
  const { receipt } = req.body;
  if (!receipt) {
    return next(new ErrorResponse("Receipt number is required", 400));
  }
  // Map body.receipt to req.params.receipt as original expects
  req.params.receipt = receipt;
  return getAnUnprocessedPayment(req, res, next);
});


// ─────────────────────────────────────────────
// INBOUND: Resolve an unprocessed payment
// POST /api/v2/inter-system/payments/resolve
// ─────────────────────────────────────────────

/**
 * @desc    Resolve an unprocessed payment (for Operations)
 * @route   POST /api/v2/inter-system/payments/resolve
 * @access  Inter-system only (verifyInterSystemSignature middleware)
 *
 * Payload: {
 *   receiptNumber: string,
 *   customerId: string,
 *   customerType: 'pppoe' | 'hotspot'
 * }
 * Response: same as POST /api/payments/resolve
 */
exports.resolvePaymentForOperations = asyncHandler(async (req, res, next) => {


  if (req.body.action !== "resolve_customer_payment") {
    return res.status(400).json({
      success: false,
      statusCode: 400,
      message: "Invalid action",
    });
  }

  return resolvePayment(req, res, next);
});