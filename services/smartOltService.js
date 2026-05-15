const axios = require('axios');

/**
 * SmartOLT Service
 * Handles all communication with SmartOLT devices via REST API
 * 
 * SmartOLT API Documentation:
 * Base URL: http://{olt-ip}:{port}/api
 * Authentication: Basic Auth (username/password)
 * 
 * Common Endpoints:
 * - GET  /system/info       - Get OLT system information
 * - GET  /onus              - Get all ONUs
 * - GET  /onu/{port}/{id}   - Get specific ONU
 * - POST /onu/provision     - Provision new ONU
 * - POST /onu/enable        - Enable ONU
 * - POST /onu/disable       - Disable ONU
 */

class SmartOltService {
  
  /**
   * Create axios client for OLT
   * @param {Object} olt - OLT document from database
   * @returns {AxiosInstance}
   */
  getClient(olt) {
    const protocol = olt.useSSL ? 'https' : 'http';
    const baseURL = `${protocol}://${olt.ip}:${olt.port}/api`;
    
    return axios.create({
      baseURL,
      auth: {
        username: olt.username,
        password: olt.password
      },
      timeout: parseInt(process.env.OLT_TIMEOUT) || 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }
  
  // ============================================
  // CONNECTION & SYSTEM INFO
  // ============================================
  
  /**
   * Test connection to OLT
   * @param {Object} olt - OLT document
   * @returns {Promise<Object>}
   */
  async testConnection(olt) {
    try {
      console.log(`🔍 Testing connection to OLT: ${olt.name} (${olt.ip})`);
      
      const client = this.getClient(olt);
      const startTime = Date.now();
      
      const response = await client.get('/system/info');
      const responseTime = Date.now() - startTime;
      
      console.log(`✅ OLT ${olt.name} responded in ${responseTime}ms`);
      
      return {
        success: true,
        responseTime: `${responseTime}ms`,
        data: response.data,
        message: 'Connection successful'
      };
    } catch (error) {
      console.error(`❌ OLT ${olt.name} connection failed:`, error.message);
      
      return {
        success: false,
        error: error.message,
        code: error.code,
        message: 'Connection failed'
      };
    }
  }
  
  /**
   * Get OLT system information
   * @param {Object} olt - OLT document
   * @returns {Promise<Object>}
   */
  async getSystemInfo(olt) {
    try {
      const client = this.getClient(olt);
      const response = await client.get('/system/info');
      
      return {
        success: true,
        data: {
          model: response.data.model,
          serialNumber: response.data.serialNumber,
          firmwareVersion: response.data.firmwareVersion,
          uptime: response.data.uptime,
          temperature: response.data.temperature,
          ponPorts: response.data.ponPorts
        }
      };
    } catch (error) {
      console.error('Get system info error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get OLT statistics
   * @param {Object} olt - OLT document
   * @returns {Promise<Object>}
   */
  async getOltStats(olt) {
    try {
      const client = this.getClient(olt);
      const response = await client.get('/system/stats');
      
      return {
        success: true,
        stats: {
          totalOnus: response.data.totalOnus || 0,
          onlineOnus: response.data.onlineOnus || 0,
          offlineOnus: response.data.offlineOnus || 0,
          temperature: response.data.temperature,
          uptime: response.data.uptime,
          cpuUsage: response.data.cpuUsage,
          memoryUsage: response.data.memoryUsage
        }
      };
    } catch (error) {
      console.error('Get OLT stats error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // ============================================
  // ONU MANAGEMENT
  // ============================================
  
  /**
   * Get all ONUs on OLT
   * @param {Object} olt - OLT document
   * @param {Object} filters - Optional filters (status, port, etc.)
   * @returns {Promise<Object>}
   */
  async getOnus(olt, filters = {}) {
    try {
      console.log(`📡 Fetching ONUs from OLT: ${olt.name}`);
      
      const client = this.getClient(olt);
      const params = {};
      
      if (filters.status) params.status = filters.status;
      if (filters.port) params.port = filters.port;
      
      const response = await client.get('/onus', { params });
      
      console.log(`✅ Found ${response.data.length} ONUs on ${olt.name}`);
      
      return {
        success: true,
        count: response.data.length,
        onus: response.data.map(onu => ({
          id: onu.id,
          serialNumber: onu.serialNumber,
          macAddress: onu.macAddress,
          ponPort: onu.ponPort,
          onuId: onu.onuId,
          status: onu.status,
          rxPower: onu.rxPower,
          txPower: onu.txPower,
          distance: onu.distance,
          uptime: onu.uptime,
          model: onu.model,
          version: onu.version
        }))
      };
    } catch (error) {
      console.error('Get ONUs error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get specific ONU status
   * @param {Object} olt - OLT document
   * @param {String} ponPort - PON port (e.g., "1/1/1")
   * @param {Number} onuId - ONU ID
   * @returns {Promise<Object>}
   */
  async getOnuStatus(olt, ponPort, onuId) {
    try {
      console.log(`🔍 Getting status for ONU ${ponPort}/${onuId} on ${olt.name}`);
      
      const client = this.getClient(olt);
      const response = await client.get(`/onu/${ponPort}/${onuId}`);
      
      return {
        success: true,
        data: {
          serialNumber: response.data.serialNumber,
          status: response.data.status,
          authStatus: response.data.authStatus,
          rxPower: response.data.rxPower,
          txPower: response.data.txPower,
          distance: response.data.distance,
          temperature: response.data.temperature,
          voltage: response.data.voltage,
          uptime: response.data.uptime,
          lastSeen: response.data.lastSeen,
          model: response.data.model,
          version: response.data.version
        }
      };
    } catch (error) {
      console.error('Get ONU status error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get ONU by serial number
   * @param {Object} olt - OLT document
   * @param {String} serialNumber - ONU serial number
   * @returns {Promise<Object>}
   */
  async getOnuBySerial(olt, serialNumber) {
    try {
      const client = this.getClient(olt);
      const response = await client.get(`/onu/serial/${serialNumber.toUpperCase()}`);
      
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return {
          success: false,
          error: 'ONU not found',
          notFound: true
        };
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // ============================================
  // ONU PROVISIONING
  // ============================================
  
  /**
   * Provision new ONU on OLT
   * @param {Object} olt - OLT document
   * @param {Object} config - ONU configuration
   * @returns {Promise<Object>}
   */
  async provisionOnu(olt, config) {
    try {
      console.log(`📡 Provisioning ONU ${config.serialNumber} on ${olt.name}`);
      
      // Validate config
      if (!config.serialNumber) {
        throw new Error('Serial number is required');
      }
      if (!config.ponPort) {
        throw new Error('PON port is required');
      }
      if (!config.vlan) {
        throw new Error('VLAN is required');
      }
      
      const client = this.getClient(olt);
      
      const payload = {
        serialNumber: config.serialNumber.toUpperCase(),
        ponPort: config.ponPort,
        vlan: config.vlan,
        serviceProfile: config.serviceProfile || 'default',
        lineProfile: config.lineProfile || 'default',
        bandwidth: {
          upload: config.uploadSpeed || 100,
          download: config.downloadSpeed || 100
        },
        description: config.description || '',
        authorize: config.authorize !== false // Auto-authorize by default
      };
      
      const response = await client.post('/onu/provision', payload);
      
      console.log(`✅ ONU ${config.serialNumber} provisioned successfully`);
      
      return {
        success: true,
        data: {
          onuId: response.data.onuId,
          ponPort: response.data.ponPort,
          serialNumber: response.data.serialNumber,
          status: response.data.status,
          message: 'ONU provisioned successfully'
        }
      };
    } catch (error) {
      console.error('Provision ONU error:', error.message);
      
      // Parse error message for specific issues
      let errorMessage = error.message;
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }
      
      return {
        success: false,
        error: errorMessage,
        code: error.response?.status
      };
    }
  }
  
  /**
   * Authorize ONU
   * @param {Object} olt - OLT document
   * @param {String} ponPort - PON port
   * @param {Number} onuId - ONU ID
   * @returns {Promise<Object>}
   */
  async authorizeOnu(olt, ponPort, onuId) {
    try {
      console.log(`✓ Authorizing ONU ${ponPort}/${onuId} on ${olt.name}`);
      
      const client = this.getClient(olt);
      await client.post(`/onu/${ponPort}/${onuId}/authorize`);
      
      return {
        success: true,
        message: 'ONU authorized'
      };
    } catch (error) {
      console.error('Authorize ONU error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Unauthorize ONU
   * @param {Object} olt - OLT document
   * @param {String} ponPort - PON port
   * @param {Number} onuId - ONU ID
   * @returns {Promise<Object>}
   */
  async unauthorizeOnu(olt, ponPort, onuId) {
    try {
      console.log(`✗ Unauthorizing ONU ${ponPort}/${onuId} on ${olt.name}`);
      
      const client = this.getClient(olt);
      await client.post(`/onu/${ponPort}/${onuId}/unauthorize`);
      
      return {
        success: true,
        message: 'ONU unauthorized'
      };
    } catch (error) {
      console.error('Unauthorize ONU error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Delete/Remove ONU from OLT
   * @param {Object} olt - OLT document
   * @param {String} ponPort - PON port
   * @param {Number} onuId - ONU ID
   * @returns {Promise<Object>}
   */
  async deleteOnu(olt, ponPort, onuId) {
    try {
      console.log(`🗑️ Deleting ONU ${ponPort}/${onuId} from ${olt.name}`);
      
      const client = this.getClient(olt);
      await client.delete(`/onu/${ponPort}/${onuId}`);
      
      return {
        success: true,
        message: 'ONU deleted from OLT'
      };
    } catch (error) {
      console.error('Delete ONU error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // ============================================
  // ONU CONTROL
  // ============================================
  
  /**
   * Enable ONU
   * @param {Object} olt - OLT document
   * @param {String} ponPort - PON port
   * @param {Number} onuId - ONU ID
   * @returns {Promise<Object>}
   */
  async enableOnu(olt, ponPort, onuId) {
    try {
      console.log(`🟢 Enabling ONU ${ponPort}/${onuId} on ${olt.name}`);
      
      const client = this.getClient(olt);
      await client.post(`/onu/${ponPort}/${onuId}/enable`);
      
      return {
        success: true,
        message: 'ONU enabled'
      };
    } catch (error) {
      console.error('Enable ONU error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Disable ONU
   * @param {Object} olt - OLT document
   * @param {String} ponPort - PON port
   * @param {Number} onuId - ONU ID
   * @returns {Promise<Object>}
   */
  async disableOnu(olt, ponPort, onuId) {
    try {
      console.log(`🔴 Disabling ONU ${ponPort}/${onuId} on ${olt.name}`);
      
      const client = this.getClient(olt);
      await client.post(`/onu/${ponPort}/${onuId}/disable`);
      
      return {
        success: true,
        message: 'ONU disabled'
      };
    } catch (error) {
      console.error('Disable ONU error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Reboot ONU
   * @param {Object} olt - OLT document
   * @param {String} ponPort - PON port
   * @param {Number} onuId - ONU ID
   * @returns {Promise<Object>}
   */
  async rebootOnu(olt, ponPort, onuId) {
    try {
      console.log(`🔄 Rebooting ONU ${ponPort}/${onuId} on ${olt.name}`);
      
      const client = this.getClient(olt);
      await client.post(`/onu/${ponPort}/${onuId}/reboot`);
      
      return {
        success: true,
        message: 'ONU reboot initiated'
      };
    } catch (error) {
      console.error('Reboot ONU error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // ============================================
  // BANDWIDTH MANAGEMENT
  // ============================================
  
  /**
   * Update ONU bandwidth
   * @param {Object} olt - OLT document
   * @param {String} ponPort - PON port
   * @param {Number} onuId - ONU ID
   * @param {Number} uploadSpeed - Upload speed in Mbps
   * @param {Number} downloadSpeed - Download speed in Mbps
   * @returns {Promise<Object>}
   */
  async updateOnuBandwidth(olt, ponPort, onuId, uploadSpeed, downloadSpeed) {
    try {
      console.log(`⚡ Updating bandwidth for ONU ${ponPort}/${onuId}: ${downloadSpeed}/${uploadSpeed} Mbps`);
      
      const client = this.getClient(olt);
      await client.put(`/onu/${ponPort}/${onuId}/bandwidth`, {
        upload: uploadSpeed,
        download: downloadSpeed
      });
      
      return {
        success: true,
        message: 'Bandwidth updated'
      };
    } catch (error) {
      console.error('Update bandwidth error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // ============================================
  // PORT MANAGEMENT
  // ============================================
  
  /**
   * Find available PON port
   * @param {Object} olt - OLT document
   * @returns {Promise<Object>}
   */
  async findAvailablePort(olt) {
    try {
      console.log(`🔍 Finding available port on ${olt.name}`);
      
      const client = this.getClient(olt);
      const response = await client.get('/ports/available');
      
      if (!response.data.port) {
        return {
          success: false,
          error: 'No available ports'
        };
      }
      
      console.log(`✅ Found available port: ${response.data.port}`);
      
      return {
        success: true,
        port: response.data.port,
        availableSlots: response.data.availableSlots
      };
    } catch (error) {
      console.error('Find available port error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get PON port statistics
   * @param {Object} olt - OLT document
   * @param {String} ponPort - PON port
   * @returns {Promise<Object>}
   */
  async getPortStats(olt, ponPort) {
    try {
      const client = this.getClient(olt);
      const response = await client.get(`/port/${ponPort}/stats`);
      
      return {
        success: true,
        data: {
          port: ponPort,
          totalOnus: response.data.totalOnus,
          onlineOnus: response.data.onlineOnus,
          offlineOnus: response.data.offlineOnus,
          rxPower: response.data.rxPower,
          txPower: response.data.txPower,
          temperature: response.data.temperature
        }
      };
    } catch (error) {
      console.error('Get port stats error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // ============================================
  // BULK OPERATIONS
  // ============================================
  
  /**
   * Sync all ONUs from OLT to database
   * @param {Object} olt - OLT document
   * @returns {Promise<Object>}
   */
  async syncOnus(olt) {
    try {
      console.log(`🔄 Syncing ONUs from ${olt.name}`);
      
      const result = await this.getOnus(olt);
      
      if (!result.success) {
        return result;
      }
      
      return {
        success: true,
        synced: result.count,
        onus: result.onus
      };
    } catch (error) {
      console.error('Sync ONUs error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // ============================================
  // UTILITIES
  // ============================================
  
  /**
   * Parse signal strength value
   * @param {String} signalStr - Signal string (e.g., "-18.5 dBm")
   * @returns {Number} - Numeric value
   */
  parseSignalStrength(signalStr) {
    if (!signalStr) return null;
    const match = signalStr.match(/-?\d+\.?\d*/);
    return match ? parseFloat(match[0]) : null;
  }
  
  /**
   * Check if signal is weak
   * @param {String} rxPower - RX power (e.g., "-18.5 dBm")
   * @returns {Boolean}
   */
  isSignalWeak(rxPower) {
    const value = this.parseSignalStrength(rxPower);
    if (value === null) return false;
    return value < -27; // Typical threshold
  }
  
  /**
   * Parse distance value
   * @param {String} distanceStr - Distance string (e.g., "2.4 km")
   * @returns {Number} - Distance in meters
   */
  parseDistance(distanceStr) {
    if (!distanceStr) return null;
    const match = distanceStr.match(/(\d+\.?\d*)\s*(km|m)/i);
    if (!match) return null;
    
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    
    return unit === 'km' ? value * 1000 : value;
  }
}

module.exports = new SmartOltService();