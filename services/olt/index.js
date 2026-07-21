const HuaweiOLTService = require('./huawei');
const ZTEOLTService = require('./zte');

/**
 * OLT Service Factory
 * 
 * Main entry point for OLT operations. Automatically selects the correct
 * vendor-specific service based on the OLT's brand.
 * 
 * Replaces the old smartOltService.js file.
 * 
 * Usage:
 *   const oltService = require('../services/olt');
 *   const result = await oltService.testConnection(olt);
 */

class OLTServiceFactory {
  constructor() {
    // Initialize vendor-specific services
    this.services = {
      huawei: new HuaweiOLTService(),
      zte: new ZTEOLTService()
    };

    // Supported vendors
    this.supportedVendors = ['huawei', 'zte'];
  }

  /**
   * Get the appropriate service for an OLT
   * @private
   */
  _getService(olt) {
    if (!olt || !olt.brand) {
      throw new Error('OLT brand is required');
    }

    const brand = olt.brand.toLowerCase();
    
    if (!this.services[brand]) {
      throw new Error(
        `Unsupported OLT brand: ${olt.brand}. Supported brands: ${this.supportedVendors.join(', ')}`
      );
    }

    return this.services[brand];
  }

  /**
   * Test connection to OLT
   * @param {Object} olt - OLT document from database
   * @returns {Promise<Object>} { success, version?, error?, message }
   */
  async testConnection(olt) {
    try {
      const service = this._getService(olt);
      return await service.testConnection(olt);
    } catch (error) {
      console.error(`❌ OLT service error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to connect to OLT: ${error.message}`
      };
    }
  }

  /**
   * Get OLT system information
   */
  async getSystemInfo(olt) {
    const service = this._getService(olt);
    return await service.getSystemInfo(olt);
  }

  /**
   * Get all PON ports status
   */
  async getPonPorts(olt) {
    const service = this._getService(olt);
    return await service.getPonPorts(olt);
  }

  /**
   * Get ONUs on specific PON port
   */
  async getOnusOnPort(olt, ponPort) {
    const service = this._getService(olt);
    return await service.getOnusOnPort(olt, ponPort);
  }

  /**
   * Get all ONUs across all ports
   */
  async getAllOnus(olt) {
    const service = this._getService(olt);
    return await service.getAllOnus(olt);
  }

  /**
   * Get specific ONU details
   */
  async getOnuDetails(olt, ponPort, onuId) {
    const service = this._getService(olt);
    return await service.getOnuDetails(olt, ponPort, onuId);
  }

  /**
   * Provision/Configure ONU
   */
  async provisionOnu(olt, config) {
    const service = this._getService(olt);
    return await service.provisionOnu(olt, config);
  }

  /**
   * Authorize ONU (allow it to come online)
   */
  async authorizeOnu(olt, serialNumber, ponPort, onuId) {
    const service = this._getService(olt);
    return await service.authorizeOnu(olt, serialNumber, ponPort, onuId);
  }


  /**
   * Authorize a newly discovered ONU using the SKYLINK Profile Architecture
   */
  async authorizeNewOnuSkylink(olt, params) {
    const service = this._getService(olt);
    if (typeof service.authorizeNewOnuSkylink !== 'function') {
      throw new Error(`Skylink provisioning is not supported for ${olt.brand} OLTs yet.`);
    }
    return await service.authorizeNewOnuSkylink(olt, params);
  }

  
  /**
   * Deauthorize/Remove ONU
   */
  async deauthorizeOnu(olt, ponPort, onuId) {
    const service = this._getService(olt);
    return await service.deauthorizeOnu(olt, ponPort, onuId);
  }

  /**
   * Reboot ONU
   */
  async rebootOnu(olt, ponPort, onuId) {
    const service = this._getService(olt);
    return await service.rebootOnu(olt, ponPort, onuId);
  }

  /**
   * Get ONU optical power levels
   */
  async getOnuOpticalPower(olt, ponPort, onuId) {
    const service = this._getService(olt);
    return await service.getOnuOpticalPower(olt, ponPort, onuId);
  }

  /**
   * Get unconfigured ONUs (discovered but not authorized)
   */
  async getUnconfiguredOnus(olt) {
    const service = this._getService(olt);
    return await service.getUnconfiguredOnus(olt);
  }

  /**
   * Set ONU VLAN configuration
   */
  async setOnuVlan(olt, ponPort, onuId, vlanId) {
    const service = this._getService(olt);
    return await service.setOnuVlan(olt, ponPort, onuId, vlanId);
  }

  /**
   * Set ONU bandwidth profile
   */
  async setOnuBandwidth(olt, ponPort, onuId, profile) {
    const service = this._getService(olt);
    return await service.setOnuBandwidth(olt, ponPort, onuId, profile);
  }

  /**
   * Get ONU statistics
   */
  async getOnuStatistics(olt, ponPort, onuId) {
    const service = this._getService(olt);
    return await service.getOnuStatistics(olt, ponPort, onuId);
  }

  /**
   * Get list of supported vendors
   */
  getSupportedVendors() {
    return this.supportedVendors;
  }

  /**
   * Check if a vendor is supported
   */
  isVendorSupported(brand) {
    return this.supportedVendors.includes(brand.toLowerCase());
  }
}

// Export singleton instance
module.exports = new OLTServiceFactory();