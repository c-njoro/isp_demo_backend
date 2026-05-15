const BaseOLTService = require('./base');
const { Client } = require('ssh2');

/**
 * Huawei OLT Service
 * 
 * Implements BaseOLTService for Huawei OLTs (MA5608T, MA5800, etc.)
 * Uses SSH/Telnet for communication
 */
class HuaweiOLTService extends BaseOLTService {
  constructor() {
    super();
    this.vendor = 'huawei';
  }

  /**
   * Get SSH connection to Huawei OLT
   * @private
   */
  async _getConnection(olt) {
    return new Promise((resolve, reject) => {
      this._validateOltConfig(olt);

      const conn = new Client();
      let authenticated = false;

      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error('Connection timeout'));
      }, this.connectionTimeout);

      conn.on('ready', () => {
        clearTimeout(timeout);
        authenticated = true;
        this._log('info', `Connected to Huawei OLT: ${olt.name} (${olt.ip})`);
        resolve(conn);
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        this._log('error', `Connection error: ${err.message}`, { olt: olt.name });
        reject(new Error(`SSH connection error: ${err.message}`));
      });

      conn.connect({
        host: olt.ip,
        port: olt.port || 22,
        username: olt.username,
        password: olt.password,
        readyTimeout: this.connectionTimeout
      });
    });
  }

  /**
   * Execute command on Huawei OLT
   * @private
   */
  async _executeCommand(conn, command) {
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      conn.shell((err, stream) => {
        if (err) return reject(err);

        const timeout = setTimeout(() => {
          stream.end();
          reject(new Error('Command execution timeout'));
        }, this.connectionTimeout);

        stream.on('close', () => {
          clearTimeout(timeout);
          if (errorOutput) {
            reject(new Error(errorOutput));
          } else {
            resolve(output);
          }
        });

        stream.on('data', (data) => {
          output += data.toString();
        });

        stream.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        // Send command
        stream.write(command + '\n');
        
        // Wait for output then close
        setTimeout(() => {
          stream.end();
        }, 2000);
      });
    });
  }

  /**
   * Test connection to Huawei OLT
   */
  async testConnection(olt) {
    let conn = null;
    try {
      this._log('info', `Testing connection to Huawei OLT: ${olt.name}`);
      
      conn = await this._getConnection(olt);
      
      // Execute a simple command to verify
      const output = await this._executeCommand(conn, 'display version');
      
      conn.end();

      // Extract version from output
      const versionMatch = output.match(/VERSION\s*:\s*(.+)/i);
      const version = versionMatch ? versionMatch[1].trim() : 'unknown';

      return {
        success: true,
        version,
        vendor: 'huawei',
        message: `Successfully connected to ${olt.name}`
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Connection test failed: ${error.message}`, { olt: olt.name });
      
      return {
        success: false,
        error: error.message,
        message: `Failed to connect to ${olt.name}`
      };
    }
  }

  /**
   * Get system information
   */
  async getSystemInfo(olt) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const versionOutput = await this._executeCommand(conn, 'display version');
      const boardOutput = await this._executeCommand(conn, 'display board 0');
      
      conn.end();

      return {
        success: true,
        data: {
          version: versionOutput,
          boards: boardOutput
        }
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to get system info: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get PON ports status
   */
  async getPonPorts(olt) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const output = await this._executeCommand(conn, 'display board 0');
      
      conn.end();

      // Parse PON ports from output
      // Huawei format varies by model, this is a basic parser
      const ports = [];
      const lines = output.split('\n');
      
      for (const line of lines) {
        if (line.includes('GPON') || line.includes('EPON')) {
          const portMatch = line.match(/(\d+\/\d+\/\d+)/);
          if (portMatch) {
            ports.push({
              port: portMatch[1],
              status: line.includes('Normal') ? 'online' : 'offline',
              type: line.includes('GPON') ? 'gpon' : 'epon'
            });
          }
        }
      }

      return {
        success: true,
        ports
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to get PON ports: ${error.message}`);
      return {
        success: false,
        error: error.message,
        ports: []
      };
    }
  }

  /**
   * Get ONUs on specific PON port
   */
  async getOnusOnPort(olt, ponPort) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      // Huawei command format: display ont info 0/1/0 all
      const frame = 0;
      const slot = Math.floor(ponPort / olt.ponPorts);
      const port = ponPort % olt.ponPorts;
      
      const output = await this._executeCommand(
        conn, 
        `display ont info ${frame}/${slot}/${port} all`
      );
      
      conn.end();

      // Parse ONUs from output
      const onus = this._parseHuaweiOnuList(output, ponPort);

      return {
        success: true,
        onus
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to get ONUs on port ${ponPort}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        onus: []
      };
    }
  }

  /**
   * Get all ONUs across all ports
   */
  async getAllOnus(olt) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const allOnus = [];
      
      // Query each PON port
      for (let port = 0; port < (olt.ponPorts || 16); port++) {
        const frame = 0;
        const slot = Math.floor(port / olt.ponPorts);
        const portNum = port % olt.ponPorts;
        
        try {
          const output = await this._executeCommand(
            conn,
            `display ont info ${frame}/${slot}/${portNum} all`
          );
          
          const onus = this._parseHuaweiOnuList(output, port);
          allOnus.push(...onus);
        } catch (err) {
          this._log('warn', `Failed to get ONUs on port ${port}: ${err.message}`);
        }
      }
      
      conn.end();

      return {
        success: true,
        onus: allOnus
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to get all ONUs: ${error.message}`);
      return {
        success: false,
        error: error.message,
        onus: []
      };
    }
  }

  /**
   * Get specific ONU details
   */
  async getOnuDetails(olt, ponPort, onuId) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const frame = 0;
      const slot = Math.floor(ponPort / olt.ponPorts);
      const port = ponPort % olt.ponPorts;
      
      const output = await this._executeCommand(
        conn,
        `display ont info ${frame}/${slot}/${port} ${onuId}`
      );
      
      conn.end();

      // Parse ONU details
      const details = this._parseHuaweiOnuDetails(output);

      return {
        success: true,
        data: details
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to get ONU details: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Authorize ONU
   */
  async authorizeOnu(olt, serialNumber, ponPort, onuId) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const frame = 0;
      const slot = Math.floor(ponPort / olt.ponPorts);
      const port = ponPort % olt.ponPorts;
      
      // Huawei command to authorize ONU
      const commands = [
        'config',
        `interface gpon ${frame}/${slot}`,
        `ont add ${port} ${onuId} sn-auth ${serialNumber} omci ont-lineprofile-id 1 ont-srvprofile-id 1`,
        'quit',
        'quit'
      ];
      
      for (const cmd of commands) {
        await this._executeCommand(conn, cmd);
      }
      
      conn.end();

      return {
        success: true,
        data: {
          ponPort,
          onuId,
          serialNumber
        }
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to authorize ONU: ${error.message}`);
      throw new Error(`Failed to authorize ONU: ${error.message}`);
    }
  }

  /**
   * Deauthorize ONU
   */
  async deauthorizeOnu(olt, ponPort, onuId) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const frame = 0;
      const slot = Math.floor(ponPort / olt.ponPorts);
      const port = ponPort % olt.ponPorts;
      
      const commands = [
        'config',
        `interface gpon ${frame}/${slot}`,
        `ont delete ${port} ${onuId}`,
        'quit',
        'quit'
      ];
      
      for (const cmd of commands) {
        await this._executeCommand(conn, cmd);
      }
      
      conn.end();

      return {
        success: true
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to deauthorize ONU: ${error.message}`);
      throw new Error(`Failed to deauthorize ONU: ${error.message}`);
    }
  }

  /**
   * Reboot ONU
   */
  async rebootOnu(olt, ponPort, onuId) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const frame = 0;
      const slot = Math.floor(ponPort / olt.ponPorts);
      const port = ponPort % olt.ponPorts;
      
      await this._executeCommand(
        conn,
        `ont reset ${frame}/${slot}/${port} ${onuId}`
      );
      
      conn.end();

      return {
        success: true
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to reboot ONU: ${error.message}`);
      throw new Error(`Failed to reboot ONU: ${error.message}`);
    }
  }

  /**
   * Get ONU optical power
   */
  async getOnuOpticalPower(olt, ponPort, onuId) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const frame = 0;
      const slot = Math.floor(ponPort / olt.ponPorts);
      const port = ponPort % olt.ponPorts;
      
      const output = await this._executeCommand(
        conn,
        `display ont optical-info ${frame}/${slot}/${port} ${onuId}`
      );
      
      conn.end();

      // Parse optical power values
      const rxMatch = output.match(/RX\s+power.*?:\s*(-?\d+\.?\d*)/i);
      const txMatch = output.match(/TX\s+power.*?:\s*(-?\d+\.?\d*)/i);

      return {
        success: true,
        rxPower: rxMatch ? parseFloat(rxMatch[1]) : null,
        txPower: txMatch ? parseFloat(txMatch[1]) : null
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to get optical power: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get unconfigured ONUs
   */
  async getUnconfiguredOnus(olt) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const output = await this._executeCommand(conn, 'display ont autofind all');
      
      conn.end();

      // Parse unconfigured ONUs
      const onus = this._parseHuaweiAutofind(output);

      return {
        success: true,
        onus
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to get unconfigured ONUs: ${error.message}`);
      return {
        success: false,
        error: error.message,
        onus: []
      };
    }
  }

  /**
   * Provision ONU (full configuration)
   */
  async provisionOnu(olt, config) {
    const {
      serialNumber,
      ponPort,
      onuId,
      vlanId,
      profileName,
      description
    } = config;

    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const frame = 0;
      const slot = Math.floor(ponPort / olt.ponPorts);
      const port = ponPort % olt.ponPorts;
      
      const commands = [
        'config',
        `interface gpon ${frame}/${slot}`,
        `ont add ${port} ${onuId} sn-auth ${serialNumber} omci ont-lineprofile-id 1 ont-srvprofile-id 1 desc ${description || 'Customer'}`,
        'quit',
        'quit'
      ];
      
      for (const cmd of commands) {
        await this._executeCommand(conn, cmd);
      }
      
      conn.end();

      return {
        success: true,
        data: config
      };
    } catch (error) {
      if (conn) conn.end();
      
      this._log('error', `Failed to provision ONU: ${error.message}`);
      throw new Error(`Failed to provision ONU: ${error.message}`);
    }
  }

  /**
   * Set ONU VLAN
   */
  async setOnuVlan(olt, ponPort, onuId, vlanId) {
    // Huawei VLAN configuration is complex and model-dependent
    // This is a simplified implementation
    this._log('warn', 'setOnuVlan not fully implemented for Huawei');
    return {
      success: false,
      error: 'VLAN configuration not yet implemented for Huawei OLTs'
    };
  }

  /**
   * Set ONU bandwidth
   */
  async setOnuBandwidth(olt, ponPort, onuId, profile) {
    // Huawei bandwidth profiles are configured separately
    this._log('warn', 'setOnuBandwidth not fully implemented for Huawei');
    return {
      success: false,
      error: 'Bandwidth configuration not yet implemented for Huawei OLTs'
    };
  }

  /**
   * Get ONU statistics
   */
  async getOnuStatistics(olt, ponPort, onuId) {
    this._log('warn', 'getOnuStatistics not fully implemented for Huawei');
    return {
      success: false,
      error: 'Statistics retrieval not yet implemented for Huawei OLTs'
    };
  }

  /**
   * Parse Huawei ONU list output
   * @private
   */
  _parseHuaweiOnuList(output, ponPort) {
    const onus = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      // Basic parser - adjust based on actual Huawei output format
      if (line.trim() && !line.includes('----') && !line.includes('ONT-ID')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          onus.push({
            ponPort,
            onuId: parseInt(parts[0]) || 0,
            serialNumber: parts[1] || '',
            status: parts[2] || 'unknown',
            description: parts[3] || ''
          });
        }
      }
    }
    
    return onus;
  }

  /**
   * Parse Huawei ONU details
   * @private
   */
  _parseHuaweiOnuDetails(output) {
    // Basic parser - expand based on needs
    return {
      raw: output,
      parsed: {} // Add specific field parsing as needed
    };
  }

  /**
   * Parse Huawei autofind output
   * @private
   */
  _parseHuaweiAutofind(output) {
    const onus = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes('HWTC') || line.includes('ALCL') || line.includes('ZTEG')) {
        const serialMatch = line.match(/([A-Z]{4}[A-F0-9]{8})/);
        const portMatch = line.match(/(\d+\/\d+\/\d+)/);
        
        if (serialMatch && portMatch) {
          onus.push({
            serialNumber: serialMatch[1],
            ponPort: portMatch[1],
            discovered: true
          });
        }
      }
    }
    
    return onus;
  }
}

module.exports = HuaweiOLTService;