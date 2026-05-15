const axios = require("axios");
const crypto = require("crypto");

/**
 * Kopo Kopo Payment Service (Credential-Agnostic)
 *
 * This service is fully dependent on credentials passed from the controller.
 * It does not read from environment variables directly for credentials.
 *
 * Supports:
 * - M-Pesa STK Push
 * - Airtel Money payments
 * - Card payments (Visa/Mastercard)
 * - Webhooks for real-time notifications
 * - Transaction queries
 * - Bulk transfers (refunds, disbursements)
 */
class KopoKopoService {
  constructor() {
    // Base URLs for different environments
    this.sandboxBaseURL = "https://sandbox.kopokopo.com";
    this.productionBaseURL = "https://api.kopokopo.com";
  }

  // ============================================
  // HELPER: Get Base URL
  // ============================================

  /**
   * Get base URL based on environment
   */
  getBaseURL(environment = "sandbox") {
    return environment === "production"
      ? this.productionBaseURL
      : this.sandboxBaseURL;
  }

  // ============================================
  // AUTHENTICATION
  // ============================================

  /**
   * Get OAuth access token using provided credentials
   * 
   * @param {Object} credentials - Kopokopo credentials
   * @param {String} credentials.clientId - Client ID
   * @param {String} credentials.clientSecret - Client Secret
   * @param {String} credentials.environment - 'sandbox' or 'production'
   */
  async getAccessToken(credentials) {
    try {
      const { clientId, clientSecret, environment = "sandbox" } = credentials;

      if (!clientId || !clientSecret) {
        throw new Error("Client ID and Client Secret are required");
      }

      const baseURL = this.getBaseURL(environment);
      const tokenURL = `${baseURL}/oauth/token`;

      console.log("🔐 Requesting Kopo Kopo access token...");

      const response = await axios.post(
        tokenURL,
        {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      console.log("✅ Access token obtained");

      return {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in,
      };
    } catch (error) {
      console.error("❌ Token error:", error.response?.data || error.message);
      throw new Error("Failed to authenticate with Kopo Kopo API");
    }
  }

  // ============================================
  // PHONE NUMBER FORMATTING
  // ============================================

  /**
   * Format phone number to +254XXXXXXXXX
   */
  formatPhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, "");

    if (cleaned.startsWith("0")) {
      cleaned = cleaned.substring(1);
    }

    if (cleaned.startsWith("254")) {
      cleaned = cleaned.substring(3);
    }

    return `+254${cleaned}`;
  }

  // ============================================
  // PAYMENT REQUESTS (STK PUSH)
  // ============================================

  /**
   * Initiate payment request (STK Push)
   * Supports M-Pesa, Airtel Money, and Card payments
   *
   * @param {Object} options - Payment options
   * @param {String} options.phoneNumber - Customer phone number
   * @param {Number} options.amount - Amount to charge
   * @param {String} options.reference - Payment reference (e.g., accountId)
   * @param {String} options.description - Payment description
   * @param {String} options.callbackUrl - Webhook URL for notifications
   * @param {String} options.channel - 'mpesa', 'airtel', or 'card' (default: 'mpesa')
   * @param {Object} options.metadata - Additional data to attach
   * @param {Object} options.credentials - Kopokopo credentials (required)
   * @param {String} options.credentials.clientId - Client ID
   * @param {String} options.credentials.clientSecret - Client Secret
   * @param {String} options.credentials.apiKey - API Key
   * @param {String} options.credentials.tillNumber - Till Number
   * @param {String} options.credentials.environment - 'sandbox' or 'production'
   */
  async initiatePaymentRequest(options) {
    console.log("📞 Initiate payment service called");
    try {
      const {
        phoneNumber,
        amount,
        reference,
        description,
        callbackUrl,
        channel = "mpesa",
        metadata = {},
        credentials,
        firstName,
        lastName,
        email,
        redirectUrl,
      } = options;

      // Validate credentials
      if (!credentials || !credentials.clientId || !credentials.clientSecret) {
        throw new Error("Valid Kopokopo credentials are required");
      }

      const { clientId, clientSecret, apiKey, tillNumber, environment = "sandbox" } = credentials;

      if (!tillNumber) {
        throw new Error("Till number is required");
      }

      // Get access token
      const tokenResult = await this.getAccessToken({
        clientId,
        clientSecret,
        environment,
      });
      const accessToken = tokenResult.accessToken;

      // Get base URL and payment request endpoint
      const baseURL = this.getBaseURL(environment);
      const paymentRequestURL = `${baseURL}/api/v1/incoming_payments`;

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      // Build payment request based on channel
      let requestBody;
      if (channel === "card") {
        requestBody = {
          payment_channel: "card",
          till_number: tillNumber,
          amount: { currency: "KES", value: Math.round(amount) },
          metadata: { reference, ...metadata },
          _links: { 
            callback_url: callbackUrl, 
            redirect_url: redirectUrl 
          },
        };
      } else {
        requestBody = {
          payment_channel: "M-PESA STK Push",
          till_number: tillNumber,
          subscriber: {
            first_name: firstName || "Guest",
            last_name: lastName || "Customer",
            phone_number: formattedPhone,
            email: email || "",
          },
          amount: { currency: "KES", value: Math.round(amount) },
          metadata: { reference, ...metadata },
          _links: { callback_url: callbackUrl },
        };
      }

      console.log(`💳 Sending ${channel.toUpperCase()} payment request...`);

      const response = await axios.post(paymentRequestURL, requestBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.kommercio.v1+json",
        },
      });

      // Extract location header (contains payment request URL)
      const location = response.headers.location;
      const paymentRequestId = location ? location.split("/").pop() : null;

      console.log("✅ Payment request sent successfully");

      return {
        success: true,
        paymentRequestId,
        location,
        channel,
        message: `${channel.toUpperCase()} payment request sent to ${formattedPhone}`,
        responseData: response.data,
      };
    } catch (error) {
      console.error(
        "❌ Payment request error:",
        error.response?.data || error.message,
      );

      return {
        success: false,
        error: error.response?.data?.message || error.message,
        errorCode: error.response?.data?.code,
        details: error.response?.data,
      };
    }
  }

  /**
   * Initiate M-Pesa payment (convenience method)
   */
  async initiateMpesaPayment(options) {
    return this.initiatePaymentRequest({ ...options, channel: "mpesa" });
  }

  /**
   * Initiate Airtel Money payment (convenience method)
   */
  async initiateAirtelPayment(options) {
    return this.initiatePaymentRequest({ ...options, channel: "airtel" });
  }

  // ============================================
  // CARD PAYMENTS
  // ============================================

  /**
   * Initiate card payment
   *
   * @param {Object} options - Card payment options
   * @param {Number} options.amount - Amount to charge
   * @param {String} options.reference - Payment reference
   * @param {String} options.callbackUrl - Webhook URL
   * @param {String} options.redirectUrl - URL to redirect after payment
   * @param {Object} options.credentials - Kopokopo credentials (required)
   */
  async initiateCardPayment(options) {
    return this.initiatePaymentRequest({ ...options, channel: "card" });
  }

  // ============================================
  // QUERY TRANSACTIONS
  // ============================================

  /**
   * Query payment request status
   *
   * @param {String} paymentRequestId - Payment request ID from initiate response
   * @param {Object} credentials - Kopokopo credentials
   */
  async queryPaymentRequest(paymentRequestId, credentials) {
    try {
      if (!credentials || !credentials.clientId || !credentials.clientSecret) {
        throw new Error("Valid Kopokopo credentials are required");
      }

      const { clientId, clientSecret, environment = "sandbox" } = credentials;

      // Get access token
      const tokenResult = await this.getAccessToken({
        clientId,
        clientSecret,
        environment,
      });
      const accessToken = tokenResult.accessToken;

      const baseURL = this.getBaseURL(environment);
      const queryURL = `${baseURL}/api/v1/incoming_payments/${paymentRequestId}`;

      console.log(`🔍 Querying payment request: ${paymentRequestId}...`);

      const response = await axios.get(queryURL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      console.log("✅ Payment request queried successfully");

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("❌ Query error:", error.response?.data || error.message);

      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }

  // ============================================
  // WEBHOOKS
  // ============================================

  /**
   * Subscribe to Kopo Kopo webhooks
   *
   * @param {Object} options - Subscription options
   * @param {String} options.webhookUrl - Your webhook endpoint URL
   * @param {String} options.eventType - Event type to subscribe to
   * @param {String} options.reference - Scope reference (till number for buygoods)
   * @param {Object} options.credentials - Kopokopo credentials (required)
   */
  async subscribeToWebhooks(options) {
    try {
      const { webhookUrl, eventType, reference, credentials } = options;

      if (!credentials || !credentials.clientId || !credentials.clientSecret) {
        throw new Error("Valid Kopokopo credentials are required");
      }

      const { clientId, clientSecret, environment = "sandbox" } = credentials;

      // Get access token
      const tokenResult = await this.getAccessToken({
        clientId,
        clientSecret,
        environment,
      });
      const accessToken = tokenResult.accessToken;

      const baseURL = this.getBaseURL(environment);
      const webhookSubscriptionURL = `${baseURL}/api/v1/webhook_subscriptions`;

      const requestBody = {
        event_type: eventType,
        url: webhookUrl,
      };

      // Determine scope based on event type
      let scope;
      if (eventType === "payment_request.success" || eventType === "payment_request.failure") {
        scope = "company";
        requestBody.scope = scope;
      } else if (eventType === "buygoods_transaction_received") {
        if (!reference) {
          throw new Error(
            "Till number (reference) is required for buygoods_transaction_received",
          );
        }
        scope = "till";
        requestBody.scope = scope;
        requestBody.scope_reference = reference;
      } else {
        throw new Error(`Unsupported event type: ${eventType}`);
      }

      console.log(
        `🔔 Subscribing to ${eventType} webhooks with scope: ${scope}...`,
      );

      const response = await axios.post(
        webhookSubscriptionURL,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );

      console.log("✅ Webhook subscription created");

      return {
        success: true,
        subscriptionId: response.headers.location?.split("/").pop(),
        data: response.data,
      };
    } catch (error) {
      console.error(
        "❌ Webhook subscription error:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Verify webhook signature
   *
   * @param {String} signature - X-KopoKopo-Signature header
   * @param {Object} payload - Webhook payload
   * @param {String} apiKey - API key for signature verification
   */
  verifyWebhookSignature(signature, payload, apiKey) {
    try {
      if (!apiKey) {
        throw new Error("API key is required for signature verification");
      }

      const computedSignature = crypto
        .createHmac("sha256", apiKey)
        .update(JSON.stringify(payload))
        .digest("hex");

      return signature === computedSignature;
    } catch (error) {
      console.error("Signature verification error:", error);
      return false;
    }
  }

  /**
   * Parse webhook payload
   * Standardizes data from different webhook types
   */
  parseWebhook(payload) {
    try {
      const { event } = payload;

      // Base result
      const result = {
        eventType: event.type,
        eventId: event.id,
        resourceId: event.resource?.id,
        createdAt: event.created_at,
      };

      // Payment request webhook
      if (
        event.type === "payment_request.success" ||
        event.type === "payment_request.failure"
      ) {
        const resource = event.resource;

        result.status = event.type.includes("success") ? "success" : "failed";
        result.amount = resource.amount?.value;
        result.currency = resource.amount?.currency;
        result.reference = resource.metadata?.reference;
        result.description = resource.metadata?.description;
        result.channel = resource.payment_channel;
        result.phoneNumber = resource.subscriber?.phone_number;
        result.transactionReference = resource.transaction_reference;
        result.metadata = resource.metadata;
      }

      // Buygoods transaction (when customer pays to your till)
      if (event.type === "buygoods_transaction_received") {
        const resource = event.resource;

        result.status = "success";
        result.amount = resource.amount?.value;
        result.currency = resource.amount?.currency;
        result.senderPhoneNumber = resource.sender_phone_number;
        result.reference = resource.reference;
        result.tillNumber = resource.till_number;
        result.transactionReference = resource.transaction_reference;
        result.channel = "mpesa";
      }

      return result;
    } catch (error) {
      console.error("Webhook parsing error:", error);
      throw new Error("Invalid webhook payload");
    }
  }

  // ============================================
  // TRANSFERS (BULK PAYMENTS / REFUNDS)
  // ============================================

  /**
   * Send money (transfer/refund)
   *
   * @param {Object} options - Transfer options
   * @param {String} options.phoneNumber - Recipient phone
   * @param {Number} options.amount - Amount to send
   * @param {String} options.reference - Transfer reference
   * @param {String} options.description - Transfer description
   * @param {String} options.callbackUrl - Webhook URL
   * @param {Object} options.metadata - Additional data
   * @param {Object} options.credentials - Kopokopo credentials (required)
   */
  async sendMoney(options) {
    try {
      const {
        phoneNumber,
        amount,
        reference,
        description,
        callbackUrl,
        metadata = {},
        credentials,
      } = options;

      if (!credentials || !credentials.clientId || !credentials.clientSecret) {
        throw new Error("Valid Kopokopo credentials are required");
      }

      const { clientId, clientSecret, environment = "sandbox" } = credentials;

      // Get access token
      const tokenResult = await this.getAccessToken({
        clientId,
        clientSecret,
        environment,
      });
      const accessToken = tokenResult.accessToken;

      const baseURL = this.getBaseURL(environment);
      const transferURL = `${baseURL}/api/v1/transfers`;

      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      const requestBody = {
        destination_type: "mobile_wallet",
        destination: {
          type: "mobile_wallet",
          phone_number: formattedPhone,
        },
        amount: {
          currency: "KES",
          value: Math.round(amount),
        },
        metadata: {
          reference,
          description: description || `Transfer: ${reference}`,
          ...metadata,
        },
        _links: {
          callback_url: callbackUrl,
        },
      };

      console.log(`💸 Sending money to ${formattedPhone}...`);
      console.log(`   Amount: KES ${amount}`);

      const response = await axios.post(transferURL, requestBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      const transferId = response.headers.location?.split("/").pop();

      console.log("✅ Transfer initiated");

      return {
        success: true,
        transferId,
        location: response.headers.location,
        message: `Transfer of KES ${amount} to ${formattedPhone} initiated`,
      };
    } catch (error) {
      console.error(
        "❌ Transfer error:",
        error.response?.data || error.message,
      );

      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Bulk transfers (send money to multiple people)
   *
   * @param {Array} transfers - Array of transfer objects
   * @param {String} callbackUrl - Webhook URL
   * @param {Object} credentials - Kopokopo credentials (required)
   */
  async bulkTransfer(transfers, callbackUrl, credentials) {
    if (!credentials) {
      throw new Error("Credentials are required for bulk transfers");
    }

    const results = [];

    for (const transfer of transfers) {
      const result = await this.sendMoney({
        ...transfer,
        callbackUrl,
        credentials,
      });

      results.push({
        reference: transfer.reference,
        ...result,
      });

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      success: true,
      transfers: results,
      total: transfers.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };
  }

  // ============================================
  // UTILITIES
  // ============================================

  /**
   * Get channel from phone number prefix
   * Automatically detect M-Pesa or Airtel
   */
  detectChannel(phoneNumber) {
    const cleaned = phoneNumber.replace(/\D/g, "");

    // Safaricom (M-Pesa) prefixes: 70, 71, 72, 79
    if (/^(254)?(70|71|72|79)/.test(cleaned)) {
      return "mpesa";
    }

    // Airtel prefixes: 73, 74, 78
    if (/^(254)?(73|74|78)/.test(cleaned)) {
      return "airtel";
    }

    // Default to M-Pesa
    return "mpesa";
  }



/**
 * List all webhook subscriptions
 * @param {Object} credentials - Kopokopo credentials (clientId, clientSecret, environment)
 * @returns {Promise<Array>} List of subscriptions
 */
async listWebhookSubscriptions(credentials) {
  const { clientId, clientSecret, environment = 'sandbox' } = credentials;
  const tokenResult = await this.getAccessToken({ clientId, clientSecret, environment });
  const baseURL = this.getBaseURL(environment);
  const url = `${baseURL}/api/v1/webhook_subscriptions`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${tokenResult.accessToken}` }
  });
  return response.data;
}

/**
 * Delete a webhook subscription by its ID
 * @param {string} subscriptionId - The ID of the subscription to delete
 * @param {Object} credentials - Kopokopo credentials
 */
async deleteWebhookSubscription(subscriptionId, credentials) {
  const { clientId, clientSecret, environment = 'sandbox' } = credentials;
  const tokenResult = await this.getAccessToken({ clientId, clientSecret, environment });
  const baseURL = this.getBaseURL(environment);
  const url = `${baseURL}/api/v1/webhook_subscriptions/${subscriptionId}`;
  await axios.delete(url, {
    headers: { Authorization: `Bearer ${tokenResult.accessToken}` }
  });
}

  /**
   * Validate credentials object
   */
  validateCredentials(credentials) {
    if (!credentials) {
      throw new Error("Credentials object is required");
    }

    const required = ["clientId", "clientSecret", "apiKey", "tillNumber"];
    const missing = required.filter((field) => !credentials[field]);

    if (missing.length > 0) {
      throw new Error(`Missing required credentials: ${missing.join(", ")}`);
    }

    return true;
  }
}

module.exports = new KopoKopoService();