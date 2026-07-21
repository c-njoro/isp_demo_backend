const BaseOLTService = require('./base');
const { Telnet } = require('telnet-client');

/**
 * ZTE OLT Service
 * 
 * Implements BaseOLTService for ZTE OLTs (C300, C320, C600, etc.)
 * Uses SSH/Telnet for communication
 */
class ZTEOLTService extends BaseOLTService {
  constructor() {
    super();
    this.vendor = 'zte';
  }

  /**
   * Get telnet connection to ZTE OLT.
   *
   * CHANGED FROM ORIGINAL: this fleet's OLTs only have telnet confirmed
   * working — SSH was never verified, so this switched from ssh2 to
   * telnet-client. Login/shell prompt regexes below are UNVERIFIED
   * against a real ZTE device (we've only confirmed these against the
   * Huawei MA5683T so far) — adjust once tested against real ZTE output.
   * @private
   */
  async _getConnection(olt) {
    this._validateOltConfig(olt);

    const connection = new Telnet();

    const params = {
      host: olt.ip,
      port: olt.port || 23, // ZTE often uses Telnet (23)
      timeout: this.connectionTimeout,
      // UNVERIFIED prompt patterns for ZTE — these are a reasonable guess
      // based on common ZTE C300/C320 CLI conventions, NOT confirmed
      // against a real device the way the Huawei prompts were.
      shellPrompt: /[#>]\s*$/,
      loginPrompt: /[Uu]sername\s*:?\s*$/,
      passwordPrompt: /[Pp]assword\s*:?\s*$/,
      username: olt.username,
      password: olt.password,
      negotiationMandatory: false,
      execTimeout: this.connectionTimeout,
      sendTimeout: this.connectionTimeout
    };

    try {
      await connection.connect(params);
      this._log('info', `Connected to ZTE OLT via telnet: ${olt.name} (${olt.ip})`);
      return connection;
    } catch (err) {
      throw new Error(`Telnet connection error: ${err.message}`);
    }
  }

  /**
   * Run a single command against an open telnet session.
   * @private
   */
  async _executeCommand(conn, command) {
    try {
      return await conn.exec(command);
    } catch (err) {
      throw new Error(`Command "${command}" failed: ${err.message}`);
    }
  }

  /**
   * Run a sequence of commands against ONE open session, in order.
   *
   * NOTE ON A BUG THIS FIXES: the original code looped
   * `for (const cmd of commands) { await this._executeCommand(conn, cmd) }`
   * directly — that part was fine. This helper exists so every call site
   * is consistent and explicit about needing one continuous session,
   * matching the pattern used in huawei.js. No behavior change for ZTE's
   * multi-command methods, just a shared, named helper instead of an
   * inline loop repeated at each call site.
   * @private
   */
  async _executeSequence(conn, commands) {
    const outputs = [];
    for (const cmd of commands) {
      outputs.push(await this._executeCommand(conn, cmd));
    }
    return outputs;
  }

  /**
   * Test connection to ZTE OLT
   */
  async testConnection(olt) {
    let conn = null;
    try {
      this._log('info', `Testing connection to ZTE OLT: ${olt.name}`);
      
      conn = await this._getConnection(olt);
      
      // Execute a simple command to verify
      const output = await this._executeCommand(conn, 'show version');
      
      await conn.end();

      // Extract version from output
      const versionMatch = output.match(/Software\s+Version\s*:\s*(.+)/i) || 
                          output.match(/Version\s*:\s*(.+)/i);
      const version = versionMatch ? versionMatch[1].trim() : 'unknown';

      return {
        success: true,
        version,
        vendor: 'zte',
        message: `Successfully connected to ${olt.name}`
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
      
      const versionOutput = await this._executeCommand(conn, 'show version');
      const cardOutput = await this._executeCommand(conn, 'show card');
      
      await conn.end();

      return {
        success: true,
        data: {
          version: versionOutput,
          cards: cardOutput
        }
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
      
      const output = await this._executeCommand(conn, 'show gpon olt');
      
      await conn.end();

      // Parse PON ports from output
      const ports = [];
      const lines = output.split('\n');
      
      for (const line of lines) {
        if (line.includes('gpon-olt')) {
          const portMatch = line.match(/gpon-olt_(\d+\/\d+\/\d+)/);
          if (portMatch) {
            ports.push({
              port: portMatch[1],
              status: line.includes('up') || line.includes('active') ? 'online' : 'offline',
              type: 'gpon'
            });
          }
        }
      }

      return {
        success: true,
        ports
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
      
      // ZTE command format: show gpon onu state gpon-olt_1/1/1
      const rack = 1;
      const shelf = 1;
      const slot = Math.floor(ponPort / 16) + 1;
      const port = (ponPort % 16) + 1;
      
      const output = await this._executeCommand(
        conn,
        `show gpon onu state gpon-olt_${rack}/${shelf}/${slot}/${port}`
      );
      
      await conn.end();

      // Parse ONUs from output
      const onus = this._parseZTEOnuList(output, ponPort);

      return {
        success: true,
        onus
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
        const rack = 1;
        const shelf = 1;
        const slot = Math.floor(port / 16) + 1;
        const portNum = (port % 16) + 1;
        
        try {
          const output = await this._executeCommand(
            conn,
            `show gpon onu state gpon-olt_${rack}/${shelf}/${slot}/${portNum}`
          );
          
          const onus = this._parseZTEOnuList(output, port);
          allOnus.push(...onus);
        } catch (err) {
          this._log('warn', `Failed to get ONUs on port ${port}: ${err.message}`);
        }
      }
      
      await conn.end();

      return {
        success: true,
        onus: allOnus
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
      
      const rack = 1;
      const shelf = 1;
      const slot = Math.floor(ponPort / 16) + 1;
      const port = (ponPort % 16) + 1;
      
      const output = await this._executeCommand(
        conn,
        `show gpon onu detail-info gpon-onu_${rack}/${shelf}/${slot}/${port}:${onuId}`
      );
      
      await conn.end();

      // Parse ONU details
      const details = this._parseZTEOnuDetails(output);

      return {
        success: true,
        data: details
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
      
      const rack = 1;
      const shelf = 1;
      const slot = Math.floor(ponPort / 16) + 1;
      const port = (ponPort % 16) + 1;
      
      // ZTE command to authorize ONU
      const commands = [
        'configure terminal',
        `interface gpon-olt_${rack}/${shelf}/${slot}/${port}`,
        `onu ${onuId} type ZTE-F660 sn ${serialNumber}`,
        'exit',
        'exit'
      ];
      
      await this._executeSequence(conn, commands);
      
      await conn.end();

      return {
        success: true,
        data: {
          ponPort,
          onuId,
          serialNumber
        }
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
      
      const rack = 1;
      const shelf = 1;
      const slot = Math.floor(ponPort / 16) + 1;
      const port = (ponPort % 16) + 1;
      
      const commands = [
        'configure terminal',
        `interface gpon-olt_${rack}/${shelf}/${slot}/${port}`,
        `no onu ${onuId}`,
        'exit',
        'exit'
      ];
      
      await this._executeSequence(conn, commands);
      
      await conn.end();

      return {
        success: true
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
      
      const rack = 1;
      const shelf = 1;
      const slot = Math.floor(ponPort / 16) + 1;
      const port = (ponPort % 16) + 1;
      
      await this._executeCommand(
        conn,
        `pon-onu-mng gpon-onu_${rack}/${shelf}/${slot}/${port}:${onuId} reboot`
      );
      
      await conn.end();

      return {
        success: true
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
      
      const rack = 1;
      const shelf = 1;
      const slot = Math.floor(ponPort / 16) + 1;
      const port = (ponPort % 16) + 1;
      
      const output = await this._executeCommand(
        conn,
        `show pon power attenuation gpon-onu_${rack}/${shelf}/${slot}/${port}:${onuId}`
      );
      
      await conn.end();

      // Parse optical power values
      const rxMatch = output.match(/RX\s+power.*?:\s*(-?\d+\.?\d*)/i);
      const txMatch = output.match(/TX\s+power.*?:\s*(-?\d+\.?\d*)/i);

      return {
        success: true,
        rxPower: rxMatch ? parseFloat(rxMatch[1]) : null,
        txPower: txMatch ? parseFloat(txMatch[1]) : null
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
      
      const output = await this._executeCommand(conn, 'show gpon onu uncfg');
      
      await conn.end();

      // Parse unconfigured ONUs
      const onus = this._parseZTEUnconfigured(output);

      return {
        success: true,
        onus
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
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
      
      const rack = 1;
      const shelf = 1;
      const slot = Math.floor(ponPort / 16) + 1;
      const port = (ponPort % 16) + 1;
      
      const commands = [
        'configure terminal',
        `interface gpon-olt_${rack}/${shelf}/${slot}/${port}`,
        `onu ${onuId} type ZTE-F660 sn ${serialNumber}`,
        'exit',
        `pon-onu-mng gpon-onu_${rack}/${shelf}/${slot}/${port}:${onuId}`,
        `service internet type internet gemport 1 vlan ${vlanId || 100}`,
        description ? `name ${description}` : '',
        'exit',
        'exit'
      ].filter(cmd => cmd); // Remove empty commands
      
      await this._executeSequence(conn, commands);
      
      await conn.end();

      return {
        success: true,
        data: config
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
      this._log('error', `Failed to provision ONU: ${error.message}`);
      throw new Error(`Failed to provision ONU: ${error.message}`);
    }
  }

  /**
   * Set ONU VLAN
   */
  async setOnuVlan(olt, ponPort, onuId, vlanId) {
    let conn = null;
    try {
      conn = await this._getConnection(olt);
      
      const rack = 1;
      const shelf = 1;
      const slot = Math.floor(ponPort / 16) + 1;
      const port = (ponPort % 16) + 1;
      
      const commands = [
        'configure terminal',
        `pon-onu-mng gpon-onu_${rack}/${shelf}/${slot}/${port}:${onuId}`,
        `service internet vlan ${vlanId}`,
        'exit',
        'exit'
      ];
      
      await this._executeSequence(conn, commands);
      
      await conn.end();

      return {
        success: true
      };
    } catch (error) {
      if (conn) await conn.end().catch(() => {});
      
      this._log('error', `Failed to set VLAN: ${error.message}`);
      throw new Error(`Failed to set VLAN: ${error.message}`);
    }
  }

  /**
   * Set ONU bandwidth
   */
  async setOnuBandwidth(olt, ponPort, onuId, profile) {
    // ZTE bandwidth configuration
    this._log('warn', 'setOnuBandwidth not fully implemented for ZTE');
    return {
      success: false,
      error: 'Bandwidth configuration not yet implemented for ZTE OLTs'
    };
  }

  /**
   * Get ONU statistics
   */
  async getOnuStatistics(olt, ponPort, onuId) {
    this._log('warn', 'getOnuStatistics not fully implemented for ZTE');
    return {
      success: false,
      error: 'Statistics retrieval not yet implemented for ZTE OLTs'
    };
  }

  /**
   * Parse ZTE ONU list output
   * @private
   */
  _parseZTEOnuList(output, ponPort) {
    const onus = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      // Basic parser - adjust based on actual ZTE output format
      if (line.trim() && !line.includes('----') && !line.includes('OnuIndex')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const onuMatch = line.match(/gpon-onu_\d+\/\d+\/\d+\/\d+:(\d+)/);
          onus.push({
            ponPort,
            onuId: onuMatch ? parseInt(onuMatch[1]) : parseInt(parts[0]) || 0,
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
   * Parse ZTE ONU details
   * @private
   */
  _parseZTEOnuDetails(output) {
    // Basic parser - expand based on needs
    return {
      raw: output,
      parsed: {} // Add specific field parsing as needed
    };
  }

  /**
   * Parse ZTE unconfigured ONUs
   * @private
   */
  _parseZTEUnconfigured(output) {
    const onus = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes('ZTEG') || line.includes('HWTC')) {
        const serialMatch = line.match(/([A-Z]{4}[A-F0-9]{8})/);
        const portMatch = line.match(/gpon-olt_(\d+\/\d+\/\d+\/\d+)/);
        
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

module.exports = ZTEOLTService;