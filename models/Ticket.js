const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TicketSchema = new Schema({
  // Ticket Identification
  ticketNumber: {
    type: String,
    required: true,
    unique: true
    // Format: TKT-SKY-2024-0001
  },
  
  regionCode: {
    type: String,
    required: true,
    uppercase: true,
    index: true
  },
  
  siteId: {
    type: Schema.Types.ObjectId,
    ref: 'Site',
    required: true
  },
  
  // Customer Reference
  customerType: {
    type: String,
    required: true,
    enum: ['pppoe', 'hotspot', 'lead']
  },
  
  customerId: {
    type: Schema.Types.ObjectId,
    required: true
    // Reference to Customer, HotspotUser, or Lead
  },
  
  leadId: {
    type: Schema.Types.ObjectId,
    ref: 'Lead'
    // For lead tickets
  },
  
  accountId: {
    type: String
    // For quick lookup
  },
  
  customerName: {
    type: String,
    required: true
  },
  
  customerPhone: {
    type: String,
    required: true
  },
  
  customerEmail: {
    type: String
  },
  
  // Ticket Details
  subject: {
    type: String,
    required: true,
    trim: true
  },
  
  description: {
    type: String,
    required: true
  },
  
  category: {
    type: String,
    required: true,
    enum: [
      'technical',
      'billing',
      'installation',
      'maintenance',
      'account',
      'complaint',
      'inquiry',
      'survey',
      'other'
    ]
  },
  
  subCategories: {
    type: [String],
    required: true,
    validate: {
      validator: function(arr) {
        return arr && arr.length > 0;
      },
      message: 'At least one subcategory is required'
    },
    enum: [
      'los',
      'slow-speeds',
      'connected-no-internet',
      'relocation',
      'migration-wireless-to-fiber',
      'migration-epon-to-gpon',
      'wireless-installation',
      'fiber-installation',
      'upgrade',
      'downgrade',
      'termination',
      'extension',
      'implementation',
      'survey-needed-resources',
      'check-coverage',
      'emergency',
      'scheduled'
    ]
  },
  
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  
  status: {
    type: String,
    enum: ['open', 'in_progress', 'pending_customer', 'resolved', 'closed', 'cancelled'],
    default: 'open'
  },
  
  // Assignment
  assignedTo: {
    type: Schema.Types.ObjectId,
    ref: 'User'
    // Staff member handling the ticket
  },
  
  assignedAt: {
    type: Date
  },
  
  // Issue Location (if technical)
  location: {
    address: String,
    area: String,
    landmark: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  
  // Resolution
  resolution: {
    type: String
  },
  
  resolvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  
  resolvedAt: {
    type: Date
  },
  
  closedAt: {
    type: Date
  },
  
  // Communication History
  updates: [{
    updateType: {
      type: String,
      enum: ['comment', 'status_change', 'assignment', 'resolution'],
      required: true
    },
    message: {
      type: String,
      required: true
    },
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    addedByName: {
      type: String
      // Store name for reference even if user is deleted
    },
    isInternal: {
      type: Boolean,
      default: false
      // Internal notes not visible to customer
    },
    attachments: [{
      filename: String,
      url: String,
      fileType: String
    }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Attachments
  attachments: [{
    filename: String,
    url: String,
    fileType: String,
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // SLA Tracking
  sla: {
    responseTime: {
      type: Number
      // In minutes
    },
    responseDeadline: {
      type: Date
    },
    resolutionTime: {
      type: Number
      // In minutes
    },
    resolutionDeadline: {
      type: Date
    },
    isBreached: {
      type: Boolean,
      default: false
    }
  },
  
  // Tags for easy filtering
  tags: [{
    type: String,
    lowercase: true
  }],
  
  // Feedback
  customerFeedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    submittedAt: Date
  },
  
  // Created By (who created the ticket - could be customer or staff)
  createdBy: {
    userType: {
      type: String,
      enum: ['customer', 'staff', 'system'],
      default: 'customer'
    },
    userId: {
      type: Schema.Types.ObjectId
    }
  }
}, {
  timestamps: true
});

// Indexes
TicketSchema.index({ ticketNumber: 1 });
TicketSchema.index({ customerId: 1, status: 1 });
TicketSchema.index({ regionCode: 1, status: 1 });
TicketSchema.index({ assignedTo: 1, status: 1 });
TicketSchema.index({ status: 1, priority: 1 });
TicketSchema.index({ category: 1, status: 1 });
TicketSchema.index({ createdAt: -1 });
TicketSchema.index({ 'sla.resolutionDeadline': 1, status: 1 });

// Virtual for time to resolve
TicketSchema.virtual('timeToResolve').get(function() {
  if (this.resolvedAt && this.createdAt) {
    return Math.floor((this.resolvedAt - this.createdAt) / 1000 / 60); // in minutes
  }
  return null;
});

module.exports = mongoose.model('Ticket', TicketSchema);