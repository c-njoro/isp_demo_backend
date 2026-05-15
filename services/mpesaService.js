const axios = require('axios');

class MpesaService {
  constructor() {
    this.consumerKey = process.env.MPESA_CONSUMER_KEY;
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    this.passkey = process.env.MPESA_PASSKEY;
    this.shortcode = process.env.MPESA_SHORTCODE;
    this.environment = process.env.MPESA_ENVIRONMENT || 'sandbox';
    
    // API URLs
    this.baseURL = this.environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
    
    this.authURL = `${this.baseURL}/oauth/v1/generate?grant_type=client_credentials`;
    this.stkPushURL = `${this.baseURL}/mpesa/stkpush/v1/processrequest`;
    this.stkQueryURL = `${this.baseURL}/mpesa/stkpushquery/v1/query`;
  }

  /**
   * Generate OAuth access token
   */
  async getAccessToken() {
    try {
      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      
      console.log('Requesting token from:', this.authURL); // Debug
      const response = await axios.get(this.authURL, {
        headers: {
          Authorization: `Basic ${auth}`
        }
      });
  
      return response.data.access_token;
    } catch (error) {
      console.error('Error getting M-Pesa access token:');
      if (error.response) {
        // The request was made and the server responded with a status code
        console.error('Status:', error.response.status);
        console.error('Headers:', error.response.headers);
        console.error('Data:', error.response.data);
      } else if (error.request) {
        // The request was made but no response received
        console.error('No response received:', error.request);
      } else {
        // Something happened in setting up the request
        console.error('Error message:', error.message);
      }
      throw new Error('Failed to authenticate with M-Pesa API');
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
   */
  async initiateSTKPush(options) {
    try {
      const { phoneNumber, amount, accountReference, callbackUrl, transactionDesc } = options;

      // Validate inputs
      if (!phoneNumber || !amount || !accountReference || !callbackUrl) {
        throw new Error('Missing required parameters for STK push');
      }

      // Get access token
      const accessToken = await this.getAccessToken();

      // Format phone number
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      // Generate password and timestamp
      const { password, timestamp } = this.generatePassword();

      // Build request body
      const requestBody = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount), // Ensure integer
        PartyA: formattedPhone,
        PartyB: this.shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: transactionDesc || `Payment for ${accountReference}`
      };

      // Make STK push request
      const response = await axios.post(this.stkPushURL, requestBody, {
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
      console.error('STK Push Error FULL:');
console.error('Status:', error.response?.status);
console.error('Headers:', error.response?.headers);
console.error('Data:', error.response?.data);
console.error('Message:', error.message);
      
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
   */
  async querySTKPush(checkoutRequestId) {
    try {
      // Get access token
      const accessToken = await this.getAccessToken();

      // Generate password and timestamp
      const { password, timestamp } = this.generatePassword();

      // Build request body
      const requestBody = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      };

      // Make query request
      const response = await axios.post(this.stkQueryURL, requestBody, {
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
      console.error('STK Query Error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: error.response?.data?.errorMessage || error.message
      };
    }
  }

  /**
 * Simulate a C2B payment (sandbox only)
 * @param {Object} options - { amount, phoneNumber, billRefNumber, shortCode }
 */
async simulateC2B(options) {
  console.log('🧪 [simulateC2B] Starting simulation...');
  try {
    const accessToken = await this.getAccessToken();
    const { amount, phoneNumber, billRefNumber, shortCode = this.shortcode } = options;

    const requestBody = {
      ShortCode: shortCode,
      CommandID: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      Msisdn: this.formatPhoneNumber(phoneNumber),
      BillRefNumber: billRefNumber || 'TEST'
    };

    const url = `${this.baseURL}/mpesa/c2b/v1/simulate`;
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
 * Register C2B URLs (required once per environment)
 */
async registerC2BUrls(confirmationUrl, validationUrl, shortCode = null) {
  console.log('📝 [registerC2BUrls] Registering URLs...');
  try {
    const accessToken = await this.getAccessToken();
    const requestBody = {
      ShortCode: shortCode || this.shortcode,
      ResponseType: 'Completed',
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl
    };

    console.log('Request body:', requestBody); // Log the body

    const url = `${this.baseURL}/mpesa/c2b/v1/registerurl`;
    const response = await axios.post(url, requestBody, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ [registerC2BUrls] Success:', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('🔴 [registerC2BUrls] Error:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Message:', error.message);
    }
    return { success: false, error: error.message };
  }
}

async deregisterC2BUrls(shortCode = null) {
  console.log('🗑️ [deregisterC2BUrls] Deregistering...');
  try {
    const accessToken = await this.getAccessToken();
    const requestBody = {
      ShortCode: shortCode || this.shortcode
    };
    const url = `${this.baseURL}/mpesa/c2b/v1/registerurl`;
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
   * Parse M-Pesa callback data
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

      // If successful payment (ResultCode = 0)
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
      console.error('Error parsing callback:', error);
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