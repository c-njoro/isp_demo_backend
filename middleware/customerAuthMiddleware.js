const jwt = require('jsonwebtoken');
const asyncHandler = require('./asyncHandler');
const { ErrorResponse } = require('./errorHandler');
const Customer = require('../models/Customer');

/**
 * Protect customer portal routes
 * Verifies JWT token and attaches customer ID to request
 */
exports.protectCustomer = asyncHandler(async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // Make sure token exists
  if (!token) {
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

    // Check if it's a customer token
    if (decoded.type !== 'customer') {
      return next(new ErrorResponse('Invalid token type', 401));
    }

    

    // Get customer from token
    const customer = await Customer.findById(decoded.id).select('-otp.code -otp.expiresAt -otp.attempts');

    if (!customer) {
      return next(new ErrorResponse('Customer not found', 404));
    }

    // Check if customer is active
    if (!customer.isActive) {
      return next(new ErrorResponse('Account is inactive', 403));
    }

    // Attach customer ID to request
    req.customerId = customer._id;
    req.customerAccountId = customer.accountId;

    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }
});