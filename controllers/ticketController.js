const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Ticket = require('../models/Ticket');
const Customer = require('../models/Customer');
const HotspotUser = require('../models/HotspotUser');
const Lead = require('../models/Lead');
const User = require('../models/User');
const SystemLog = require('../models/SystemLog');
const {
  generateTicketNumber,
  calculateSLADeadlines,
  checkSLABreach,
  getTicketStats,
  getAverageResolutionTime
} = require('../utils/ticketHelpers');
const { formatPhoneNumber } = require('../utils/phoneHelpers');

// @desc    Get all tickets
// @route   GET /api/tickets
// @access  Private
exports.getTickets = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
    category,
    priority,
    assignedTo,
    myTickets,
    slaBreached,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  // Build query with region filter
  const query = { ...req.regionFilter };

  // Add search
  if (search) {
    query.$or = [
      { ticketNumber: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } },
      { customerPhone: { $regex: search, $options: 'i' } },
      { accountId: { $regex: search, $options: 'i' } },
      { subject: { $regex: search, $options: 'i' } }
    ];
  }

  // Add filters
  if (status) {
    query.status = status;
  }

  if (category) {
    query.category = category;
  }

  if (priority) {
    query.priority = priority;
  }

  if (assignedTo) {
    query.assignedTo = assignedTo;
  }

  // Show only tickets assigned to current user
  if (myTickets === 'true') {
    query.assignedTo = req.session.userId;
  }

  // Show only SLA breached tickets
  if (slaBreached === 'true') {
    query['sla.isBreached'] = true;
  }

  // Build sort
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Execute query
  const tickets = await Ticket.find(query)
    .populate('assignedTo', 'firstName lastName')
    .populate('resolvedBy', 'firstName lastName')
    .select('-updates.isInternal') // Hide internal flag in list view
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Ticket.countDocuments(query);

  res.status(200).json({
    success: true,
    message: 'Tickets retrieved successfully',
    data: {
      tickets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// @desc    Get single ticket
// @route   GET /api/tickets/:id
// @access  Private
exports.getTicket = asyncHandler(async (req, res, next) => {
  const ticket = await Ticket.findById(req.params.id)
    .populate('assignedTo', 'firstName lastName email phoneNumber')
    .populate('resolvedBy', 'firstName lastName')
    .populate('updates.addedBy', 'firstName lastName')
    .populate('siteId', 'siteName regionCode');

  if (!ticket) {
    return next(new ErrorResponse('Ticket not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && ticket.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ticket', 403));
  }

  // Check SLA breach
  const breachInfo = checkSLABreach(ticket);
  if (breachInfo.breached && !ticket.sla.isBreached) {
    ticket.sla.isBreached = true;
    await ticket.save();
  }

  res.status(200).json({
    success: true,
    message: 'Ticket retrieved successfully',
    data: ticket
  });
});

// @desc    Create ticket
// @route   POST /api/tickets
// @access  Private
exports.createTicket = asyncHandler(async (req, res, next) => {
  const {
    customerType,
    leadId,
    customerId,
    category,
    subCategories,
    subject,
    description,
    priority,
    assignedTo,
    location
  } = req.body;

  // Validate required fields
  if (!customerType || !category || !subCategories || !subject || !description) {
    return next(new ErrorResponse('Please provide all required fields (customerType, category, subCategories, subject, description)', 400));
  }

  // Validate subcategories is array with at least one item
  if (!Array.isArray(subCategories) || subCategories.length === 0) {
    return next(new ErrorResponse('At least one subcategory is required', 400));
  }

  let customerData;
  let siteId;
  let regionCode;
  let accountId;

  // Fetch customer/lead data based on type
  if (customerType === 'lead') {
    if (!leadId) {
      return next(new ErrorResponse('leadId is required when customerType is "lead"', 400));
    }

    const lead = await Lead.findById(leadId).populate('siteId');
    
    if (!lead) {
      return next(new ErrorResponse('Lead not found', 404));
    }

    if(lead.status === 'won' && lead.convertedToCustomer){
      return next(new ErrorResponse('The lead is already a cutomer now, create a ticket about the customer instead.', 400));
    }

    // Check region access
    if (req.regionFilter.regionCode && lead.regionCode !== req.regionFilter.regionCode) {
      return next(new ErrorResponse('Access denied to this lead', 403));
    }

    customerData = {
      customerId: lead._id,
      leadId: lead._id,
      customerName: `${lead.firstName} ${lead.lastName}`,
      customerPhone: lead.phoneNumber,
      customerEmail: lead.email,
      location: lead.location
    };
    
    siteId = lead.siteId._id;
    regionCode = lead.regionCode;
    accountId = lead.leadNumber;

  } else if (customerType === 'pppoe') {
    if (!customerId) {
      return next(new ErrorResponse('customerId is required when customerType is "pppoe"', 400));
    }

    const customer = await Customer.findById(customerId).populate('siteId');
    
    if (!customer) {
      return next(new ErrorResponse('Customer not found', 404));
    }

    // Check region access
    if (req.regionFilter.regionCode && customer.regionCode !== req.regionFilter.regionCode) {
      return next(new ErrorResponse('Access denied to this customer', 403));
    }

    customerData = {
      customerId: customer._id,
      customerName: `${customer.firstName} ${customer.lastName}`,
      customerPhone: customer.phoneNumber,
      customerEmail: customer.email,
      location: customer.location
    };
    
    siteId = customer.siteId._id;
    regionCode = customer.regionCode;
    accountId = customer.accountId;

  } else if (customerType === 'hotspot') {
    if (!customerId) {
      return next(new ErrorResponse('customerId is required when customerType is "hotspot"', 400));
    }

    const hotspotUser = await HotspotUser.findById(customerId).populate('siteId');
    
    if (!hotspotUser) {
      return next(new ErrorResponse('Hotspot user not found', 404));
    }

    // Check region access
    if (req.regionFilter.regionCode && hotspotUser.regionCode !== req.regionFilter.regionCode) {
      return next(new ErrorResponse('Access denied to this hotspot user', 403));
    }

    customerData = {
      customerId: hotspotUser._id,
      customerName: `${hotspotUser.firstName} ${hotspotUser.lastName}`,
      customerPhone: hotspotUser.phoneNumber,
      customerEmail: hotspotUser.email,
      location: hotspotUser.location
    };
    
    siteId = hotspotUser.siteId._id;
    regionCode = hotspotUser.regionCode;
    accountId = hotspotUser.accountId;
  } else {
    return next(new ErrorResponse('Invalid customerType. Must be "lead", "pppoe", or "hotspot"', 400));
  }

  // Validate assignedTo if provided
  if (assignedTo) {
    const assignee = await User.findById(assignedTo);
    
    if (!assignee) {
      return next(new ErrorResponse('Assigned user not found', 404));
    }

    // Check if assignee has access to this region
    if (assignee.role !== 'super_admin' && 
        assignee.allowedRegions.length > 0 && 
        !assignee.allowedRegions.includes(regionCode)) {
      return next(new ErrorResponse('Assigned user does not have access to this region', 403));
    }
  }

  // Generate ticket number
  const ticketNumber = await generateTicketNumber(regionCode);

  // Calculate SLA deadlines based on priority
  const slaDeadlines = calculateSLADeadlines(priority || 'medium');

  // Create ticket
  const ticket = await Ticket.create({
    ticketNumber,
    regionCode,
    siteId,
    customerType,
    ...customerData,
    accountId,
    subject,
    description,
    category,
    subCategories,
    priority: priority || 'medium',
    assignedTo: assignedTo || null,
    assignedAt: assignedTo ? Date.now() : null,
    location: location || customerData.location,
    sla: {
      ...slaDeadlines,
      isBreached: false
    },
    createdBy: {
      userType: 'staff',
      userId: req.session.userId
    }
  });

  // Add initial update if assigned
  if (assignedTo) {
    const assignee = await User.findById(assignedTo);
    
    ticket.updates.push({
      updateType: 'assignment',
      message: `Ticket assigned to ${assignee.firstName} ${assignee.lastName}`,
      addedBy: req.session.userId,
      addedByName: `${req.user.firstName} ${req.user.lastName}`
    });
    
    await ticket.save();
  }

  // Log ticket creation
  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'info',
    regionCode,
    entityType: 'ticket',
    entityId: ticket._id,
    message: `Ticket ${ticketNumber} created for ${customerData.customerName}`,
    details: {
      category,
      subCategories,
      priority: ticket.priority,
      customerType
    },
    triggeredBy: req.session.userId,
    success: true
  });

  // TODO: Send notification to assigned user (not implemented yet)
  // TODO: Send SMS to customer (not implemented yet)

  // Populate before returning
  await ticket.populate('assignedTo siteId');


  await ticket.populate('assignedTo siteId');

  res.status(201).json({
    success: true,
    message: 'Ticket created successfully',
    data: ticket
  });
});

// @desc    Update ticket
// @route   PUT /api/tickets/:id
// @access  Private
exports.updateTicket = asyncHandler(async (req, res, next) => {
  let ticket = await Ticket.findById(req.params.id);

  if (!ticket) {
    return next(new ErrorResponse('Ticket not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && ticket.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ticket', 403));
  }

  const { subject, category, priority, location, customerEmail } = req.body;

  // Update allowed fields
  if (subject) ticket.subject = subject;
  if (category) ticket.category = category;
  if (customerEmail) ticket.customerEmail = customerEmail;
  if (location) ticket.location = { ...ticket.location, ...location };

  // If priority changed, recalculate SLA
  if (priority && priority !== ticket.priority) {
    ticket.priority = priority;
    const newSLA = calculateSLADeadlines(priority);
    ticket.sla = { ...ticket.sla, ...newSLA };

    ticket.updates.push({
      updateType: 'status_change',
      message: `Priority changed to ${priority}`,
      addedBy: req.session.userId,
      addedByName: req.user.firstName + ' ' + req.user.lastName,
      isInternal: true
    });
  }

  await ticket.save();

  res.status(200).json({
    success: true,
    message: 'Ticket updated successfully',
    data: ticket
  });
});

// @desc    Assign ticket
// @route   PUT /api/tickets/:id/assign
// @access  Private
exports.assignTicket = asyncHandler(async (req, res, next) => {
  const { userId } = req.body;

  if (!userId) {
    return next(new ErrorResponse('User ID is required', 400));
  }

  const ticket = await Ticket.findById(req.params.id);

  if (!ticket) {
    return next(new ErrorResponse('Ticket not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && ticket.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ticket', 403));
  }

  // Verify user exists
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  const previousAssignee = ticket.assignedTo;
  ticket.assignedTo = userId;
  ticket.assignedAt = Date.now();

  ticket.updates.push({
    updateType: 'assignment',
    message: `Ticket assigned to ${user.firstName} ${user.lastName}`,
    addedBy: req.session.userId,
    addedByName: req.user.firstName + ' ' + req.user.lastName,
    isInternal: true
  });

  // Update status if it's open
  if (ticket.status === 'open') {
    ticket.status = 'in_progress';
  }

  await ticket.save();

  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'info',
    regionCode: ticket.regionCode,
    entityType: 'ticket',
    entityId: ticket._id,
    message: `Ticket ${ticket.ticketNumber} assigned to ${user.firstName} ${user.lastName}`,
    triggeredBy: req.session.userId,
    success: true
  });

  await ticket.populate('assignedTo');

  res.status(200).json({
    success: true,
    message: 'Ticket assigned successfully',
    data: ticket
  });
});

// @desc    Transfer ticket to another user
// @route   PUT /api/tickets/:id/transfer
// @access  Private
exports.transferTicket = asyncHandler(async (req, res, next) => {
  const { userId, reason } = req.body;

  if (!userId) {
    return next(new ErrorResponse('User ID is required', 400));
  }

  if (!reason) {
    return next(new ErrorResponse('Reason for transfer is required', 400));
  }


  const ticket = await Ticket.findById(req.params.id).populate('assignedTo');

  if (!ticket) {
    return next(new ErrorResponse('Ticket not found', 404));
  }

  if (!ticket.assignedTo) {
    return next(new ErrorResponse('Ticket is not assigned to anyone. Use assign endpoint instead', 400));
  }

  // Check if current user is the one assigned to the ticket
  if (ticket.assignedTo._id.toString() !== req.session.userId.toString()) {
    return next(new ErrorResponse(`Only the assigned user can transfer this ticket : ${ticket.assignedTo._id.toString()}  : ${req.session.userId}`, 403));
  }



  if (ticket.status === 'closed' || ticket.status === 'resolved') {
    return next(new ErrorResponse('Ticket cannot be trasfered after resolution or closure.', 400));
  }




  // Check region access
  if (req.regionFilter.regionCode && ticket.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ticket due to region prohibition.', 403));
  }


  // Check if transferring to the same user
  if (ticket.assignedTo._id.toString() === userId) {
    return next(new ErrorResponse('Ticket is already assigned to this user', 400));
  }

  // Verify new assignee exists
  const newAssignee = await User.findById(userId);
  if (!newAssignee) {
    return next(new ErrorResponse('User not found', 404));
  }

  // Check if new assignee has access to this region
  if (newAssignee.role !== 'super_admin' && 
      newAssignee.allowedRegions.length > 0 && 
      !newAssignee.allowedRegions.includes(ticket.regionCode) && !newAssignee.allowedRegions.includes("*")) {
    return next(new ErrorResponse('New assignee does not have access to this region', 403));
  }

  const previousAssignee = ticket.assignedTo;
  ticket.assignedTo = userId;
  ticket.assignedAt = Date.now();

  // Add transfer update
  const transferMessage = reason 
    ? `Ticket transferred from ${previousAssignee.firstName} ${previousAssignee.lastName} to ${newAssignee.firstName} ${newAssignee.lastName}. Reason: ${reason}`
    : `Ticket transferred from ${previousAssignee.firstName} ${previousAssignee.lastName} to ${newAssignee.firstName} ${newAssignee.lastName}`;

  ticket.updates.push({
    updateType: 'assignment',
    message: transferMessage,
    addedBy: req.session.userId,
    addedByName: `${req.user.firstName} ${req.user.lastName}`,
    isInternal: false // Make visible to all
  });

  await ticket.save();

  // Log transfer
  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'info',
    regionCode: ticket.regionCode,
    entityType: 'ticket',
    entityId: ticket._id,
    message: `Ticket ${ticket.ticketNumber} transferred from ${previousAssignee.firstName} ${previousAssignee.lastName} to ${newAssignee.firstName} ${newAssignee.lastName}`,
    details: { reason },
    triggeredBy: req.session.userId,
    success: true
  });

  // TODO: Send notification to new assignee (not implemented yet)
  // TODO: Send notification to previous assignee (not implemented yet)

  await ticket.populate('assignedTo');

  res.status(200).json({
    success: true,
    message: 'Ticket transferred successfully',
    data: ticket
  });
});

// @desc    Add update to ticket
// @route   POST /api/tickets/:id/updates
// @access  Private
exports.addUpdate = asyncHandler(async (req, res, next) => {
  const { updateType, message, isInternal, attachments } = req.body;

  if (!updateType || !message) {
    return next(new ErrorResponse('Update type and message are required', 400));
  }

  const ticket = await Ticket.findById(req.params.id);

  if (!ticket) {
    return next(new ErrorResponse('Ticket not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && ticket.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ticket', 403));
  }

  ticket.updates.push({
    updateType: updateType || 'comment',
    message,
    addedBy: req.session.userId,
    addedByName: req.user.firstName + ' ' + req.user.lastName,
    isInternal: isInternal || false,
    attachments: attachments || []
  });

  await ticket.save();

  res.status(200).json({
    success: true,
    message: 'Update added successfully',
    data: ticket
  });
});

// @desc    Change ticket status
// @route   PUT /api/tickets/:id/status
// @access  Private
exports.changeStatus = asyncHandler(async (req, res, next) => {
  const { status, message } = req.body;

  if (!status) {
    return next(new ErrorResponse('Status is required', 400));
  }

  const ticket = await Ticket.findById(req.params.id);

  if (!ticket) {
    return next(new ErrorResponse('Ticket not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && ticket.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ticket', 403));
  }

  const previousStatus = ticket.status;
  ticket.status = status;

  ticket.updates.push({
    updateType: 'status_change',
    message: message || `Status changed from ${previousStatus} to ${status}`,
    addedBy: req.session.userId,
    addedByName: req.user.firstName + ' ' + req.user.lastName,
    isInternal: false
  });

  await ticket.save();

  res.status(200).json({
    success: true,
    message: 'Ticket status updated successfully',
    data: ticket
  });
});

// @desc    Resolve ticket
// @route   PUT /api/tickets/:id/resolve
// @access  Private
exports.resolveTicket = asyncHandler(async (req, res, next) => {
  const { resolution } = req.body;

  if (!resolution) {
    return next(new ErrorResponse('Resolution is required', 400));
  }

  const ticket = await Ticket.findById(req.params.id);

  if (!ticket) {
    return next(new ErrorResponse('Ticket not found', 404));
  }

  if(!ticket.assignedTo){
    return next(new ErrorResponse('This ticket is not assigned to anyone so cannot be resolved.', 400));
  }

  if (ticket.assignedTo.toString() !== req.user._id.toString()) {
    return next(new ErrorResponse('You are not authorized to resolve this ticket. Only the assigned technician can resolve it.', 403));
  }

  // Check region access
  if (req.regionFilter.regionCode && ticket.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ticket', 403));
  }

  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    return next(new ErrorResponse('Ticket is already resolved/closed', 400));
  }

  ticket.status = 'closed';
  ticket.resolution = resolution;
  ticket.resolvedBy = req.session.userId;
  ticket.resolvedAt = Date.now();

  ticket.updates.push({
    updateType: 'resolution',
    message: resolution,
    addedBy: req.session.userId,
    addedByName: req.user.firstName + ' ' + req.user.lastName,
    isInternal: false
  });

  await ticket.save();

  // Update user metrics
  await User.findByIdAndUpdate(req.session.userId, {
    $inc: { 'metrics.ticketsResolved': 1 }
  });

  // TODO: Send SMS to customer
  // await smsService.send(ticket.customerPhone, `Your ticket has been resolved...`);

  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'info',
    regionCode: ticket.regionCode,
    entityType: 'ticket',
    entityId: ticket._id,
    message: `Ticket resolved: ${ticket.ticketNumber}`,
    triggeredBy: req.session.userId,
    success: true
  });

  await ticket.populate('resolvedBy');

  res.status(200).json({
    success: true,
    message: 'Ticket resolved successfully',
    data: ticket
  });
});

// @desc    Close ticket
// @route   PUT /api/tickets/:id/close
// @access  Private
exports.closeTicket = asyncHandler(async (req, res, next) => {
  const ticket = await Ticket.findById(req.params.id);

  if (!ticket) {
    return next(new ErrorResponse('Ticket not found', 404));
  }

  if(!ticket.assignedTo){
    return next(new ErrorResponse('Ticket is not assigned to anyone so cannot be closed', 400));
  }

  if (ticket.assignedTo.toString() !== req.user._id.toString()) {
    return next(new ErrorResponse('You are not authorized to resolve this ticket. Only the assigned user can close it.', 403));
  }

  // Check region access
  if (req.regionFilter.regionCode && ticket.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ticket', 403));
  }

  if (ticket.status === 'closed') {
    return next(new ErrorResponse('Ticket is already closed', 400));
  }

  ticket.status = 'closed';
  ticket.closedAt = Date.now();

  ticket.updates.push({
    updateType: 'status_change',
    message: 'Ticket closed',
    addedBy: req.session.userId,
    addedByName: req.user.firstName + ' ' + req.user.lastName,
    isInternal: true
  });

  await ticket.save();

  res.status(200).json({
    success: true,
    message: 'Ticket closed successfully',
    data: ticket
  });
});

// @desc    Add customer feedback
// @route   POST /api/tickets/:id/feedback
// @access  Public
exports.addFeedback = asyncHandler(async (req, res, next) => {
  const { rating, comment } = req.body;

  if (!rating) {
    return next(new ErrorResponse('Rating is required', 400));
  }

  if (rating < 1 || rating > 5) {
    return next(new ErrorResponse('Rating must be between 1 and 5', 400));
  }

  const ticket = await Ticket.findById(req.params.id);

  if (!ticket) {
    return next(new ErrorResponse('Ticket not found', 404));
  }

  if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
    return next(new ErrorResponse('Can only provide feedback for resolved/closed tickets', 400));
  }

  ticket.customerFeedback = {
    rating,
    comment,
    submittedAt: Date.now()
  };

  await ticket.save();

  // Update assigned user's average rating
  if (ticket.assignedTo) {
    const userTickets = await Ticket.find({
      assignedTo: ticket.assignedTo,
      'customerFeedback.rating': { $exists: true }
    });

    const avgRating = userTickets.reduce((sum, t) => sum + t.customerFeedback.rating, 0) / userTickets.length;

    await User.findByIdAndUpdate(ticket.assignedTo, {
      'metrics.customerSatisfactionScore': avgRating
    });
  }

  res.status(200).json({
    success: true,
    message: 'Feedback submitted successfully',
    data: ticket
  });
});

// @desc    Get ticket statistics
// @route   GET /api/tickets/stats
// @access  Private
exports.getTicketStatistics = asyncHandler(async (req, res, next) => {
  const { dateFrom, dateTo } = req.query;

  const regionCode = req.regionFilter.regionCode;

  const stats = await getTicketStats(regionCode, dateFrom, dateTo);
  const avgResolutionTime = await getAverageResolutionTime(regionCode, dateFrom, dateTo);

  res.status(200).json({
    success: true,
    message: 'Ticket statistics retrieved successfully',
    data: {
      stats,
      avgResolutionTime: Math.round(avgResolutionTime)
    }
  });
});

// @desc    Delete ticket
// @route   DELETE /api/tickets/:id
// @access  Private (Admin only)
exports.deleteTicket = asyncHandler(async (req, res, next) => {
  const ticket = await Ticket.findById(req.params.id);

  if (!ticket) {
    return next(new ErrorResponse('Ticket not found', 404));
  }

  // Check region access
  if (req.regionFilter.regionCode && ticket.regionCode !== req.regionFilter.regionCode) {
    return next(new ErrorResponse('Access denied to this ticket', 403));
  }

  await ticket.deleteOne();

  await SystemLog.create({
    eventType: 'admin_action',
    severity: 'warning',
    regionCode: ticket.regionCode,
    message: `Ticket deleted: ${ticket.ticketNumber}`,
    triggeredBy: req.session.userId,
    success: true
  });

  res.status(200).json({
    success: true,
    message: 'Ticket deleted successfully',
    data: null
  });
});