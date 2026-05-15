const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const LeadSchema = new Schema({
  // Lead Identification
  leadNumber: {
    type: String,
    required: true,
    unique: true
    // Format: LEAD-SKY-2024-0001
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
  
  // Personal Information
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  
  phoneNumber: {
    type: String,
    required: true
    // Format: 254XXXXXXXXX
  },
  
  alternatePhoneNumber: {
    type: String
  },
  
  // Location Details
  location: {
    address: String,
    houseNumber: String,
    apartment: String,
    street: String,
    area: String,
    landmark: String,
    county: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  
  // Lead Source
  source: {
    type: String,
    enum: [
      'walk_in',           // Customer walked into office
      'phone_call',        // Inbound call
      'website',           // Website inquiry form
      'referral',          // Referred by existing customer
      'social_media',      // Facebook, Instagram, etc
      'advertisement',     // Paid ads
      'field_marketing',   // Door-to-door, events
      'partner', 
      'agent',          // Business partner referral
      'other'
    ],
    required: true
  },
  
  sourceDetails: {
    type: String
    // Additional info about source (e.g., "Facebook Ad - Summer Campaign")
  },
  
  // Referral Details (if source is referral)
  referredBy: {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer'
    },
    accountId: String,
    name: String,
    phoneNumber: String
  },
  
  // Interest Details
  interestedPackage: {
    type: Schema.Types.ObjectId,
    ref: 'Package'
  },
  
  interestedPackageName: {
    type: String
  },
  
  estimatedBudget: {
    type: Number
    // What they're willing to pay
  },

  paymentStatus: {
    paid: {
      type: Boolean,
      required: true,
      default: false
    },
    mpesaCode: {
      type: String,
      required: function () {
        return this.paymentStatus.paid === true;
      }
    },
    amount: {
      type: Number,
      required: function () {
        return this.paymentStatus.paid === true;
      }
    }
  },
  // Lead Status
  status: {
    type: String,
    enum: [
      'new',               // Just created
      'contacted',         // Initial contact made
      'qualified',         // Verified as legitimate lead
      'proposal_sent',     // Quotation/proposal sent
      'negotiation',       // Discussing terms
      'site_visit',        // Site survey scheduled/done
      'won',              // Converted to customer
      'lost',             // Lost the lead
      'on_hold',          // Lead is on hold
      'unresponsive'      // Not responding to contact attempts
    ],
    default: 'new'
  },
  
  // Lead Score (0-100, how likely to convert)
  leadScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 50
  },
  
  // Priority
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  
  // Assignment
  assignedTo: {
    type: Schema.Types.ObjectId,
    ref: 'User'
    // Sales representative
  },
  
  assignedAt: {
    type: Date
  },
  
  // Follow-up
  nextFollowUpDate: {
    type: Date
  },
  
  followUpCount: {
    type: Number,
    default: 0
  },
  
  lastContactedAt: {
    type: Date
  },
  
  // Communication History
  interactions: [{
    interactionType: {
      type: String,
      enum: ['call', 'email', 'sms', 'meeting', 'site_visit', 'note'],
      required: true
    },
    subject: String,
    notes: {
      type: String,
      required: true
    },
    outcome: {
      type: String,
      enum: ['successful', 'no_answer', 'callback_requested', 'not_interested', 'interested', 'needs_time']
    },
    nextAction: String,
    interactedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    interactedByName: String,
    interactionDate: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Site Survey (if done)
  siteSurvey: {
    surveyDone: {
      type: Boolean,
      default: false
    },
    surveyDate: Date,
    surveyedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    findings: String,
    installationFeasible: {
      type: Boolean
    },
    estimatedInstallationCost: Number,
    requiredEquipment: [{
      item: String,
      quantity: Number,
      estimatedCost: Number
    }],
    signalStrength: String,
    distance: Number, // Distance from nearest POP in meters
    photos: [{
      url: String,
      description: String
    }]
  },
  
  // Conversion
  convertedToCustomer: {
    type: Boolean,
    default: false
  },
  
  convertedCustomerId: {
    type: Schema.Types.ObjectId,
    ref: 'Customer'
  },
  
  convertedAt: {
    type: Date
  },
  
  // Lost Reason
  lostReason: {
    type: String,
    enum: [
      'price_too_high',
      'competitor_chosen',
      'no_coverage',
      'installation_cost',
      'not_interested',
      'moved_away',
      'no_response',
      'timing_not_right',
      'other'
    ]
  },
  
  lostReasonDetails: {
    type: String
  },
  
  lostAt: {
    type: Date
  },
  
  // Competitor Info (if lost to competitor)
  competitorInfo: {
    competitorName: String,
    competitorPackage: String,
    competitorPrice: Number
  },
  
  // Tags
  tags: [{
    type: String,
    lowercase: true
  }],
  
  // Notes
  notes: {
    type: String
  },
  
  // Created By
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  createdByName: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes
LeadSchema.index({ leadNumber: 1 });
LeadSchema.index({ phoneNumber: 1 });
LeadSchema.index({ email: 1 });
LeadSchema.index({ regionCode: 1, status: 1 });
LeadSchema.index({ assignedTo: 1, status: 1 });
LeadSchema.index({ status: 1, priority: 1 });
LeadSchema.index({ source: 1, status: 1 });
LeadSchema.index({ nextFollowUpDate: 1, status: 1 });
LeadSchema.index({ createdAt: -1 });
LeadSchema.index({ leadScore: -1 });

// Virtual for days since creation
LeadSchema.virtual('ageDays').get(function() {
  return Math.floor((Date.now() - this.createdAt) / 1000 / 60 / 60 / 24);
});

// Virtual for full name
LeadSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

module.exports = mongoose.model('Lead', LeadSchema);