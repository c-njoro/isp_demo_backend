const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const unprocessedPaymentSchema = new mongoose.Schema({
  receiptNumber: { 
    type: String, 
    required: true, 
    unique: true 
  },
  tillNumber: String,
  phoneNumber: String,
  amount: Number,
  transactionDate: Date,
  rawData: mongoose.Schema.Types.Mixed,
  status: { 
    type: String, 
    enum: ['new', 'matched', 'ignored'], 
    default: 'new' 
  },
  matchedWith: {
    id: {
      type: Schema.Types.ObjectId,
      refPath: 'matchedWith.type'
    },
    type: {
      type: String,
      enum: ['Lead', 'Customer']
    }
  },
  
}, { timestamps: true });

module.exports = mongoose.model('UnprocessedPayment', unprocessedPaymentSchema);