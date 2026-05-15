const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const RoleSchema = new Schema({
  // Role Details
  roleName: {
    type: String,
    required: true,
    unique: true,
    trim: true
    // e.g., 'Sales Manager', 'Support Agent', 'Network Technician'
  },
  
  roleCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
    // e.g., 'SALES_MGR', 'SUPPORT_AGT', 'NETWORK_TECH'
  },
  
  description: {
    type: String,
    required: true
  },
  
  // System Roles (cannot be deleted)
  isSystem: {
    type: Boolean,
    default: false
    // true for: SUPER_ADMIN, ADMIN, etc.
  },
  
  // Permissions Structure
  permissions: {
    // Dashboard Access
    dashboard: {
      view: { type: Boolean, default: false },
      viewAllRegions: { type: Boolean, default: false },
      viewEarnings: { type: Boolean, default: false },
      subscriptionTimeline: { type: Boolean, default: false },
      revenueOverTime: { type: Boolean, default: false },
      customerGrowth: { type: Boolean, default: false },
      packageDistribution: { type: Boolean, default: false },
      systemHealth: { type: Boolean, default: false },
      recentActivities: { type: Boolean, default: false },
      topCustomers: { type: Boolean, default: false },
    },

    menu: {
      dashboard: { type: Boolean, default: true },
      customers: { type: Boolean, default: false },
      leads: { type: Boolean, default: false },
      olt: { type: Boolean, default: false },
      onu: { type: Boolean, default: false },
      payments: { type: Boolean, default: false },
      invoices: { type: Boolean, default: false },
      sites: { type: Boolean, default: false },
      packages: { type: Boolean, default: false },
      tickets: { type: Boolean, default: false },
      users: { type: Boolean, default: false },
      roles: { type: Boolean, default: false },
      systemLogs: { type: Boolean, default: false },
      configure: { type: Boolean, default: false },
      radius: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
      regions: { type: Boolean, default: false },
      reports: { type: Boolean, default: false },
      

    },
    
    // Customer Management
    customers: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      viewPaymentHistory: { type: Boolean, default: false },
      manageSubscription: { type: Boolean, default: false },
      suspend: { type: Boolean, default: false },
      terminate: { type: Boolean, default: false },
      changePlan: { type: Boolean, default: false },
      overridePlan: { type: Boolean, default: false },
      overrideSubscription: { type: Boolean, default: false },
      prorateSubscription: { type: Boolean, default: false },
      extendSubscription: { type: Boolean, default: false },
      managePayment: { type: Boolean, default: false },
      requestPayment: { type: Boolean, default: false },
      depositPayment: { type: Boolean, default: false },
      resolvePayment: { type: Boolean, default: false },
      addExpense: { type: Boolean, default: false },
      burstSpeed: { type: Boolean, default: false },
      clearMac: { type: Boolean, default: false },
    },
    
    // Lead Management
    leads: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      assign: { type: Boolean, default: false },
      convert: { type: Boolean, default: false },
      exportData: { type: Boolean, default: false }
    },
    
    // Ticket Management
    tickets: {
      view: { type: Boolean, default: false },
      viewAll: { type: Boolean, default: false }, // vs only assigned tickets
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      assign: { type: Boolean, default: false },
      resolve: { type: Boolean, default: false },
      close: { type: Boolean, default: false },
      viewInternalNotes: { type: Boolean, default: false }
    },
    
    // Payment & Billing
    payments: {
      view: { type: Boolean, default: false },
      processManual: { type: Boolean, default: false },
      viewTransactions: { type: Boolean, default: false },
      reconcile: { type: Boolean, default: false },
      refund: { type: Boolean, default: false },
      viewInvoices: { type: Boolean, default: false },
      generateInvoice: { type: Boolean, default: false }
    },
    
    // Package Management
    packages: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      changePricing: { type: Boolean, default: false }
    },
    
    // Site Management
    sites: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      viewRouterCredentials: { type: Boolean, default: false },
      editRouterConfig: { type: Boolean, default: false }
    },
    
    // Network Management
    network: {
      viewStatus: { type: Boolean, default: false },
      enableDisableAccounts: { type: Boolean, default: false },
      manageBandwidth: { type: Boolean, default: false },
      accessMikrotik: { type: Boolean, default: false },
      accessRadius: { type: Boolean, default: false },
      viewLogs: { type: Boolean, default: false }
    },
    
    // Reports
    reports: {
      viewRevenue: { type: Boolean, default: false },
      viewCustomerStats: { type: Boolean, default: false },
      viewSalesReport: { type: Boolean, default: false },
      viewTicketReport: { type: Boolean, default: false },
      viewNetworkReport: { type: Boolean, default: false },
      exportReports: { type: Boolean, default: false }
    },
    
    // SMS & Communication
    communication: {
      sendSMS: { type: Boolean, default: false },
      sendBulkSMS: { type: Boolean, default: false },
      viewSMSHistory: { type: Boolean, default: false },
      manageSMSTemplates: { type: Boolean, default: false }
    },
    
    // User Management
    users: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      manageRoles: { type: Boolean, default: false },
      resetPassword: { type: Boolean, default: false }
    },
    
    // System Settings
    settings: {
      viewSettings: { type: Boolean, default: false },
      editSettings: { type: Boolean, default: false },
      manageIntegrations: { type: Boolean, default: false },
      viewSystemLogs: { type: Boolean, default: false },
      manageBackups: { type: Boolean, default: false }
    }
  },
  
  // Region Access
  allowedRegions: [{
    type: String,
    uppercase: true
    // Empty array or ['*'] means all regions
  }],
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // User Count
  userCount: {
    type: Number,
    default: 0
    // Number of users with this role
  },
  
  // Created By
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  
  lastModifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes
RoleSchema.index({ roleName: 1 });
RoleSchema.index({ roleCode: 1 });
RoleSchema.index({ isActive: 1 });
RoleSchema.index({ isSystem: 1 });

// Method to check if role has specific permission
RoleSchema.methods.hasPermission = function(module, action) {
  if (!this.permissions[module]) return false;
  return this.permissions[module][action] === true;
};

// Method to get all granted permissions as array
RoleSchema.methods.getGrantedPermissions = function() {
  const granted = [];
  
  for (const [module, actions] of Object.entries(this.permissions)) {
    for (const [action, value] of Object.entries(actions)) {
      if (value === true) {
        granted.push(`${module}.${action}`);
      }
    }
  }
  
  return granted;
};

module.exports = mongoose.model('Role', RoleSchema);