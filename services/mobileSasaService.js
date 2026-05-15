const axios = require('axios');

class MobileSasaService {
  constructor() {
    // Ensure base URL ends with /v1 (without trailing slash)
    this.baseURL = process.env.MOBILE_SASA_BASE_URL || 'https://api.mobilesasa.com/v1';
    this.apiToken = process.env.MOBILE_SASA_API_TOKEN;
    this.defaultSender = process.env.MOBILE_SASA_DEFAULT_SENDER || 'MOBILESASA';
    this.headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiToken}`
    };
  }

  async _request(method, endpoint, data = null) {
    try {
      const url = `${this.baseURL}${endpoint}`;
      const config = { method, url, headers: this.headers };
      if (data && (method === 'POST' || method === 'PUT')) {
        config.data = data;
      } else if (data && method === 'GET') {
        config.params = data;
      }
      const response = await axios(config);
      return response.data;
    } catch (error) {
      const errMsg = error.response?.data?.message || error.message;
      throw new Error(`Mobile Sasa API error: ${errMsg}`);
    }
  }

  async sendSingle(phone, message) {
    const payload = {
      senderID: this.defaultSender,
      message,
      phone
    };
    const response = await this._request('POST', '/send/message', payload);
    if (response.status === true && response.responseCode === '0200') {
      return {
        success: true,
        messageId: response.messageId,
        cost: response.cost || null,
        response
      };
    }
    throw new Error(response.message || 'Failed to send SMS');
  }

  async sendBulk(phones, message) {
    const phonesStr = phones.join(',');
    const payload = {
      senderID: this.defaultSender,
      message,
      phones: phonesStr
    };
    const response = await this._request('POST', '/send/bulk', payload);
    if (response.status === true && response.responseCode === '0200') {
      return {
        success: true,
        bulkId: response.bulkId,
        response
      };
    }
    throw new Error(response.message || 'Failed to send bulk SMS');
  }

  async sendPersonalized(messages) {
    const payload = {
      senderID: this.defaultSender,
      messageBody: messages.map(m => ({
        phone: m.phone,
        message: m.message
      }))
    };
    const response = await this._request('POST', '/send/bulk-personalized', payload);
    if (response.status === true && response.responseCode === '0200') {
      return {
        success: true,
        bulkId: response.bulkId,
        response
      };
    }
    throw new Error(response.message || 'Failed to send personalized SMS');
  }

  // Fixed delivery status endpoint (using /dir as per documentation)
  async checkDeliveryStatus(messageId) {
    const payload = { messageId };
    const response = await this._request('POST', '/dir', payload);
    if (response.status === true && response.responseCode === '0200') {
      const msg = response.messages;
      return {
        success: true,
        status: msg.deliveryStatus?.status || msg.status,
        deliveryTime: msg.deliveryStatus?.deliveryTime || null,
        cost: msg.cost,
        parts: msg.parts,
        sentTime: msg.sentTime,
        phone: msg.phone,
        raw: response
      };
    }
    throw new Error(response.message || 'Failed to get delivery status');
  }

  async getBalance() {
    const response = await this._request('GET', '/get-balance');
    if (response.status === true && response.responseCode === '0200') {
      return {
        success: true,
        balance: response.balance,
        internationalBalance: response.internationalBalance,
        localAccountNumber: response.localAccountNumber,
        walletAccountNumber: response.walletAccountNumber
      };
    }
    throw new Error(response.message || 'Failed to get balance');
  }

  async getSenders() {
    const response = await this._request('POST', '/senders/load-all');
    if (response.status === true && response.responseCode === '0200') {
      return {
        success: true,
        senders: response.payload
      };
    }
    throw new Error(response.message || 'Failed to get senders');
  }

  async validatePhone(phone) {
    const payload = { phone };
    const response = await this._request('POST', '/msisdns/load-details', payload);
    if (response.status === true && response.responseCode === '0200') {
      return {
        success: true,
        networkName: response.networkName,
        formattedPhone: response.formattedPhone
      };
    }
    throw new Error(response.message || 'Invalid phone number');
  }
}

module.exports = new MobileSasaService();