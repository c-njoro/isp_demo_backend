const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SystemLogSchema = new Schema(
  {
    eventType: {
      type: String,
      required: true,
      enum: [
        "admin_action",
        'subscription_activation',
        "auto_deactivation",
        "auto_renewal",
        "child_account_created",
        "cpe_reset",
        "customer_onu_reboot",
        "customer_otp_requested",
        "customer_package_changed",
        "customer_payment_initiated",
        "customer_portal_login",
        "customer_update",
        "customer_updated",
        "customer_wifi_updated",
        "error",
        "invoice",
        "olt_connection_test",
        "olt_created",
        "olt_deleted",
        "olt_updated",
        "onu_created",
        "onu_deleted",
        "onu_reboot",
        'expiry_updated',
        'package_changed_override',
        'expiry_extended_with_debt',
        "onu_updated",
        "payment_initiated",
        "payment_processing",
        "payment_received",
        "payment_transferred",
        "subscription_renewal",
        'payment_transferred',
        'speed_override',
        'parent_profile_updated',
        "radius_enabled",
        'disabled_redirect_configured',
        'disabled_redirect_failed',
        'speed_override_removed',
        'customer_mac_cleared',
        'expiry_moved',
        'burst_applied',
        'burst_removed',
        'expiry_override',
        'expiry_extension',
        'expense_deducted',
        'radius_sync',
        'hotspot_activation',
        'radius_sync_single',
        'payment_initiated',
        'retention_record',
        'radius_sync_mismatched',
        'radius_sync_bulk',
        'hotspot_activation',
        'voucher_created',
        'voucher_updated',
        'voucher_deleted',
        'voucher_redeemed',
        'expiry_propagation',
        'package_propagation',
        'child_auto_renewal',
        'voucher_generated_and_sent',
        'voucher_sms_failed',
        'radius_sync_single',
        'olt_created',
        'document_generated',
        'olt_connection_test',
        'onu_authorization'
        
        
      ],
    },

    severity: {
      type: String,
      enum: ["info", "warning", "error", "critical"],
      default: "info",
    },

    regionCode: {
      type: String,
      uppercase: true,
    },

    // Entity Reference
    entityType: {
      type: String,
      enum: [
        "customer",
        "hotspot_user",
        "payment",
        "transaction",
        "admin",
        "lead",
        "sms",
        "ticket",
        "user",
        "invoice",
        "site",
        "system",
        'voucher',
        'olt',
        'onu'

      ],
    },

    entityId: {
      type: Schema.Types.ObjectId,
    },

    accountId: {
      type: String,
    },

    // Log Details
    message: {
      type: String,
      required: true,
    },

    details: {
      type: Schema.Types.Mixed,
      // Store any additional data as JSON
    },

    // User/System that triggered the event
    triggeredBy: {
      type: String,
      default: "system",
      // 'system' or admin ID
    },

    // Related records
    relatedTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
    },

    relatedPaymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
    },

    // Execution status
    success: {
      type: Boolean,
      default: true,
    },

    error: {
      code: String,
      message: String,
      stack: String,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
SystemLogSchema.index({ eventType: 1, createdAt: -1 });
SystemLogSchema.index({ severity: 1, createdAt: -1 });
SystemLogSchema.index({ entityId: 1, createdAt: -1 });
SystemLogSchema.index({ regionCode: 1, createdAt: -1 });

module.exports = mongoose.model("SystemLog", SystemLogSchema);
