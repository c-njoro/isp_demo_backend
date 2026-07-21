/**
 * Base OLT Service Class
 * 
 * Abstract base class that defines the interface for all OLT vendors.
 * All vendor-specific implementations (Huawei, ZTE) must extend this class.
 */

class BaseOLTService {
  constructor() {
    this.connectionTimeout = 60000;
  }

  /**
   * Test connection to OLT
   * @param {Object} olt - OLT document from database
   * @returns {Promise<Object>} { success, version?, error?, message }
   */
  async testConnection(olt) {
    throw new Error('testConnection() must be implemented by vendor-specific class');
  }

  /**
   * Get OLT system information
   * @param {Object} olt - OLT document
   * @returns {Promise<Object>} { success, data?, error? }
   */
  async getSystemInfo(olt) {
    throw new Error('getSystemInfo() must be implemented by vendor-specific class');
  }

  /**
   * Get all PON ports status
   * @param {Object} olt - OLT document
   * @returns {Promise<Object>} { success, ports: [], error? }
   */
  async getPonPorts(olt) {
    throw new Error('getPonPorts() must be implemented by vendor-specific class');
  }

  /**
   * Get ONUs on a specific PON port
   * @param {Object} olt - OLT document
   * @param {number} ponPort - PON port number (0-based)
   * @returns {Promise<Object>} { success, onus: [], error? }
   */
  async getOnusOnPort(olt, ponPort) {
    throw new Error('getOnusOnPort() must be implemented by vendor-specific class');
  }

  /**
   * Get all ONUs across all PON ports
   * @param {Object} olt - OLT document
   * @returns {Promise<Object>} { success, onus: [], error? }
   */
  async getAllOnus(olt) {
    throw new Error('getAllOnus() must be implemented by vendor-specific class');
  }

  /**
   * Get specific ONU details
   * @param {Object} olt - OLT document
   * @param {number} ponPort - PON port number
   * @param {number} onuId - ONU ID on the port
   * @returns {Promise<Object>} { success, data?, error? }
   */
  async getOnuDetails(olt, ponPort, onuId) {
    throw new Error('getOnuDetails() must be implemented by vendor-specific class');
  }

  /**
   * Provision/Configure ONU
   * @param {Object} olt - OLT document
   * @param {Object} config - ONU configuration
   * @returns {Promise<Object>} { success, data?, error? }
   */
  async provisionOnu(olt, config) {
    throw new Error('provisionOnu() must be implemented by vendor-specific class');
  }

  /**
   * Authorize ONU (allow it to come online)
   * @param {Object} olt - OLT document
   * @param {string} serialNumber - ONU serial number
   * @param {number} ponPort - PON port number
   * @param {number} onuId - ONU ID to assign
   * @returns {Promise<Object>} { success, data?, error? }
   */
  async authorizeOnu(olt, serialNumber, ponPort, onuId) {
    throw new Error('authorizeOnu() must be implemented by vendor-specific class');
  }

  /**
   * Deauthorize/Remove ONU
   * @param {Object} olt - OLT document
   * @param {number} ponPort - PON port number
   * @param {number} onuId - ONU ID
   * @returns {Promise<Object>} { success, error? }
   */
  async deauthorizeOnu(olt, ponPort, onuId) {
    throw new Error('deauthorizeOnu() must be implemented by vendor-specific class');
  }

  /**
   * Reboot ONU
   * @param {Object} olt - OLT document
   * @param {number} ponPort - PON port number
   * @param {number} onuId - ONU ID
   * @returns {Promise<Object>} { success, error? }
   */
  async rebootOnu(olt, ponPort, onuId) {
    throw new Error('rebootOnu() must be implemented by vendor-specific class');
  }

  /**
   * Get ONU optical power levels
   * @param {Object} olt - OLT document
   * @param {number} ponPort - PON port number
   * @param {number} onuId - ONU ID
   * @returns {Promise<Object>} { success, rxPower?, txPower?, error? }
   */
  async getOnuOpticalPower(olt, ponPort, onuId) {
    throw new Error('getOnuOpticalPower() must be implemented by vendor-specific class');
  }

  /**
   * Get unconfigured ONUs (discovered but not authorized)
   * @param {Object} olt - OLT document
   * @returns {Promise<Object>} { success, onus: [], error? }
   */
  async getUnconfiguredOnus(olt) {
    throw new Error('getUnconfiguredOnus() must be implemented by vendor-specific class');
  }

  /**
   * Set ONU VLAN configuration
   * @param {Object} olt - OLT document
   * @param {number} ponPort - PON port number
   * @param {number} onuId - ONU ID
   * @param {number} vlanId - VLAN ID
   * @returns {Promise<Object>} { success, error? }
   */
  async setOnuVlan(olt, ponPort, onuId, vlanId) {
    throw new Error('setOnuVlan() must be implemented by vendor-specific class');
  }

  /**
   * Set ONU bandwidth profile
   * @param {Object} olt - OLT document
   * @param {number} ponPort - PON port number
   * @param {number} onuId - ONU ID
   * @param {Object} profile - { upstreamMbps, downstreamMbps }
   * @returns {Promise<Object>} { success, error? }
   */
  async setOnuBandwidth(olt, ponPort, onuId, profile) {
    throw new Error('setOnuBandwidth() must be implemented by vendor-specific class');
  }

  /**
   * Get ONU statistics
   * @param {Object} olt - OLT document
   * @param {number} ponPort - PON port number
   * @param {number} onuId - ONU ID
   * @returns {Promise<Object>} { success, stats?, error? }
   */
  async getOnuStatistics(olt, ponPort, onuId) {
    throw new Error('getOnuStatistics() must be implemented by vendor-specific class');
  }

  /**
   * Helper: Normalize ONU data from vendor-specific format to standard format
   * @protected
   */
  _normalizeOnuData(vendorData) {
    // Override in vendor-specific classes
    return vendorData;
  }

  /**
   * Helper: Validate OLT connection parameters
   * @protected
   */
  _validateOltConfig(olt) {
    if (!olt.ip) {
      throw new Error('OLT IP address is required');
    }
    if (!olt.username) {
      throw new Error('OLT username is required');
    }
    if (!olt.password) {
      throw new Error('OLT password is required');
    }
    if (!olt.brand) {
      throw new Error('OLT brand is required');
    }
  }

  /**
   * Helper: Log operation
   * @protected
   */
  _log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logData = { timestamp, level, message, ...data };
    
    if (level === 'error') {
      console.error(`❌ [${timestamp}] ${message}`, data);
    } else if (level === 'warn') {
      console.warn(`⚠️  [${timestamp}] ${message}`, data);
    } else {
      console.log(`ℹ️  [${timestamp}] ${message}`, data);
    }
  }
}

module.exports = BaseOLTService;