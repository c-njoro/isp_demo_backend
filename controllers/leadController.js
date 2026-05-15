const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const Package = require('../models/Package');
const Site = require('../models/Site');
const User = require('../models/User');
const Payment = require('../models/Payment');
const UnprocessedPayment = require('../models/UnprocessedPayment');
const SystemLog = require('../models/SystemLog');
const SmsLog = require("../models/SmsLog")
const {
  generateLeadNumber,
  calculateLeadScore,
  getLeadStats,
  getLeadsNeedingFollowUp,
  getConversionFunnel,
  getTopLeadSources
} = require('../utils/leadHelpers');
const { formatPhoneNumber } = require('../utils/phoneHelpers');
const { generateAccountId, generatePPPoEPassword, generateWiFiPassword } = require('../utils/accountHelpers');


async function logSms(recipient, message, type, regionCode, providerResponse, status, cost, error = null) {
  const logData = {
    recipient: {
      phoneNumber: recipient.phoneNumber,
      customerId: recipient.customerId || null,
      accountId: recipient.accountId || null
    },
    message,
    type,
    regionCode,
    provider: 'mobile_sasa',
    messageId: providerResponse?.messageId || providerResponse?.bulkId || null,
    status,
    cost: cost || null,
    sentAt: status === 'sent' ? new Date() : null,
    error: error ? { code: error.code, message: error.message } : null
  };
  await SmsLog.create(logData);
}

// @desc    Get all leads
// @route   GET /api/leads
// @access  Private
exports.getLeads = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
    source,
    priority,
    assignedTo,
    minScore,
    followUpOverdue,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  // Build query with region filter
  const query = { ...req.regionFilter };

  // Add search
  if (search) {
    query.$or = [
      { leadNumber: { $regex: search, $options: 'i' } },
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { phoneNumber: { $regex: search, $options: 'i' } }
    ];
  }

  // Add filters
  if (status) {
    query.status = status;
  }

  if (source) {
    query.source = source;
  }

  if (priority) {
    query.priority = priority;
  }

  if (assignedTo) {
    query.assignedTo = assignedTo;
  }

  if (minScore) {
    query.leadScore = { $gte: parseInt(minScore) };
  }

  if (followUpOverdue === 'true') {
    query.nextFollowUpDate = { $exists: true, $lt: new Date() };
    query.status = { $nin: ['won', 'lost'] };
  }

  // Build sort
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Execute query
  const leads = await Lead.find(query)
    .populate('assignedTo', 'firstName lastName')
    .populate('interestedPackage', 'packageName price')
    .populate('siteId', 'siteName regionCode')
    
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Lead.countDocuments(query);

  res.status(200).json({
    success: true,
    message: 'Leads retrieved successfully',
    data: {
      leads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get single lead
// @route   GET /api/leads/:id
// @access  Private
exports.getLead = asyncHandler(async (req, res, next) => {
  const lead = await Lead.findById(req.params.id)
    .populate('assignedTo', 'firstName lastName email phoneNumber')
    .populate('interestedPackage')
    .populate('siteId')
    .populate('referredBy.customerId', 'firstName lastName accountId')
    .populate('convertedCustomerId', 'accountId firstName lastName')
    .populate('interactions.interactedBy', 'firstName lastName')
    .populate('siteSurvey.surveyedBy', 'firstName lastName')
    .populate('createdBy', 'firstName lastName');

  if (!lead) {
    return next(new ErrorResponse('Lead not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && lead.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this lead', 403));
  }

  res.status(200).json({
    success: true,
    message: 'Lead retrieved successfully',
    data: lead
  });
});

// @desc    Create lead
// @route   POST /api/leads
// @access  Private
exports.createLead = asyncHandler(async (req, res, next) => {
  const {
    firstName,
    lastName,
    email,
    phoneNumber,
    alternatePhoneNumber,
    location,
    source,
    sourceDetails,
    interestedPackage,
    estimatedBudget,
    priority,
    assignedTo,
    siteId,
    referredBy,
    notes,
    paymentStatus  // { paid: true, mpesaCode: "XXXXXXX" }
  } = req.body;
 
  // Validate required fields
  if (!firstName || !lastName || !phoneNumber || !source || !siteId) {
    return next(new ErrorResponse('Please provide all required fields', 400));
  }
 
  // Verify site exists
  const site = await Site.findById(siteId);
  if (!site) {
    return next(new ErrorResponse('Site not found', 404));
  }
 
  // Check region access
  if (req.regionFilter.regionCode && site.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this site', 403));
  }
 
  // Format phone number
  const formattedPhone = formatPhoneNumber(phoneNumber);
 
  // Check if phone number already exists as lead or customer
  const existingLead = await Lead.findOne({
    phoneNumber: formattedPhone,
    status: { $nin: ['won', 'lost'] }
  });
 
  if (existingLead) {
    return next(new ErrorResponse('Phone number already exists as active lead', 400));
  }
 
  const existingCustomer = await Customer.findOne({ phoneNumber: formattedPhone });
  if (existingCustomer) {
    return next(new ErrorResponse('Phone number already registered as customer', 400));
  }
 
  // Generate lead number
  const leadNumber = await generateLeadNumber(site.regionCode);
 
  // Verify assigned user if provided
  if (assignedTo) {
    const user = await User.findById(assignedTo);
    if (!user) {
      return next(new ErrorResponse('Assigned user not found', 404));
    }
  }
 
  // Validate and process payment if provided
  let paymentRecord = null;
  let processedPaymentStatus = {
    paid: false,
    mpesaCode: null,
    amount: 0
  };
 
  if (paymentStatus?.paid && paymentStatus?.mpesaCode) {
    const receiptNumber = paymentStatus.mpesaCode;
 
    // Check if receipt already used
    const existingPayment = await Payment.findOne({ mpesaReceiptNumber: receiptNumber });
    if (existingPayment) {
      return next(new ErrorResponse('This receipt has already been processed', 400));
    }
 
    // Find unprocessed payment
    const unprocessed = await UnprocessedPayment.findOne({ 
      receiptNumber, 
      status: 'new' 
    });
 
    if (!unprocessed) {
      return next(new ErrorResponse('Receipt not found or already resolved', 404));
    }
 
    // Verify phone number matches
    // const leadPhone = formattedPhone.replace(/\D/g, '');
    // const unprocessedPhone = unprocessed.phoneNumber.replace(/\D/g, '');
    
    // if (!leadPhone.includes(unprocessedPhone.slice(-9)) && !unprocessedPhone.includes(leadPhone.slice(-9))) {
    //   return next(new ErrorResponse('Receipt phone number does not match lead phone number', 400));
    // }
 
    // Create payment record (will be linked after lead creation)
    processedPaymentStatus = {
      paid: true,
      mpesaCode: receiptNumber,
      amount: unprocessed.amount
    };
 
    // Store unprocessed for later processing
    paymentRecord = {
      unprocessed,
      receiptNumber
    };
  }
 
  // Create lead
  const lead = await Lead.create({
    leadNumber,
    regionCode: site.regionCode,
    siteId,
    firstName,
    lastName,
    email,
    phoneNumber: formattedPhone,
    alternatePhoneNumber: alternatePhoneNumber ? formatPhoneNumber(alternatePhoneNumber) : undefined,
    location,
    source,
    sourceDetails,
    interestedPackage,
    interestedPackageName: interestedPackage ? (await Package.findById(interestedPackage))?.packageName : undefined,
    estimatedBudget,
    priority: priority || 'medium',
    assignedTo,
    assignedAt: assignedTo ? Date.now() : undefined,
    referredBy,
    createdBy: req.session.userId,
    createdByName: req.user.firstName + ' ' + req.user.lastName,
    paymentStatus: processedPaymentStatus
  });
 
  // Calculate initial lead score
  lead.leadScore = calculateLeadScore(lead);
  await lead.save();
 
  // Process payment if provided
  if (paymentRecord) {
    const { unprocessed, receiptNumber } = paymentRecord;
 
    // Create payment record
    const payment = await Payment.create({
      stkID: `LEAD-${receiptNumber}`,
      checkoutRequestId: receiptNumber,
      customerType: 'lead',
      customerId: null,
      accountId: lead.leadNumber,
      regionCode: lead.regionCode,
      siteId: lead.siteId,
      amount: unprocessed.amount,
      packageId: lead.interestedPackage || null,
      status: 'completed',
      stkPush: {
        phoneNumber: unprocessed.phoneNumber,
        initiatedAt: unprocessed.transactionDate || new Date()
      },
      mpesaReceiptNumber: receiptNumber,
      callbackReceived: true,
      callbackData: unprocessed.rawData,
      source: 'manual',
      resolutionStatus: 'processed',
      metadata: {
        leadId: lead._id,
        leadNumber: lead.leadNumber,
        createdWithLead: true
      }
    });
 
    // Mark unprocessed as matched
    unprocessed.status = 'matched';
    unprocessed.matchedWith = {
      type: 'lead',
      id: lead._id,
    };
    await unprocessed.save();
 
    // Add payment interaction
    lead.interactions.push({
      interactionType: 'note',
      notes: `Lead created with payment: KES ${unprocessed.amount} (Receipt: ${receiptNumber})`,
      outcome: 'successful',
      interactedBy: req.session.userId,
      interactedByName: req.user.firstName + ' ' + req.user.lastName
    });
    await lead.save();
  }
 
  // Add initial interaction if notes provided
  if (notes) {
    lead.interactions.push({
      interactionType: 'note',
      notes,
      interactedBy: req.session.userId,
      interactedByName: req.user.firstName + ' ' + req.user.lastName
    });
    await lead.save();
  }
 
  // Log creation
  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'info',
    regionCode: lead.regionCode,
    entityType: 'lead',
    entityId: lead._id,
    message: `Lead created: ${lead.leadNumber}${processedPaymentStatus.paid ? ` with payment KES ${processedPaymentStatus.amount}` : ''}`,
    triggeredBy: req.session.userId,
    success: true
  });
 
  await lead.populate('assignedTo interestedPackage siteId');
 
  res.status(201).json({
    success: true,
    message: `Lead created successfully${processedPaymentStatus.paid ? ` with payment KES ${processedPaymentStatus.amount}` : ''}`,
    data: lead
  });
});

// @desc    Resolve unprocessed payment and mark lead as paid
// @route   POST /api/leads/:id/mark-paid
// @access  Private
exports.markLeadAsPaid = asyncHandler(async (req, res, next) => {
  const { receiptNumber } = req.body;
 
  if (!receiptNumber) {
    return next(new ErrorResponse('Receipt number is required', 400));
  }
 
  // Find the lead
  const lead = await Lead.findById(req.params.id);
  if (!lead) {
    return next(new ErrorResponse('Lead not found', 404));
  }
 
  // Check region access
  if (req.regionFilter.regionCode && lead.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this lead', 403));
  }
 
  // Check if receipt already used for this lead
  if (lead.paymentStatus.paid && lead.paymentStatus.mpesaCode?.includes(receiptNumber)) {
    return next(new ErrorResponse('This receipt has already been applied to this lead', 400));
  }
 
  // Check if already used as customer payment
  const existingPayment = await Payment.findOne({ mpesaReceiptNumber: receiptNumber });
  if (existingPayment) {
    return next(new ErrorResponse('This receipt has already been processed as a customer payment', 400));
  }
 
  // Find the unprocessed payment
  const unprocessed = await UnprocessedPayment.findOne({ 
    receiptNumber, 
    status: 'new' 
  });
 
  if (!unprocessed) {
    return next(new ErrorResponse('Receipt not found or already resolved', 404));
  }
 
  // Verify phone number matches (optional but recommended)
  const leadPhone = lead.phoneNumber.replace(/\D/g, '');
  const unprocessedPhone = unprocessed.phoneNumber.replace(/\D/g, '');
  
  if (!leadPhone.includes(unprocessedPhone.slice(-9)) && !unprocessedPhone.includes(leadPhone.slice(-9))) {
    console.warn(`⚠️  Phone mismatch: Lead ${leadPhone} vs Payment ${unprocessedPhone}`);
    // Allow but log warning
  }
 
  // Create payment record for the lead
  const payment = await Payment.create({
    stkID: `LEAD-${receiptNumber}`,
    checkoutRequestId: receiptNumber,
    customerType: 'lead',
    leadId: lead._id,  // No customer yet
    accountId: lead.leadNumber,
    regionCode: lead.regionCode,
    siteId: lead.siteId,
    amount: unprocessed.amount,
    packageId: lead.interestedPackage || null,
    status: 'completed',
    stkPush: {
      phoneNumber: unprocessed.phoneNumber,
      initiatedAt: unprocessed.transactionDate || new Date()
    },
    mpesaReceiptNumber: receiptNumber,
    callbackReceived: true,
    callbackData: unprocessed.rawData,
    source: 'manual',
    resolutionStatus: 'processed',
    metadata: {
      leadId: lead._id,
      leadNumber: lead.leadNumber,
      resolvedBy: req.session.userId,
      resolvedAt: new Date()
    }
  });
 
  // Update lead payment status
  if (lead.paymentStatus.paid) {
    // Add to existing payment
    lead.paymentStatus.amount += unprocessed.amount;
    lead.paymentStatus.mpesaCode += `, ${receiptNumber}`;
  } else {
    // First payment
    lead.paymentStatus.paid = true;
    lead.paymentStatus.mpesaCode = receiptNumber;
    lead.paymentStatus.amount = unprocessed.amount;
  }
 
  await lead.save();
 
  // Mark unprocessed as matched
  unprocessed.status = 'matched';
  unprocessed.matchedWith = {
    type: 'Lead',
    id: lead._id,
  };
  await unprocessed.save();
 
  // Add interaction to lead
  lead.interactions.push({
    interactionType: 'note',
    notes: `Payment marked: KES ${unprocessed.amount} (Receipt: ${receiptNumber})`,
    outcome: 'successful',
    interactedBy: req.session.userId,
    interactedByName: req.user.firstName + ' ' + req.user.lastName
  });
  await lead.save();
 
  // Log action
  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'info',
    regionCode: lead.regionCode,
    entityType: 'lead',
    entityId: lead._id,
    message: `Payment marked for lead ${lead.leadNumber}: KES ${unprocessed.amount}`,
    triggeredBy: req.session.userId,
    success: true
  });
 
  res.status(200).json({
    success: true,
    message: `Payment marked successfully. Total paid: KES ${lead.paymentStatus.amount}`,
    data: {
      lead,
      payment,
      totalPaid: lead.paymentStatus.amount
    }
  });
});
 

// @desc    Update lead
// @route   PUT /api/leads/:id
// @access  Private
exports.updateLead = asyncHandler(async (req, res, next) => {
  let lead = await Lead.findById(req.params.id);

  if (!lead) {
    return next(new ErrorResponse('Lead not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && lead.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this lead', 403));
  }

  const {
    firstName,
    lastName,
    email,
    phoneNumber,
    alternatePhoneNumber,
    location,
    status,
    priority,
    interestedPackage,
    estimatedBudget,
    nextFollowUpDate,
    notes,
    paymentStatus
  } = req.body;

  // Update allowed fields
  if (firstName) lead.firstName = firstName;
  if (lastName) lead.lastName = lastName;
  if (email) lead.email = email;
  if (location) lead.location = { ...lead.location, ...location };
  if (priority) lead.priority = priority;
  if (interestedPackage) {
    lead.interestedPackage = interestedPackage;
    const pkg = await Package.findById(interestedPackage);
    lead.interestedPackageName = pkg?.packageName;
  }
  if (estimatedBudget) lead.estimatedBudget = estimatedBudget;
  if (nextFollowUpDate) lead.nextFollowUpDate = nextFollowUpDate;

  // Phone numbers need validation
  if (phoneNumber) {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const existingLead = await Lead.findOne({
      phoneNumber: formattedPhone,
      _id: { $ne: lead._id }
    });
    if (existingLead) {
      return next(new ErrorResponse('Phone number already exists', 400));
    }
    lead.phoneNumber = formattedPhone;
  }

  if (alternatePhoneNumber) {
    lead.alternatePhoneNumber = formatPhoneNumber(alternatePhoneNumber);
  }

  // Status change requires interaction log
  if (status && status !== lead.status) {
    lead.status = status;
    lead.interactions.push({
      interactionType: 'note',
      notes: `Status changed to ${status}`,
      interactedBy: req.session.userId,
      interactedByName: req.user.firstName + ' ' + req.user.lastName
    });
  }

  if (notes) {
    lead.interactions.push({
      interactionType: 'note',
      notes,
      interactedBy: req.session.userId,
      interactedByName: req.user.firstName + ' ' + req.user.lastName
    });
  }

  if(paymentStatus){
    lead.paymentStatus = paymentStatus;
  }

  // Recalculate lead score
  lead.leadScore = calculateLeadScore(lead);

  await lead.save();

  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'info',
    regionCode: lead.regionCode,
    entityType: 'lead',
    entityId: lead._id,
    message: `Lead updated: ${lead.leadNumber}`,
    triggeredBy: req.session.userId,
    success: true
  });

  await lead.populate('assignedTo interestedPackage siteId');

  res.status(200).json({
    success: true,
    message: 'Lead updated successfully',
    data: lead
  });
});

// @desc    Add interaction to lead
// @route   POST /api/leads/:id/interactions
// @access  Private
exports.addInteraction = asyncHandler(async (req, res, next) => {
  const { interactionType, subject, notes, outcome, nextAction } = req.body;

  if (!interactionType || !notes) {
    return next(new ErrorResponse('Interaction type and notes are required', 400));
  }

  const lead = await Lead.findById(req.params.id);

  if (!lead) {
    return next(new ErrorResponse('Lead not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && lead.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this lead', 403));
  }

  // Add interaction
  lead.interactions.push({
    interactionType,
    subject,
    notes,
    outcome,
    nextAction,
    interactedBy: req.session.userId,
    interactedByName: req.user.firstName + ' ' + req.user.lastName,
    interactionDate: Date.now()
  });

  lead.lastContactedAt = Date.now();
  lead.followUpCount += 1;

  // Recalculate lead score
  lead.leadScore = calculateLeadScore(lead);

  await lead.save();

  res.status(200).json({
    success: true,
    message: 'Interaction added successfully',
    data: lead
  });
});

// @desc    Assign lead to user
// @route   PUT /api/leads/:id/assign
// @access  Private
exports.assignLead = asyncHandler(async (req, res, next) => {
  const { userId } = req.body;

  if (!userId) {
    return next(new ErrorResponse('User ID is required', 400));
  }

  const lead = await Lead.findById(req.params.id);

  if (!lead) {
    return next(new ErrorResponse('Lead not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && lead.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this lead', 403));
  }

  // Verify user exists
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  if(user.department !== 'technical'){
    return next(new ErrorResponse('A lead can only be assigned to a technician for installation', 404));
  }

  lead.assignedTo = userId;
  lead.assignedAt = Date.now();

  lead.interactions.push({
    interactionType: 'note',
    notes: `Lead assigned to ${user.firstName} ${user.lastName}`,
    interactedBy: req.session.userId,
    interactedByName: req.user.firstName + ' ' + req.user.lastName
  });

  await lead.save();

  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'info',
    regionCode: lead.regionCode,
    entityType: 'lead',
    entityId: lead._id,
    message: `Lead ${lead.leadNumber} assigned to ${user.firstName} ${user.lastName}`,
    triggeredBy: req.session.userId,
    success: true
  });

  await lead.populate('assignedTo');

  res.status(200).json({
    success: true,
    message: 'Lead assigned successfully',
    data: lead
  });
});

// @desc    Add site survey to lead
// @route   POST /api/leads/:id/site-survey
// @access  Private
exports.addSiteSurvey = asyncHandler(async (req, res, next) => {
  const {
    findings,
    installationFeasible,
    estimatedInstallationCost,
    requiredEquipment,
    signalStrength,
    distance,
    photos
  } = req.body;

  const lead = await Lead.findById(req.params.id);

  if (!lead) {
    return next(new ErrorResponse('Lead not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && lead.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this lead', 403));
  }

  lead.siteSurvey = {
    surveyDone: true,
    surveyDate: Date.now(),
    surveyedBy: req.session.userId,
    findings,
    installationFeasible,
    estimatedInstallationCost,
    requiredEquipment,
    signalStrength,
    distance,
    photos
  };

  // Update status if appropriate
  if (lead.status === 'qualified' || lead.status === 'contacted') {
    lead.status = 'site_visit';
  }

  // Recalculate lead score
  lead.leadScore = calculateLeadScore(lead);

  await lead.save();

  lead.interactions.push({
    interactionType: 'site_visit',
    notes: `Site survey completed. Feasible: ${installationFeasible ? 'Yes' : 'No'}`,
    interactedBy: req.session.userId,
    interactedByName: req.user.firstName + ' ' + req.user.lastName
  });

  await lead.save();

  res.status(200).json({
    success: true,
    message: 'Site survey added successfully',
    data: lead
  });
});


// @desc    Convert lead to customer
// @route   POST /api/leads/:id/convert
// @access  Private
exports.convertLead = asyncHandler(async (req, res, next) => {
  const { packageId, siteMacAddress, clientMacAddress, wifiName, wifiPassword, model, serialNumber } = req.body;
 
  if (!packageId) {
    return next(new ErrorResponse('Package ID is required', 400));
  }
 
  if (!model || !wifiName || !wifiPassword || !serialNumber || !clientMacAddress) {
    return next(new ErrorResponse('You did not provide complete router information.', 400));
  }
 
  const lead = await Lead.findById(req.params.id).populate('siteId');
 
  if (!lead) {
    return next(new ErrorResponse('Lead not found', 404));
  }
 
  // Check if lead is paid
  if (!lead.paymentStatus.paid) {
    return next(new ErrorResponse('Lead has not been paid for', 400));
  }
 
  // Check region access
  if (req.regionFilter.regionCode && lead.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this lead', 403));
  }
 
  if (lead.status === 'won') {
    return next(new ErrorResponse('Lead already converted', 400));
  }
 
  // Verify package
  const packageDoc = await Package.findById(packageId);
  if (!packageDoc) {
    return next(new ErrorResponse('Package not found', 404));
  }
 
  if (packageDoc.packageType !== 'ppp') {
    return next(new ErrorResponse('Only PPPoE packages allowed', 400));
  }
 
  // Check if payment is sufficient
  const packagePrice = packageDoc.price;
  const amountPaid = lead.paymentStatus.amount;
 
  if (amountPaid < packagePrice) {
    return next(new ErrorResponse(
      `Insufficient payment. Package costs KES ${packagePrice}, but only KES ${amountPaid} paid. Shortfall: KES ${packagePrice - amountPaid}`,
      400
    ));
  }
 
  // Calculate balance if overpaid
  const balance = amountPaid - packagePrice;
 
  // Generate account ID
  const accountId = await generateAccountId(lead.regionCode);
 
  // Generate passwords
  const pppoePassword = generatePPPoEPassword();
 
  // Calculate subscription expiry
  const now = new Date();
  const expiresAt = new Date(now);
  if (packageDoc.periodUnit === 'm') {
    expiresAt.setMinutes(expiresAt.getMinutes() + packageDoc.period);
  } else if (packageDoc.periodUnit === 'h') {
    expiresAt.setHours(expiresAt.getHours() + packageDoc.period);
  } else {
    expiresAt.setDate(expiresAt.getDate() + packageDoc.period);
  }
 
  // Create customer with balance
  const customer = await Customer.create({
    accountId,
    regionCode: lead.regionCode,
    siteId: lead.siteId._id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    phoneNumber: lead.phoneNumber,
    alternatePhoneNumber: lead.alternatePhoneNumber,
    location: lead.location,
    pppoe: {
      username: accountId,
      password: pppoePassword,
      siteIp: lead.siteId.router.ip,
      macAddress: siteMacAddress ? siteMacAddress : null
    },
    cpe: {
      serialNumber: serialNumber,
      macAddress: clientMacAddress,
      model: model,
      wifiName: wifiName,
      wifiPassword: wifiPassword
    },
    subscription: {
      packageId,
      status: 'active',
      activatedAt: now,
      expiresAt,
      autoRenew: true
    },
    billing: {
      balance: balance > 0 ? balance : 0  // Add balance if overpaid
    },
    createdBy: req.session.userId
  });
 
  // Update lead
  lead.status = 'won';
  lead.convertedToCustomer = true;
  lead.convertedCustomerId = customer._id;
  lead.convertedAt = now;
 
  lead.interactions.push({
    interactionType: 'note',
    notes: `Lead converted to customer: ${accountId}. Payment: KES ${amountPaid}, Package: KES ${packagePrice}${balance > 0 ? `, Balance: KES ${balance}` : ''}`,
    outcome: 'successful',
    interactedBy: req.session.userId,
    interactedByName: req.user.firstName + ' ' + req.user.lastName
  });
 
  await lead.save();
  

  await Payment.updateMany(
    { leadId: lead._id },
    {
      $set: {
        customerType: 'pppoe',
        customerId: customer._id,
        accountId: customer.accountId
      },
      $unset: {
        leadId: ""
      }
    }
  );

 
  let serversResults = "";
 
  // Create account in RADIUS database
  const radiusService = require('../services/radiusService');
  const radiusResult = await radiusService.createAccount(customer, packageDoc);
  
  if (!radiusResult.success) {
    console.error('RADIUS account creation failed:', radiusResult.error);
    serversResults += `RADIUS account creation failed\n`;
  } else {
    console.log('RADIUS account creation successful');
    serversResults += `RADIUS account creation successful\n`;
  }

  const mobileSasaService = require('../services/mobileSasaService');
  const smsMessage = `Dear ${customer.firstName} ${customer.lastName}, welcome to Skylink Networks Limited! You are subscribed to ${packageDoc.packageName} and your account is active. Your wifi credentials are,  Username: ${customer.cpe.wifiName}, Password: ${customer.cpe.wifiPassword}. For support please call 0111053184. Thank you for choosing us!`
  const smsResult = await mobileSasaService.sendSingle(customer.phoneNumber, smsMessage);

  if(smsResult.success){
    await logSms(
      { phoneNumber: customer.phoneNumber, customerId: customer?._id, accountId: customer?.accountId },
      smsMessage,
      "welcome",
      req.regionFilter?.regionCode || null,
      smsResult.response,
      'sent',
      smsResult.cost
    );

  }else{
    await logSms(
      { phoneNumber: customer.phoneNumber, customerId: customer?._id, accountId: customer?.accountId },
      smsMessage,
      "welcome",
      req.regionFilter?.regionCode || null,
      null,
      'failed',
      null,
      { code: 'api_error', message: smsResult.response.error.message }
    );
  }
 
  if (balance > 0) {
    serversResults += `Customer created with balance: KES ${balance}\n`;
  }
 
  // Log conversion
  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'info',
    regionCode: lead.regionCode,
    entityType: 'lead',
    entityId: lead._id,
    message: `Lead ${lead.leadNumber} converted to customer ${accountId}. Payment: KES ${amountPaid}, Balance: KES ${balance}`,
    triggeredBy: req.session.userId,
    success: true
  });
 
  res.status(201).json({
    success: true,
    message: `Lead converted to customer successfully\n${serversResults}`,
    data: {
      lead,
      customer,
      payment: {
        amountPaid,
        packageCost: packagePrice,
        balance: balance > 0 ? balance : 0
      }
    }
  });
});
 
 

// @desc    Mark lead as lost
// @route   PUT /api/leads/:id/lost
// @access  Private
exports.markAsLost = asyncHandler(async (req, res, next) => {
  const { lostReason, lostReasonDetails, competitorInfo } = req.body;

  if (!lostReason) {
    return next(new ErrorResponse('Lost reason is required', 400));
  }

  const lead = await Lead.findById(req.params.id);

  if (!lead) {
    return next(new ErrorResponse('Lead not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && lead.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this lead', 403));
  }

  lead.status = 'lost';
  lead.lostReason = lostReason;
  lead.lostReasonDetails = lostReasonDetails;
  lead.lostAt = Date.now();

  if (competitorInfo) {
    lead.competitorInfo = competitorInfo;
  }

  lead.interactions.push({
    interactionType: 'note',
    notes: `Lead marked as lost. Reason: ${lostReason}`,
    outcome: 'not_interested',
    interactedBy: req.session.userId,
    interactedByName: req.user.firstName + ' ' + req.user.lastName
  });

  await lead.save();

  res.status(200).json({
    success: true,
    message: 'Lead marked as lost',
    data: lead
  });
});

// @desc    Get lead statistics
// @route   GET /api/leads/stats
// @access  Private
exports.getLeadStatistics = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo } = req.query;

  const regionCode = req.regionFilter.regionCode;

  const stats = await getLeadStats(regionCode, dateFrom, dateTo);
  const funnel = await getConversionFunnel(regionCode, dateFrom, dateTo);
  const topSources = await getTopLeadSources(regionCode, dateFrom, dateTo);

  res.status(200).json({
    success: true,
    message: 'Lead statistics retrieved successfully',
    data: {
      stats,
      funnel,
      topSources
    }
  });
});

// @desc    Get leads needing follow-up
// @route   GET /api/leads/follow-ups
// @access  Private
exports.getFollowUps = asyncHandler(async (req, res, next) => {
  const regionCode = req.regionFilter.regionCode;
  const userId = req.query.userId || null;

  const leads = await getLeadsNeedingFollowUp(regionCode, userId);

  res.status(200).json({
    success: true,
    message: 'Follow-up leads retrieved successfully',
    data: {
      leads,
      count: leads.length
    }
  });
});

// @desc    Delete lead
// @route   DELETE /api/leads/:id
// @access  Private
exports.deleteLead = asyncHandler(async (req, res, next) => {
  const lead = await Lead.findById(req.params.id);

  if (!lead) {
    return next(new ErrorResponse('Lead not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && lead.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this lead', 403));
  }

  await lead.deleteOne();

  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'warning',
    regionCode: lead.regionCode,
    message: `Lead deleted: ${lead.leadNumber}`,
    triggeredBy: req.session.userId,
    success: true
  });

  res.status(200).json({
    success: true,
    message: 'Lead deleted successfully',
    data: null
  });
});




