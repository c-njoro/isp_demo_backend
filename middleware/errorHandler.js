const SystemLog = require('../models/SystemLog');

// Custom error class
class ErrorResponse extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error(err);

  let error = err;

  // Handle invalid ObjectId
  if (err.name === 'CastError' && err.path === '_id') {
    let modelName = 'Resource';
    
    // Mongoose 6+ has err.model
    if (err.model) {
        modelName = err.model.modelName || modelName;
    } else {
        // Mongoose 5: extract model name from error message
        const match = err.message.match(/for model "(\w+)"/);
        if (match) {
            modelName = match[1];
        }
    }
    
    error = new ErrorResponse(`${modelName} not found`, 404);
}

  // Duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    error = new ErrorResponse(`Duplicate value entered for ${field}`, 400);
  }

  // Validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors)
      .map(val => val.message)
      .join(', ');
    error = new ErrorResponse(message, 400);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = { ErrorResponse, errorHandler };