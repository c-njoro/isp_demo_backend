const axios = require('axios');

class MpesaService {
  constructor() {
    // Default credentials from environment (fallback)
    this.consumerKey = process.env.MPESA_CONSUMER_KEY;
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    this.passkey = process.env.MPESA_PASSKEY;
    this.shortcode = process.env.MPESA_SHORTCODE;
    this.environment = process.env.MPESA_ENVIRONMENT || 'sandbox';
  }

  /**
   * Get base URL based on current environment
   */
  getBaseURL() {
    return this.environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
  }

  /**
   * Generate OAuth access token using current credentials
   */
  async getAccessToken() {
    try {
      if (!this.consumerKey || !this.consumerSecret) {
        throw new Error('M‑Pesa consumer key and secret are not set');
      }

      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      const baseURL = this.getBaseURL();
      const authURL = `${baseURL}/oauth/v1/generate?grant_type=client_credentials`;

      console.log('🔐 Requesting M‑Pesa access token...');
      const response = await axios.get(authURL, {
        headers: {
          Authorization: `Basic ${auth}`
        }
      });

      return response.data.access_token;
    } catch (error) {
      console.error('❌ M‑Pesa token error:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with M‑Pesa API');
    }
  }

  /**
   * Generate password for STK push
   */
  generatePassword() {
    const timestamp = this.getTimestamp();
    const password = Buffer.from(`${this.shortcode}${this.passkey}${timestamp}`).toString('base64');
    return { password, timestamp };
  }

  /**
   * Get timestamp in format YYYYMMDDHHmmss
   */
  getTimestamp() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  /**
   * Format phone number to 254XXXXXXXXX
   */
  formatPhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned;
    }
    return cleaned;
  }

  /**
   * Initiate STK Push
   * @param {Object} options - { phoneNumber, amount, accountReference, callbackUrl, transactionDesc }
   * @param {Object} credentials - Optional: { consumerKey, consumerSecret, passkey, shortcode, environment }
   */
  async initiateSTKPush(options, credentials = null) {
    try {
      // Override instance credentials if provided
      if (credentials) {
        this.consumerKey = credentials.consumerKey || this.consumerKey;
        this.consumerSecret = credentials.consumerSecret || this.consumerSecret;
        this.passkey = credentials.passkey || this.passkey;
        this.shortcode = credentials.shortcode || this.shortcode;
        this.environment = credentials.environment || this.environment;
      }

      // Validate credentials
      if (!this.consumerKey || !this.consumerSecret || !this.passkey || !this.shortcode) {
        throw new Error('M‑Pesa credentials are incomplete');
      }

      const { phoneNumber, amount, accountReference, callbackUrl, transactionDesc } = options;

      if (!phoneNumber || !amount || !accountReference || !callbackUrl) {
        throw new Error('Missing required parameters for STK push');
      }

      const accessToken = await this.getAccessToken();
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      const { password, timestamp } = this.generatePassword();

      const baseURL = this.getBaseURL();
      const stkPushURL = `${baseURL}/mpesa/stkpush/v1/processrequest`;

      const requestBody = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: this.shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: transactionDesc || `Payment for ${accountReference}`
      };

      console.log(`📤 Sending STK push to ${formattedPhone}...`);
      const response = await axios.post(stkPushURL, requestBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        checkoutRequestId: response.data.CheckoutRequestID,
        merchantRequestId: response.data.MerchantRequestID,
        responseCode: response.data.ResponseCode,
        responseDescription: response.data.ResponseDescription,
        customerMessage: response.data.CustomerMessage
      };

    } catch (error) {
      console.error('❌ STK Push error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errorMessage || error.message,
        errorCode: error.response?.data?.errorCode
      };
    }
  }

  /**
   * Query STK Push status
   * @param {String} checkoutRequestId
   * @param {Object} credentials - Optional
   */
  async querySTKPush(checkoutRequestId, credentials = null) {
    try {
      if (credentials) {
        this.consumerKey = credentials.consumerKey || this.consumerKey;
        this.consumerSecret = credentials.consumerSecret || this.consumerSecret;
        this.passkey = credentials.passkey || this.passkey;
        this.shortcode = credentials.shortcode || this.shortcode;
        this.environment = credentials.environment || this.environment;
      }

      const accessToken = await this.getAccessToken();
      const { password, timestamp } = this.generatePassword();

      const baseURL = this.getBaseURL();
      const stkQueryURL = `${baseURL}/mpesa/stkpushquery/v1/query`;

      const requestBody = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      };

      const response = await axios.post(stkQueryURL, requestBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        resultCode: response.data.ResultCode,
        resultDesc: response.data.ResultDesc,
        responseCode: response.data.ResponseCode
      };

    } catch (error) {
      console.error('❌ STK Query error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errorMessage || error.message
      };
    }
  }

  /**
   * Simulate C2B payment (sandbox only)
   */
  async simulateC2B(options, credentials = null) {
    console.log('🧪 [simulateC2B] Starting simulation...');
    try {
      if (credentials) {
        this.consumerKey = credentials.consumerKey || this.consumerKey;
        this.consumerSecret = credentials.consumerSecret || this.consumerSecret;
        this.passkey = credentials.passkey || this.passkey;
        this.shortcode = credentials.shortcode || this.shortcode;
        this.environment = credentials.environment || this.environment;
      }

      const accessToken = await this.getAccessToken();
      const { amount, phoneNumber, billRefNumber, shortCode = this.shortcode } = options;

      const baseURL = this.getBaseURL();
      const url = `${baseURL}/mpesa/c2b/v1/simulate`;

      const requestBody = {
        ShortCode: shortCode,
        CommandID: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        Msisdn: this.formatPhoneNumber(phoneNumber),
        BillRefNumber: billRefNumber || 'TEST'
      };

      const response = await axios.post(url, requestBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ [simulateC2B] Response:', response.data);
      return { success: true, data: response.data };
    } catch (error) {
      console.error('🔴 [simulateC2B] Error:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Register C2B URLs
   */
  async registerC2BUrls(confirmationUrl, validationUrl, shortCode = null, credentials = null) {
    console.log('📝 [registerC2BUrls] Registering URLs...');
    try {
      if (credentials) {
        this.consumerKey = credentials.consumerKey || this.consumerKey;
        this.consumerSecret = credentials.consumerSecret || this.consumerSecret;
        this.passkey = credentials.passkey || this.passkey;
        this.shortcode = credentials.shortcode || this.shortcode;
        this.environment = credentials.environment || this.environment;
      }

      const accessToken = await this.getAccessToken();
      const baseURL = this.getBaseURL();
      const url = `${baseURL}/mpesa/c2b/v1/registerurl`;

      const requestBody = {
        ShortCode: shortCode || this.shortcode,
        ResponseType: 'Completed',
        ConfirmationURL: confirmationUrl,
        ValidationURL: validationUrl
      };

      const response = await axios.post(url, requestBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ [registerC2BUrls] Success:', response.data);
      return { success: true, data: response.data };
    } catch (error) {
      console.error('🔴 [registerC2BUrls] Error:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  async deregisterC2BUrls(shortCode = null, credentials = null) {
    console.log('🗑️ [deregisterC2BUrls] Deregistering...');
    try {
      if (credentials) {
        this.consumerKey = credentials.consumerKey || this.consumerKey;
        this.consumerSecret = credentials.consumerSecret || this.consumerSecret;
        this.passkey = credentials.passkey || this.passkey;
        this.shortcode = credentials.shortcode || this.shortcode;
        this.environment = credentials.environment || this.environment;
      }

      const accessToken = await this.getAccessToken();
      const baseURL = this.getBaseURL();
      const url = `${baseURL}/mpesa/c2b/v1/registerurl`;

      const requestBody = {
        ShortCode: shortCode || this.shortcode
      };

      const response = await axios.post(url, requestBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return { success: true, data: response.data };
    } catch (error) {
      console.error('🔴 [deregisterC2BUrls] Error:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Parse M‑Pesa callback data
   */
  parseCallback(callbackData) {
    try {
      const { Body } = callbackData;
      const { stkCallback } = Body;

      const result = {
        merchantRequestId: stkCallback.MerchantRequestID,
        checkoutRequestId: stkCallback.CheckoutRequestID,
        resultCode: stkCallback.ResultCode,
        resultDesc: stkCallback.ResultDesc
      };

      if (stkCallback.ResultCode === 0) {
        const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
        result.amount = callbackMetadata.find(item => item.Name === 'Amount')?.Value;
        result.mpesaReceiptNumber = callbackMetadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
        result.transactionDate = callbackMetadata.find(item => item.Name === 'TransactionDate')?.Value;
        result.phoneNumber = callbackMetadata.find(item => item.Name === 'PhoneNumber')?.Value;
        result.accountReference = callbackMetadata.find(item => item.Name === 'AccountReference')?.Value;
      }

      return result;
    } catch (error) {
      console.error('❌ Callback parsing error:', error);
      throw new Error('Invalid callback data');
    }
  }

  /**
   * Get result code description
   */
  getResultCodeDescription(resultCode) {
    const codes = {
      0: 'Success',
      1: 'Insufficient Funds',
      1032: 'Request cancelled by user',
      1037: 'Timeout - User did not enter PIN',
      2001: 'Wrong PIN',
      1001: 'Unable to complete transaction',
      1019: 'Transaction failed',
      1025: 'Unable to complete transaction',
      1026: 'Unable to complete transaction'
    };
    return codes[resultCode] || 'Transaction failed';
  }
}

module.exports = new MpesaService();