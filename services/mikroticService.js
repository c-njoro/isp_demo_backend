//USING SSH
// /**
//  * MikroTik Service using SSH (NOT RouterOS API)
//  * 
//  * This implementation uses standard SSH protocol instead of MikroTik's proprietary API.
//  * Works with all RouterOS versions and doesn't require API service to be enabled.
//  */


// const { Client } = require('ssh2');


// class MikrotikSSHService {
//   constructor() {
//     this.connectionTimeout = 10000;
//   }

//   /**
//    * Execute a command on MikroTik via SSH
//    */
//   async executeCommand(site, command) {
//     return new Promise((resolve, reject) => {
//       const conn = new Client();
//       let output = '';
//       let errorOutput = '';

//       const timeout = setTimeout(() => {
//         conn.end();
//         reject(new Error('SSH connection timeout'));
//       }, this.connectionTimeout);

//       conn.on('ready', () => {
//         console.log(`✅ SSH Connected to ${site.siteName}`);
        
//         conn.exec(command, (err, stream) => {
//           if (err) {
//             clearTimeout(timeout);
//             conn.end();
//             return reject(err);
//           }

//           stream.on('close', (code, signal) => {
//             clearTimeout(timeout);
//             conn.end();
            
//             if (code === 0) {
//               resolve(output);
//             } else {
//               reject(new Error(errorOutput || `Command failed with code ${code}`));
//             }
//           }).on('data', (data) => {
//             output += data.toString();
//           }).stderr.on('data', (data) => {
//             errorOutput += data.toString();
//           });
//         });
//       });

//       conn.on('error', (err) => {
//         clearTimeout(timeout);
//         reject(new Error(`SSH connection error: ${err.message}`));
//       });

//       conn.connect({
//         host: site.router.ip,
//         port: 22,
//         username: site.router.username,
//         password: site.router.password,
//         readyTimeout: this.connectionTimeout
//       });
//     });
//   }

//   /**
//    * Parse MikroTik "print terse" output into an array of objects.
//    * Expected format: lines like "property1=value1 property2=value2 ..."
//    */
//   _parseTerseOutput(output) {
//     const lines = output.split('\n').filter(line => line.trim() && !line.includes('Flags:') && !line.includes('#'));
//     const objects = [];
//     for (const line of lines) {
//       const obj = {};
//       const parts = line.trim().split(/\s+/);
//       for (const part of parts) {
//         const eqIndex = part.indexOf('=');
//         if (eqIndex !== -1) {
//           const key = part.substring(0, eqIndex);
//           let value = part.substring(eqIndex + 1);
//           // Convert boolean-like strings
//           if (value === 'true') value = true;
//           else if (value === 'false') value = false;
//           obj[key] = value;
//         }
//       }
//       objects.push(obj);
//     }
//     return objects;
//   }

//   /**
//    * Parse standard RouterOS print output (with header and table) into array of objects.
//    * Works for commands that output a header row followed by rows with values.
//    */
//   _parseStandardPrintOutput(output) {
//     const lines = output.split('\n').filter(l => l.trim());
//     if (lines.length < 2) return [];

//     // Find the header line (first line that doesn't start with a number)
//     let headerLine = '';
//     for (let i = 0; i < lines.length; i++) {
//       if (!lines[i].match(/^\s*\d+/)) {
//         headerLine = lines[i];
//         break;
//       }
//     }
//     if (!headerLine) return [];

//     // Remove leading '# ' if present
//     const cleanHeader = headerLine.replace(/^#\s*/, '');
//     // Split header by spaces, but preserve column names that might have dashes
//     const headers = cleanHeader.trim().split(/\s+/);
//     const result = [];

//     for (let i = 0; i < lines.length; i++) {
//       const line = lines[i];
//       if (line.startsWith('Flags:') || line.trim() === '') continue;
//       // Skip the header line itself
//       if (line === headerLine) continue;

//       // Remove the leading index (like "0 " or " 0 ")
//       const withoutIndex = line.replace(/^\s*\d+\s*/, '');
//       // Split by multiple spaces; this may break if values contain spaces, but acceptable for basic fields
//       const values = withoutIndex.trim().split(/\s+/);
//       const obj = {};
//       for (let j = 0; j < headers.length && j < values.length; j++) {
//         // Convert 'true'/'false' strings to booleans
//         let val = values[j];
//         if (val === 'true') val = true;
//         else if (val === 'false') val = false;
//         obj[headers[j]] = val;
//       }
//       result.push(obj);
//     }
//     return result;
//   }

//   /**
//    * Test connection to MikroTik
//    */
//   async testConnection(site) {
//     try {
//       console.log(`\n🔌 Testing SSH connection to ${site.siteName}...`);
//       const output = await this.executeCommand(site, '/system resource print');
      
//       // Extract version
//       const versionMatch = output.match(/version:\s*([^\s]+)/);
//       const version = versionMatch ? versionMatch[1] : 'unknown';
      
//       // Get router identity
//       let identity = null;
//       try {
//         const identityOutput = await this.executeCommand(site, '/system identity print');
//         const identityMatch = identityOutput.match(/name:\s*(.+)/);
//         identity = identityMatch ? identityMatch[1].trim() : null;
//       } catch (err) {
//         console.log('Could not get identity:', err.message);
//       }
      
//       console.log('✅ Connection successful!');
      
//       return {
//         success: true,
//         version,
//         identity,
//         method: 'ssh',
//         message: `Successfully connected to ${site.siteName} via SSH`
//       };
//     } catch (error) {
//       console.error('❌ Connection failed:', error.message);
//       return {
//         success: false,
//         error: error.message,
//         message: `Failed to connect to ${site.siteName}`
//       };
//     }
//   }

//   /**
//    * Test connection with provided credentials (for site onboarding)
//    * @param {string} ip - Router IP address
//    * @param {number} port - SSH port (default 22)
//    * @param {string} username - Router username
//    * @param {string} password - Router password
//    * @returns {Promise<Object>} Result object with success, version, method, message
//    */
//   async testConnectionWithCredentials(ip, port, username, password) {
//     const siteStub = {
//       siteName: 'Test Connection',
//       router: {
//         ip,
//         port: port || 22,
//         username,
//         password
//       }
//     };
//     return this.testConnection(siteStub);
//   }

//   /**
//    * Get system resources (raw output)
//    */
//   async getSystemResources(site) {
//     try {
//       const output = await this.executeCommand(site, '/system resource print');
//       return {
//         success: true,
//         data: output
//       };
//     } catch (error) {
//       console.error('❌ Failed to get system resources:', error);
//       return {
//         success: false,
//         error: error.message
//       };
//     }
//   }

//   /**
//    * Get PPPoE profiles (with fallback)
//    */
//   async getPppoeProfiles(site) {
//     try {
//       const output = await this.executeCommand(site, '/ppp profile print terse');
//       const profiles = this._parseTerseOutput(output);
//       return { success: true, data: profiles };
//     } catch (error) {
//       console.error('Failed to get PPPoE profiles (terse):', error.message);
//       try {
//         const output = await this.executeCommand(site, '/ppp profile print');
//         const profiles = this._parseStandardPrintOutput(output);
//         return { success: true, data: profiles };
//       } catch (fallbackError) {
//         console.error('Fallback also failed:', fallbackError.message);
//         return { success: false, error: fallbackError.message };
//       }
//     }
//   }

//   /**
//    * Get PPPoE secrets (with fallback)
//    */
//   async getPppoeSecrets(site) {
//     try {
//       const output = await this.executeCommand(site, '/ppp secret print terse');
//       const secrets = this._parseTerseOutput(output);
//       secrets.forEach(secret => {
//         secret.disabled = secret.disabled === 'yes' || secret.disabled === true;
//         if (!secret.localAddress) secret.localAddress = 'pool';
//         if (!secret.remoteAddress) secret.remoteAddress = 'pool';
//         if (!secret.callerId) secret.callerId = 'any';
//         if (!secret.lastLoggedOut) secret.lastLoggedOut = 'never';
//       });
//       return { success: true, data: secrets };
//     } catch (error) {
//       console.error('Failed to get PPPoE secrets (terse):', error.message);
//       try {
//         const output = await this.executeCommand(site, '/ppp secret print');
//         const secrets = this._parseStandardPrintOutput(output);
//         secrets.forEach(secret => {
//           secret.disabled = secret.disabled === 'yes' || secret.disabled === true;
//         });
//         return { success: true, data: secrets };
//       } catch (fallbackError) {
//         console.error('Fallback also failed:', fallbackError.message);
//         return { success: false, error: fallbackError.message };
//       }
//     }
//   }

//   /**
//    * Get IP pool details (with fallback)
//    */
//   async getIpPool(site, poolName) {
//     try {
//       const output = await this.executeCommand(site, '/ip pool print terse');
//       const pools = this._parseTerseOutput(output);
//       let targetPool = null;
//       if (poolName) {
//         targetPool = pools.find(p => p.name === poolName);
//       } else {
//         targetPool = pools.find(p => p.name && p.name.toLowerCase().includes('pppoe'));
//       }
//       if (targetPool) {
//         return {
//           success: true,
//           data: {
//             name: targetPool.name,
//             ranges: targetPool.ranges,
//             nextPool: targetPool['next-pool'] || 'none'
//           }
//         };
//       } else {
//         return { success: true, data: null };
//       }
//     } catch (error) {
//       console.error('Failed to get IP pool (terse):', error.message);
//       try {
//         const output = await this.executeCommand(site, '/ip pool print');
//         const pools = this._parseStandardPrintOutput(output);
//         let targetPool = null;
//         if (poolName) {
//           targetPool = pools.find(p => p.name === poolName);
//         } else {
//           targetPool = pools.find(p => p.name && p.name.toLowerCase().includes('pppoe'));
//         }
//         if (targetPool) {
//           return {
//             success: true,
//             data: {
//               name: targetPool.name,
//               ranges: targetPool.ranges,
//               nextPool: targetPool['next-pool'] || 'none'
//             }
//           };
//         }
//         return { success: true, data: null };
//       } catch (fallbackError) {
//         console.error('Fallback also failed:', fallbackError.message);
//         return { success: false, error: fallbackError.message };
//       }
//     }
//   }

//   /**
//    * Get interface statistics (ethernet only, with fallback)
//    */
//   async getInterfaceStats(site) {
//     try {
//       let output;
//       try {
//         output = await this.executeCommand(site, '/interface print terse where type=ether');
//       } catch (err) {
//         output = await this.executeCommand(site, '/interface print terse');
//       }
//       const interfaces = this._parseTerseOutput(output);
//       const ethernetInterfaces = interfaces.filter(i => i.type === 'ether');
//       ethernetInterfaces.forEach(iface => {
//         iface.running = iface.running === 'true';
//         iface.disabled = iface.disabled === 'true';
//         iface.rxByte = parseInt(iface['rx-byte'] || 0, 10);
//         iface.txByte = parseInt(iface['tx-byte'] || 0, 10);
//         iface.rxPacket = parseInt(iface['rx-packet'] || 0, 10);
//         iface.txPacket = parseInt(iface['tx-packet'] || 0, 10);
//         iface.rxDrop = parseInt(iface['rx-drop'] || 0, 10);
//         iface.txDrop = parseInt(iface['tx-drop'] || 0, 10);
//       });
//       return { success: true, data: ethernetInterfaces };
//     } catch (error) {
//       console.error('Failed to get interface stats (terse):', error.message);
//       try {
//         let output;
//         try {
//           output = await this.executeCommand(site, '/interface print where type=ether');
//         } catch (err) {
//           output = await this.executeCommand(site, '/interface print');
//         }
//         const interfaces = this._parseStandardPrintOutput(output);
//         const ethernetInterfaces = interfaces.filter(i => i.type === 'ether');
//         ethernetInterfaces.forEach(iface => {
//           iface.running = iface.running === 'true';
//           iface.disabled = iface.disabled === 'true';
//           iface.rxByte = parseInt(iface['rx-byte'] || 0, 10);
//           iface.txByte = parseInt(iface['tx-byte'] || 0, 10);
//           iface.rxPacket = parseInt(iface['rx-packet'] || 0, 10);
//           iface.txPacket = parseInt(iface['tx-packet'] || 0, 10);
//           iface.rxDrop = parseInt(iface['rx-drop'] || 0, 10);
//           iface.txDrop = parseInt(iface['tx-drop'] || 0, 10);
//         });
//         return { success: true, data: ethernetInterfaces };
//       } catch (fallbackError) {
//         console.error('Fallback also failed:', fallbackError.message);
//         return { success: false, error: fallbackError.message };
//       }
//     }
//   }

//   /**
//    * Get active PPPoE sessions (with fallback)
//    */
//   async getActiveSessions(site) {
//     try {
//       const output = await this.executeCommand(site, '/ppp active print terse');
//       const sessions = this._parseTerseOutput(output);
//       sessions.forEach(session => {
//         if (session['limit-bytes-in']) session['limit-bytes-in'] = parseInt(session['limit-bytes-in'], 10);
//         if (session['limit-bytes-out']) session['limit-bytes-out'] = parseInt(session['limit-bytes-out'], 10);
//         session.encoding = session.encoding || 'none';
//         session.sessionId = session['session-id'] || '';
//       });
//       return {
//         success: true,
//         sessions: sessions,
//         count: sessions.length
//       };
//     } catch (error) {
//       console.error('Failed to get active sessions (terse):', error.message);
//       try {
//         const output = await this.executeCommand(site, '/ppp active print');
//         const sessions = this._parseStandardPrintOutput(output);
//         sessions.forEach(session => {
//           session['limit-bytes-in'] = parseInt(session['limit-bytes-in'] || 0, 10);
//           session['limit-bytes-out'] = parseInt(session['limit-bytes-out'] || 0, 10);
//           session.encoding = session.encoding || 'none';
//           session.sessionId = session['session-id'] || '';
//         });
//         return {
//           success: true,
//           sessions: sessions,
//           count: sessions.length
//         };
//       } catch (fallbackError) {
//         console.error('Fallback also failed:', fallbackError.message);
//         return {
//           success: false,
//           error: fallbackError.message,
//           sessions: [],
//           count: 0
//         };
//       }
//     }
//   }

//   /**
//    * Add PPPoE secret
//    */
//   async addPPPoESecret(site, customer, packageData) {
//     console.log(`\n=== Adding PPPoE Secret via SSH: ${customer.pppoe.username} ===`);
//     console.log(`Site: ${site.siteName}`);
//     console.log(`Package: ${packageData.name}`);

//     try {
//       // Check if secret already exists
//       const checkCmd = `/ppp secret print where name="${customer.pppoe.username}"`;
//       const existing = await this.executeCommand(site, checkCmd);

//       if (existing.trim().length > 0 && !existing.includes('Flags:')) {
//         console.log('⚠️ PPPoE secret already exists, updating...');
        
//         // Update existing secret
//         const updateCmd = `/ppp secret set [find name="${customer.pppoe.username}"] ` +
//           `password="${customer.pppoe.password}" ` +
//           `profile="${packageData.name}" ` +
//           `comment="${customer.firstName} ${customer.lastName} - ${customer.accountId}" ` +
//           `disabled=${customer.subscription.status === 'active' ? 'no' : 'yes'}`;
        
//         await this.executeCommand(site, updateCmd);
        
//         console.log('✅ PPPoE secret updated');
//         return {
//           success: true,
//           action: 'updated',
//           username: customer.pppoe.username
//         };
//       }

//       // Add new secret
//       const addCmd = `/ppp secret add ` +
//         `name="${customer.pppoe.username}" ` +
//         `password="${customer.pppoe.password}" ` +
//         `profile="${packageData.name}" ` +
//         `service=pppoe ` +
//         `comment="${customer.firstName} ${customer.lastName} - ${customer.accountId}" ` +
//         `disabled=${customer.subscription.status === 'active' ? 'no' : 'yes'}`;

//       await this.executeCommand(site, addCmd);
      
//       console.log('✅ PPPoE secret added successfully');
      
//       return {
//         success: true,
//         action: 'created',
//         username: customer.pppoe.username
//       };

//     } catch (error) {
//       console.error('❌ Failed to add PPPoE secret:', error);
//       throw new Error(`Failed to add PPPoE secret: ${error.message}`);
//     }
//   }

//   /**
//    * Enable PPPoE account
//    */
//   async enablePPPoEAccount(site, username) {
//     console.log(`\n=== Enabling PPPoE Account via SSH: ${username} ===`);

//     try {
//       const cmd = `/ppp secret set [find name="${username}"] disabled=no`;
//       await this.executeCommand(site, cmd);
      
//       console.log('✅ PPPoE account enabled');
      
//       return {
//         success: true,
//         message: 'Account enabled successfully'
//       };

//     } catch (error) {
//       console.error('❌ Failed to enable account:', error);
//       throw new Error(`Failed to enable account: ${error.message}`);
//     }
//   }

//   /**
//    * Disable PPPoE account
//    */
//   async disablePPPoEAccount(site, username) {
//     console.log(`\n=== Disabling PPPoE Account via SSH: ${username} ===`);

//     try {
//       // Disable the account
//       const disableCmd = `/ppp secret set [find name="${username}"] disabled=yes`;
//       await this.executeCommand(site, disableCmd);
      
//       // Disconnect active session
//       const disconnectCmd = `/ppp active remove [find name="${username}"]`;
//       try {
//         await this.executeCommand(site, disconnectCmd);
//         console.log('✅ Active session terminated');
//       } catch (err) {
//         console.log('ℹ️ No active session to disconnect');
//       }
      
//       console.log('✅ PPPoE account disabled');
      
//       return {
//         success: true,
//         message: 'Account disabled successfully'
//       };

//     } catch (error) {
//       console.error('❌ Failed to disable account:', error);
//       throw new Error(`Failed to disable account: ${error.message}`);
//     }
//   }

//   /**
//    * Update PPPoE password
//    */
//   async updatePPPoEPassword(site, username, newPassword) {
//     console.log(`\n=== Updating PPPoE Password via SSH: ${username} ===`);

//     try {
//       const cmd = `/ppp secret set [find name="${username}"] password="${newPassword}"`;
//       await this.executeCommand(site, cmd);
      
//       console.log('✅ Password updated successfully');
      
//       return {
//         success: true,
//         message: 'Password updated successfully'
//       };

//     } catch (error) {
//       console.error('❌ Failed to update password:', error);
//       throw new Error(`Failed to update password: ${error.message}`);
//     }
//   }

//   /**
//    * Delete PPPoE secret
//    */
//   async deletePPPoESecret(site, username) {
//     console.log(`\n=== Deleting PPPoE Secret via SSH: ${username} ===`);

//     try {
//       // First, disconnect active session
//       const disconnectCmd = `/ppp active remove [find name="${username}"]`;
//       try {
//         await this.executeCommand(site, disconnectCmd);
//         console.log('✅ Active session terminated');
//       } catch (err) {
//         console.log('ℹ️ No active session to disconnect');
//       }
      
//       // Then delete the secret
//       const deleteCmd = `/ppp secret remove [find name="${username}"]`;
//       await this.executeCommand(site, deleteCmd);
      
//       console.log('✅ PPPoE secret deleted');
      
//       return {
//         success: true,
//         message: 'Secret deleted successfully'
//       };

//     } catch (error) {
//       console.error('❌ Failed to delete secret:', error);
//       throw new Error(`Failed to delete secret: ${error.message}`);
//     }
//   }
// }

// // Export singleton instance
// module.exports = new MikrotikSSHService();


//USING API


/**
 * MikroTik Service using RouterOS API
 * 
 * This implementation uses MikroTik's RouterOS API protocol.
 * Maintains identical function signatures as SSH version for drop-in replacement.
 * 
 * Install: npm install node-routeros
 */

const RouterOSAPI = require('node-routeros').RouterOSAPI;


class MikrotikAPIService {
  constructor() {
    this.connectionTimeout = 10000;
  }

  /**
   * Get a connection to MikroTik API
   * @private
   */
/**
 * Get a connection to MikroTik API
 * Accepts either a site object (with site.router) or a plain router object
 * @private
 */
async _getConnection(routerOrSite) {
  let host, user, password, port;

  if (routerOrSite.router) {
    // Legacy: it's a site object with a router property
    host = routerOrSite.router.ip;
    user = routerOrSite.router.username;
    password = routerOrSite.router.password;
    port = 8728;   // default API port
  } else {
    // New: it's a plain router object (used by routerController)
    host = routerOrSite.ip;
    user = routerOrSite.username;
    password = routerOrSite.password;
    port = routerOrSite.port || 8728;
  }

  const api = new RouterOSAPI({
    host,
    user,
    password,
    port,
    timeout: this.connectionTimeout
  });

  try {
    await api.connect();
    return api;
  } catch (error) {
    console.error('API connection error details:', error);
    throw new Error(`API connection failed: ${error.message || error.code || 'Unknown'}`);
  }
}

  /**
   * Execute a command via API
   * @private
   */
  async _executeCommand(api, command, params = {}) {
    try {
      const result = await api.write(command, params);
      return result;
    } catch (error) {
      throw new Error(`Command execution failed: ${error.message}`);
    }
  }

  /**
   * Parse MikroTik API response to match SSH output format
   * @private
   */
  _parseApiResponse(response) {
    if (!Array.isArray(response)) {
      return [];
    }
    return response.map(item => {
      const obj = {};
      for (const key in item) {
        if (key !== '.id') {
          // Remove leading dot from keys
          const cleanKey = key.startsWith('.') ? key.substring(1) : key;
          obj[cleanKey] = item[key];
        }
      }
      return obj;
    });
  }

  /**
   * Test connection to MikroTik
   * Same signature as SSH version
   */
  async testConnection(site) {
    let api = null;
    try {
      console.log(`\n🔌 Testing API connection to ${site.siteName}...`);
      
      api = await this._getConnection(site);
      
      // Get system resource
      const resource = await this._executeCommand(api, '/system/resource/print');
      
      // Get system identity
      let identity = null;
      try {
        const identityData = await this._executeCommand(api, '/system/identity/print');
        identity = identityData && identityData[0] ? identityData[0].name : null;
      } catch (err) {
        console.log('Could not get identity:', err.message);
      }

      const version = resource && resource[0] ? resource[0].version : 'unknown';
      
      await api.close();
      
      console.log('✅ Connection successful!');
      
      return {
        success: true,
        version,
        identity,
        method: 'api',
        message: `Successfully connected to ${site.siteName} via API`
      };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('❌ Connection failed:', error.message);
      return {
        success: false,
        error: error.message,
        message: `Failed to connect to ${site.siteName}`
      };
    }
  }

  /**
   * Test connection with provided credentials (for site onboarding)
   * Same signature as SSH version
   */
  async testConnectionWithCredentials(ip, port, username, password) {
    const siteStub = {
      siteName: 'Test Connection',
      router: {
        ip,
        port: 8728,
        username,
        password
      }
    };
    return this.testConnection(siteStub);
  }

  /**
   * Get system resources (raw output format matching SSH)
   * Same signature as SSH version
   */
  async getSystemResources(site) {
    let api = null;
    try {
      api = await this._getConnection(site);
      const resource = await this._executeCommand(api, '/system/resource/print');
      await api.close();

      // Format to match SSH output
      const data = resource && resource[0] ? resource[0] : {};
      const output = Object.keys(data)
        .filter(k => !k.startsWith('.'))
        .map(k => `${k}: ${data[k]}`)
        .join('\n');

      return {
        success: true,
        data: output
      };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('❌ Failed to get system resources:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get PPPoE profiles
   * Same signature as SSH version
   */
  async getPppoeProfiles(site) {
    let api = null;
    try {
      api = await this._getConnection(site);
      const profiles = await this._executeCommand(api, '/ppp/profile/print');
      await api.close();

      const parsed = this._parseApiResponse(profiles);
      return { success: true, data: parsed };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('Failed to get PPPoE profiles:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get PPPoE secrets
   * Same signature as SSH version
   */
  async getPppoeSecrets(site) {
    let api = null;
    try {
      api = await this._getConnection(site);
      const secrets = await this._executeCommand(api, '/ppp/secret/print');
      await api.close();

      const parsed = this._parseApiResponse(secrets);
      return { success: true, data: parsed };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('Failed to get PPPoE secrets:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get IP pool info
   * Same signature as SSH version
   */
  async getIpPool(site) {
    let api = null;
    try {
      api = await this._getConnection(site);
      const pools = await this._executeCommand(api, '/ip/pool/print');
      await api.close();

      const parsed = this._parseApiResponse(pools);
      return { success: true, data: parsed };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('Failed to get IP pools:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get interface statistics
   * Same signature as SSH version
   */
  async getInterfaceStats(site) {
    let api = null;
    try {
      api = await this._getConnection(site);
      const interfaces = await this._executeCommand(api, '/interface/print', {
        '?type': 'ether'
      });
      await api.close();

      const parsed = this._parseApiResponse(interfaces);
      
      // Convert to match SSH output format
      const ethernetInterfaces = parsed.map(iface => ({
        ...iface,
        running: iface.running === 'true' || iface.running === true,
        disabled: iface.disabled === 'true' || iface.disabled === true,
        rxByte: parseInt(iface['rx-byte'] || 0, 10),
        txByte: parseInt(iface['tx-byte'] || 0, 10),
        rxPacket: parseInt(iface['rx-packet'] || 0, 10),
        txPacket: parseInt(iface['tx-packet'] || 0, 10),
        rxDrop: parseInt(iface['rx-drop'] || 0, 10),
        txDrop: parseInt(iface['tx-drop'] || 0, 10)
      }));

      return { success: true, data: ethernetInterfaces };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('Failed to get interface stats:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get active PPPoE sessions
   * Same signature and return format as SSH version
   */
  async getActiveSessions(site) {
    let api = null;
    try {
      api = await this._getConnection(site);
      const active = await this._executeCommand(api, '/ppp/active/print');
      await api.close();

      const sessions = this._parseApiResponse(active);
      
      // Normalize session data to match SSH output
      sessions.forEach(session => {
        session['limit-bytes-in'] = parseInt(session['limit-bytes-in'] || 0, 10);
        session['limit-bytes-out'] = parseInt(session['limit-bytes-out'] || 0, 10);
        session.encoding = session.encoding || 'none';
        session.sessionId = session['session-id'] || '';
      });

      return {
        success: true,
        sessions: sessions,
        count: sessions.length
      };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('Failed to get active sessions:', error.message);
      return {
        success: false,
        error: error.message,
        sessions: [],
        count: 0
      };
    }
  }


  /**
 * End (disconnect) an active PPPoE session for a specific username
 * @param {Object} site - Site document (must have router credentials)
 * @param {string} username - PPPoE username to disconnect
 * @returns {Promise<Object>} { success, message, wasConnected? }
 */
  async endSession(site, username) {
    console.log(`\n=== Ending PPPoE Session via API: ${username} ===`);
    let api = null;
    try {
      api = await this._getConnection(site);
  
      // First, list all active sessions (for debugging)
      const allActive = await this._executeCommand(api, '/ppp/active/print');
      console.log(`📡 Found ${allActive.length} active sessions total.`);
      console.log(`   Looking for username "${username}"`);
  
      // Find active session for this username
      const active = await this._executeCommand(api, '/ppp/active/print', {
        '?name': username
      });
  
      if (!active || active.length === 0) {
        console.log(`ℹ️ No active session found for ${username}`);
        await api.close();
        return {
          success: true,
          wasConnected: false,
          message: `No active session for ${username}`
        };
      }
  
      console.log(`✅ Found active session:`, active[0]);
  
      // Remove the session
      await this._executeCommand(api, '/ppp/active/remove', {
        '.id': active[0]['.id']
      });
  
      await api.close();
      console.log(`✅ Session ended for ${username}`);
      return {
        success: true,
        wasConnected: true,
        message: `Session ended for ${username}`
      };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      console.error(`❌ Failed to end session for ${username}:`, error);
      return {
        success: false,
        error: error.message,
        message: `Failed to end session: ${error.message}`
      };
    }
  }

  /**
   * Add PPPoE secret
   * Same signature as SSH version
   */
  async addPPPoESecret(site, customer, packageData) {
    console.log(`\n=== Adding PPPoE Secret via API: ${customer.pppoe.username} ===`);
    console.log(`Site: ${site.siteName}`);
    console.log(`Package: ${packageData.name}`);

    let api = null;
    try {
      api = await this._getConnection(site);

      // Check if secret already exists
      const existing = await this._executeCommand(api, '/ppp/secret/print', {
        '?name': customer.pppoe.username
      });

      if (existing && existing.length > 0) {
        console.log('⚠️ PPPoE secret already exists, updating...');
        
        // Update existing secret
        await this._executeCommand(api, '/ppp/secret/set', {
          '.id': existing[0]['.id'],
          password: customer.pppoe.password,
          profile: packageData.name,
          comment: `${customer.firstName} ${customer.lastName} - ${customer.accountId}`,
          disabled: customer.subscription.status === 'active' ? 'no' : 'yes'
        });
        
        await api.close();
        
        console.log('✅ PPPoE secret updated');
        return {
          success: true,
          action: 'updated',
          username: customer.pppoe.username
        };
      }

      // Add new secret
      await this._executeCommand(api, '/ppp/secret/add', {
        name: customer.pppoe.username,
        password: customer.pppoe.password,
        profile: packageData.name,
        service: 'pppoe',
        comment: `${customer.firstName} ${customer.lastName} - ${customer.accountId}`,
        disabled: customer.subscription.status === 'active' ? 'no' : 'yes'
      });

      await api.close();
      
      console.log('✅ PPPoE secret added successfully');
      
      return {
        success: true,
        action: 'created',
        username: customer.pppoe.username
      };

    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('❌ Failed to add PPPoE secret:', error);
      throw new Error(`Failed to add PPPoE secret: ${error.message}`);
    }
  }

  /**
   * Enable PPPoE account
   * Same signature as SSH version
   */
  async enablePPPoEAccount(site, username) {
    console.log(`\n=== Enabling PPPoE Account via API: ${username} ===`);

    let api = null;
    try {
      api = await this._getConnection(site);

      // Find the secret
      const secrets = await this._executeCommand(api, '/ppp/secret/print', {
        '?name': username
      });

      if (!secrets || secrets.length === 0) {
        throw new Error(`PPPoE secret not found: ${username}`);
      }

      // Enable it
      await this._executeCommand(api, '/ppp/secret/set', {
        '.id': secrets[0]['.id'],
        disabled: 'no'
      });

      await api.close();
      
      console.log('✅ PPPoE account enabled');
      
      return {
        success: true,
        message: 'Account enabled successfully'
      };

    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('❌ Failed to enable account:', error);
      throw new Error(`Failed to enable account: ${error.message}`);
    }
  }

  /**
   * Disable PPPoE account
   * Same signature as SSH version
   */
  async disablePPPoEAccount(site, username) {
    console.log(`\n=== Disabling PPPoE Account via API: ${username} ===`);

    let api = null;
    try {
      api = await this._getConnection(site);

      // Find and disable the secret
      const secrets = await this._executeCommand(api, '/ppp/secret/print', {
        '?name': username
      });

      if (!secrets || secrets.length === 0) {
        throw new Error(`PPPoE secret not found: ${username}`);
      }

      await this._executeCommand(api, '/ppp/secret/set', {
        '.id': secrets[0]['.id'],
        disabled: 'yes'
      });

      // Try to disconnect active session
      try {
        const active = await this._executeCommand(api, '/ppp/active/print', {
          '?name': username
        });

        if (active && active.length > 0) {
          await this._executeCommand(api, '/ppp/active/remove', {
            '.id': active[0]['.id']
          });
          console.log('✅ Active session terminated');
        } else {
          console.log('ℹ️ No active session to disconnect');
        }
      } catch (err) {
        console.log('ℹ️ No active session to disconnect');
      }

      await api.close();
      
      console.log('✅ PPPoE account disabled');
      
      return {
        success: true,
        message: 'Account disabled successfully'
      };

    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('❌ Failed to disable account:', error);
      throw new Error(`Failed to disable account: ${error.message}`);
    }
  }

  /**
   * Update PPPoE password
   * Same signature as SSH version
   */
  async updatePPPoEPassword(site, username, newPassword) {
    console.log(`\n=== Updating PPPoE Password via API: ${username} ===`);

    let api = null;
    try {
      api = await this._getConnection(site);

      // Find the secret
      const secrets = await this._executeCommand(api, '/ppp/secret/print', {
        '?name': username
      });

      if (!secrets || secrets.length === 0) {
        throw new Error(`PPPoE secret not found: ${username}`);
      }

      // Update password
      await this._executeCommand(api, '/ppp/secret/set', {
        '.id': secrets[0]['.id'],
        password: newPassword
      });

      await api.close();
      
      console.log('✅ Password updated successfully');
      
      return {
        success: true,
        message: 'Password updated successfully'
      };

    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('❌ Failed to update password:', error);
      throw new Error(`Failed to update password: ${error.message}`);
    }
  }

  /**
   * Delete PPPoE secret
   * Same signature as SSH version
   */
  async deletePPPoESecret(site, username) {
    console.log(`\n=== Deleting PPPoE Secret via API: ${username} ===`);

    let api = null;
    try {
      api = await this._getConnection(site);

      // Try to disconnect active session first
      try {
        const active = await this._executeCommand(api, '/ppp/active/print', {
          '?name': username
        });

        if (active && active.length > 0) {
          await this._executeCommand(api, '/ppp/active/remove', {
            '.id': active[0]['.id']
          });
          console.log('✅ Active session terminated');
        } else {
          console.log('ℹ️ No active session to disconnect');
        }
      } catch (err) {
        console.log('ℹ️ No active session to disconnect');
      }

      // Find and delete the secret
      const secrets = await this._executeCommand(api, '/ppp/secret/print', {
        '?name': username
      });

      if (!secrets || secrets.length === 0) {
        throw new Error(`PPPoE secret not found: ${username}`);
      }

      await this._executeCommand(api, '/ppp/secret/remove', {
        '.id': secrets[0]['.id']
      });

      await api.close();
      
      console.log('✅ PPPoE secret deleted');
      
      return {
        success: true,
        message: 'Secret deleted successfully'
      };

    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      
      console.error('❌ Failed to delete secret:', error);
      throw new Error(`Failed to delete secret: ${error.message}`);
    }
  }



  /**
 * Get RADIUS configuration
 */
async getRadiusConfig(site) {
  let api = null;
  try {
    api = await this._getConnection(site);
    const radius = await this._executeCommand(api, '/radius/print');
    const aaa = await this._executeCommand(api, '/ppp/aaa/print');
    await api.close();

    return {
      success: true,
      data: {
        servers: this._parseApiResponse(radius),
        aaa: aaa && aaa[0] ? aaa[0] : {}
      }
    };
  } catch (error) {
    if (api) {
      try { await api.close(); } catch (e) { /* ignore */ }
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get bridge interfaces
 */
async getBridges(site) {
  let api = null;
  try {
    api = await this._getConnection(site);
    const bridges = await this._executeCommand(api, '/interface/bridge/print');
    const ports = await this._executeCommand(api, '/interface/bridge/port/print');
    await api.close();

    return {
      success: true,
      data: {
        bridges: this._parseApiResponse(bridges),
        ports: this._parseApiResponse(ports)
      }
    };
  } catch (error) {
    if (api) {
      try { await api.close(); } catch (e) { /* ignore */ }
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get IP pools
 */
async getIpPools(site) {
  let api = null;
  try {
    api = await this._getConnection(site);
    const pools = await this._executeCommand(api, '/ip/pool/print');
    await api.close();

    return {
      success: true,
      data: this._parseApiResponse(pools)
    };
  } catch (error) {
    if (api) {
      try { await api.close(); } catch (e) { /* ignore */ }
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get IP addresses
 */
async getIpAddresses(site) {
  let api = null;
  try {
    api = await this._getConnection(site);
    const addresses = await this._executeCommand(api, '/ip/address/print');
    await api.close();

    return {
      success: true,
      data: this._parseApiResponse(addresses)
    };
  } catch (error) {
    if (api) {
      try { await api.close(); } catch (e) { /* ignore */ }
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get PPPoE servers
 */
async getPppoeServers(site) {
  let api = null;
  try {
    api = await this._getConnection(site);
    const servers = await this._executeCommand(api, '/interface/pppoe-server/server/print');
    await api.close();

    return {
      success: true,
      data: this._parseApiResponse(servers)
    };
  } catch (error) {
    if (api) {
      try { await api.close(); } catch (e) { /* ignore */ }
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get all interfaces
 */
async getInterfaces(site) {
  let api = null;
  try {
    api = await this._getConnection(site);
    const interfaces = await this._executeCommand(api, '/interface/print');
    await api.close();

    const parsed = this._parseApiResponse(interfaces);

    // Exclude pppoe-in interfaces only — these are dynamically created by
    // RouterOS per active customer PPPoE session (e.g. <pppoe-SKY0133>) and
    // destroyed on disconnect. All OTHER dynamic interfaces (bridges,
    // wireless, VPN tunnels, etc.) are kept; this filters by type, not by
    // the `dynamic` flag, so it only removes PPPoE customer sessions.
    const filtered = parsed.filter(iface => iface.type !== 'pppoe-in');

    return {
      success: true,
      data: filtered
    };
  } catch (error) {
    if (api) {
      try { await api.close(); } catch (e) { /* ignore */ }
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get Ethernet interfaces only
 */
async getEthernetInterfaces(site) {
  let api = null;
  try {
    api = await this._getConnection(site);
    const interfaces = await this._executeCommand(api, '/interface/ethernet/print');
    await api.close();

    return {
      success: true,
      data: this._parseApiResponse(interfaces)
    };
  } catch (error) {
    if (api) {
      try { await api.close(); } catch (e) { /* ignore */ }
    }
    return {
      success: false,
      error: error.message
    };
  }
}


  // ============================================
  // HOTSPOT METHODS
  // ============================================

  /**
   * Add or update a hotspot user in MikroTik
   * This is the KEY method - it creates the user that allows internet access
   */
  async addHotspotUser(site, userData) {
    console.log(`\n=== Adding Hotspot User via API: ${userData.name} ===`);
    let api = null;
    try {
      api = await this._getConnection(site);

      // Check if user already exists
      const existing = await this._executeCommand(api, '/ip/hotspot/user/print', {
        '?name': userData.name
      });

      const profile = userData.profile || 'default';
      const limitUptime = userData.limitUptime || '1d'; // Format: 1d, 12h, 30m
      const macAddress = userData.macAddress || '';

      if (existing && existing.length > 0) {
        console.log('⚠️ Hotspot user exists, updating...');
        
        // Update existing user
        const params = {
          '.id': existing[0]['.id'],
          'profile': profile,
          'limit-uptime': limitUptime,
          'disabled': 'no',
          'comment': userData.comment || `Hotspot user ${userData.name}`
        };
        
        if (macAddress) {
          params['mac-address'] = macAddress;
        }
        if (userData.password) {
          params['password'] = userData.password;
        }

        await this._executeCommand(api, '/ip/hotspot/user/set', params);
        
        await api.close();
        console.log('✅ Hotspot user updated');
        return { success: true, action: 'updated', name: userData.name };
      }

      // Add new hotspot user
      const params = {
        name: userData.name,
        profile: profile,
        'limit-uptime': limitUptime,
        'disabled': 'no',
        comment: userData.comment || `Hotspot user ${userData.name}`
      };

      if (macAddress) {
        params['mac-address'] = macAddress;
      }
      if (userData.password) {
        params['password'] = userData.password;
      }

      await this._executeCommand(api, '/ip/hotspot/user/add', params);

      await api.close();
      console.log('✅ Hotspot user added successfully');
      return { success: true, action: 'created', name: userData.name };

    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      console.error('❌ Failed to add hotspot user:', error);
      throw new Error(`Failed to add hotspot user: ${error.message}`);
    }
  }

  /**
   * Remove a hotspot user from MikroTik
   */
  async removeHotspotUser(site, username) {
    console.log(`\n=== Removing Hotspot User via API: ${username} ===`);
    let api = null;
    try {
      api = await this._getConnection(site);

      const existing = await this._executeCommand(api, '/ip/hotspot/user/print', {
        '?name': username
      });

      if (!existing || existing.length === 0) {
        console.log('ℹ️ Hotspot user not found');
        return { success: true, message: 'User not found' };
      }

      // Remove active session first
      try {
        const active = await this._executeCommand(api, '/ip/hotspot/active/print', {
          '?user': username
        });
        if (active && active.length > 0) {
          await this._executeCommand(api, '/ip/hotspot/active/remove', {
            '.id': active[0]['.id']
          });
          console.log('✅ Active hotspot session removed');
        }
      } catch (err) {
        console.log('ℹ️ No active session to remove');
      }

      // Remove the user
      await this._executeCommand(api, '/ip/hotspot/user/remove', {
        '.id': existing[0]['.id']
      });

      await api.close();
      console.log('✅ Hotspot user removed');
      return { success: true, message: 'User removed' };

    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      console.error('❌ Failed to remove hotspot user:', error);
      throw new Error(`Failed to remove hotspot user: ${error.message}`);
    }
  }

  /**
   * Get hotspot user info
   */
  async getHotspotUser(site, username) {
    let api = null;
    try {
      api = await this._getConnection(site);
      const users = await this._executeCommand(api, '/ip/hotspot/user/print', {
        '?name': username
      });
      await api.close();

      if (!users || users.length === 0) {
        return { success: true, exists: false };
      }

      return {
        success: true,
        exists: true,
        data: this._parseApiResponse(users)[0]
      };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all hotspot active sessions
   */
  async getHotspotActiveSessions(site) {
    let api = null;
    try {
      api = await this._getConnection(site);
      const active = await this._executeCommand(api, '/ip/hotspot/active/print');
      await api.close();

      return {
        success: true,
        sessions: this._parseApiResponse(active)
      };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Disconnect a specific hotspot active session by MAC
   */
  async disconnectHotspotByMac(site, macAddress) {
    console.log(`\n=== Disconnecting Hotspot Session by MAC: ${macAddress} ===`);
    let api = null;
    try {
      api = await this._getConnection(site);

      const active = await this._executeCommand(api, '/ip/hotspot/active/print', {
        '?mac-address': macAddress.toUpperCase()
      });

      if (!active || active.length === 0) {
        console.log('ℹ️ No active session for this MAC');
        await api.close();
        return { success: true, wasConnected: false };
      }

      await this._executeCommand(api, '/ip/hotspot/active/remove', {
        '.id': active[0]['.id']
      });

      await api.close();
      console.log('✅ Hotspot session disconnected');
      return { success: true, wasConnected: true };

    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      console.error('❌ Failed to disconnect hotspot:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add walled garden entry for payment portal
   */
  async addWalledGarden(site, host) {
    let api = null;
    try {
      api = await this._getConnection(site);

      // Check if already exists
      const existing = await this._executeCommand(api, '/ip/hotspot/walled-garden/ip/print', {
        '?dst-host': host
      });

      if (existing && existing.length > 0) {
        await api.close();
        return { success: true, message: 'Already exists' };
      }

      await this._executeCommand(api, '/ip/hotspot/walled-garden/ip/add', {
        'dst-host': host,
        action: 'accept'
      });

      await api.close();
      return { success: true, message: 'Walled garden entry added' };

    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Create hotspot user profile (speed limit)
   */
  async createHotspotProfile(site, profileName, rateLimit) {
    console.log(`\n=== Creating Hotspot Profile: ${profileName} (${rateLimit}) ===`);
    let api = null;
    try {
      api = await this._getConnection(site);

      // Check if exists
      const existing = await this._executeCommand(api, '/ip/hotspot/user/profile/print', {
        '?name': profileName
      });

      if (existing && existing.length > 0) {
        // Update existing
        await this._executeCommand(api, '/ip/hotspot/user/profile/set', {
          '.id': existing[0]['.id'],
          'rate-limit': rateLimit,
          'shared-users': '1'
        });
        console.log('✅ Profile updated');
      } else {
        // Create new
        await this._executeCommand(api, '/ip/hotspot/user/profile/add', {
          name: profileName,
          'rate-limit': rateLimit,
          'shared-users': '1',
          'idle-timeout': '5m'
        });
        console.log('✅ Profile created');
      }

      await api.close();
      return { success: true, profileName, rateLimit };

    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      console.error('❌ Failed to create profile:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Force re-authentication of a hotspot user by MAC address
   * Removes them from ALLOWED_USERS address list, active sessions, and host table
   * MikroTik will re-auth them on next request → RADIUS decides access level
   */
/**
 * Force a hotspot user to re-authenticate by removing their active session.
 * The user will be disconnected and must log in again; RADIUS will then apply the correct access list.
 */
async kickHotspotUser(site, macAddress) {
  console.log(`\n=== Kicking Hotspot User (remove active session): ${macAddress} ===`);
  let api = null;
  try {
    api = await this._getConnection(site);

    const raw = macAddress.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
    if (raw.length !== 12) {
      return { success: false, error: `Invalid MAC address: ${macAddress}` };
    }
    const mac = raw.match(/.{2}/g).join(':');
    console.log(`   MAC (normalized): ${mac}`);

    // Find active hotspot session by MAC
    const activeSessions = await api.write('/ip/hotspot/active/print', [
      `?mac-address=${mac}`
    ]);

    if (!activeSessions || activeSessions.length === 0) {
      console.log(`   ℹ️ No active hotspot session found for ${mac}`);
      await api.close();
      return { success: true, message: 'No active session to remove', wasConnected: false };
    }

    const session = activeSessions[0];
    const sessionId = session['.id'];

    if (!sessionId) {
      console.error(`   ❌ No session ID found in object:`, session);
      await api.close();
      return { success: false, error: 'Cannot extract session ID' };
    }

    console.log(`   Found session ID: ${sessionId}`);

    // Remove using array format (consistent with existing patterns)
    await api.write('/ip/hotspot/active/remove', [
      `=.id=${sessionId}`
    ]);

    await api.close();
    console.log(`   ✅ Active hotspot session removed for ${mac}`);
    return { success: true, wasConnected: true, mac };

  } catch (error) {
    if (api) {
      try { await api.close(); } catch (e) { /* ignore */ }
    }
    console.error(`❌ Failed to kick hotspot user ${macAddress}:`, error.message);
    return { success: false, error: error.message };
  }
}


/**
 * Force re-authentication of a client by IP address.
 *
 * Flow:
 *   1. Search /ip/hotspot/host by address.
 *      - If found, remove all matching host entries.
 *   2. Otherwise search /ppp/active by address.
 *      - If found, remove the active PPP session.
 *   3. Otherwise return "not found".
 */
async forceReauthentication(site, ipAddress) {
  console.log(`\n=== Force Reauthentication: ${ipAddress} ===`);

  let api = null;

  try {
    api = await this._getConnection(site);

    //
    // STEP 1: Try Hotspot Host
    //
    const hosts = await api.write('/ip/hotspot/host/print', [
      `?address=${ipAddress}`
    ]);

    if (hosts && hosts.length > 0) {
      console.log(`   Found ${hosts.length} hotspot host(s)`);

      let removed = 0;

      for (const host of hosts) {
        if (!host['.id']) continue;

        await api.write('/ip/hotspot/host/remove', [
          `=.id=${host['.id']}`
        ]);

        removed++;
      }

      await api.close();

      console.log(`   ✅ Removed ${removed} hotspot host(s)`);

      return {
        success: true,
        type: 'hotspot',
        ip: ipAddress,
        removed
      };
    }

    //
    // STEP 2: Try PPP Active
    //
    const sessions = await api.write('/ppp/active/print', [
      `?address=${ipAddress}`
    ]);

    if (sessions && sessions.length > 0) {
      const session = sessions[0];

      if (!session['.id']) {
        await api.close();

        return {
          success: false,
          error: 'PPP session has no .id'
        };
      }

      console.log(`   Found PPP session ${session['.id']}`);

      await api.write('/ppp/active/remove', [
        `=.id=${session['.id']}`
      ]);

      await api.close();

      console.log(`   ✅ PPP session terminated`);

      return {
        success: true,
        type: 'pppoe',
        ip: ipAddress
      };
    }

    //
    // STEP 3: Nothing found
    //
    await api.close();

    console.log(`   ℹ️ No hotspot host or PPP session found for ${ipAddress}`);

    return {
      success: false,
      error: 'Connection not found',
      ip: ipAddress
    };

  } catch (error) {
    if (api) {
      try {
        await api.close();
      } catch (_) {}
    }

    console.error(`❌ Failed to force reauthentication for ${ipAddress}:`, error.message);

    return {
      success: false,
      error: error.message,
      ip: ipAddress
    };
  }
}

 
  // ----------------------------------------------------------------------
  // NMS / TOPOLOGY METHODS
  // ----------------------------------------------------------------------
 
  /**
   * Get LLDP/MNDP neighbor table — who is plugged into which local port,
   * and what the device on the other end calls itself.
   *
   * Used by the topology service to figure out which port of this router
   * connects to which port of another router/device in our system.
   *
   * Real-world notes:
   * - `identity` is the field we match against Router.name / Device.name to
   *   resolve a neighbor row into an actual device in our database. If it's
   *   missing, that neighbor row is unusable for matching and is skipped.
   * - `interface-name` (the port name as reported BY the neighbor) is best
   *   effort — not every device populates it, so it can be null.
   * - A single local interface can have more than one neighbor row if it's
   *   connected through an unmanaged switch with LLDP passthrough. That's a
   *   real topology, not a bug — we don't collapse duplicates here.
   */
  async getNeighbors(site) {
    let api = null;
    try {
      api = await this._getConnection(site);
      const neighbors = await this._executeCommand(api, '/ip/neighbor/print');
      await api.close();
 
      const parsed = this._parseApiResponse(neighbors);
 
      const data = parsed
        .filter(n => n.interface && n.identity)
        .map(n => ({
          localInterface: n.interface,
          remoteIdentity: n.identity,
          remoteInterfaceName: n['interface-name'] || null,
          remoteMac: n['mac-address'] || null,
          remoteAddress: n.address || null,
          remotePlatform: n.platform || null,
          remoteBoard: n.board || null,
          remoteVersion: n.version || null
        }));
 
      return { success: true, data };
    } catch (error) {
      if (api) {
        try { await api.close(); } catch (e) { /* ignore */ }
      }
      console.error('Failed to get neighbors:', error.message);
      return { success: false, error: error.message };
    }
  }
 
  /**
   * Get per-interface byte counters plus the real negotiated link speed,
   * for bandwidth history graphs.
   *
   * This returns a raw CUMULATIVE snapshot (rx-byte / tx-byte since last
   * reset, e.g. reboot) — it does NOT compute a rate. The caller (the stats
   * poller) is responsible for diffing this against the previous poll to
   * get bits-per-second, and for handling counter resets (if current bytes
   * are lower than the last stored value, the router rebooted — treat the
   * delta as the current value, not a negative number).
   *
   * Reuses getInterfaces() and getEthernetInterfaces() rather than issuing
   * fresh /interface/print or /interface/ethernet/print calls, so this
   * stays consistent with the rest of the service if those methods change.
   *
   * ifSpeed caveats (real, not theoretical):
   * - Only ethernet-type ports show up in getEthernetInterfaces() — bridges,
   *   VLANs, and pppoe-server interfaces won't have a speed value here, and
   *   that's expected, not a failure.
   * - `speed` is only populated once a link has actually negotiated. A down
   *   or disabled port reporting null speed usually just means it was
   *   checked while down, not that data is missing.
   */
 async getInterfaceCounters(site) {
    try {
      const [ifacesResult, ethernetResult] = await Promise.all([
        this.getInterfaces(site),
        this.getEthernetInterfaces(site)
      ]);
 
      if (!ifacesResult.success) {
        return { success: false, error: ifacesResult.error };
      }
 
      const speedByName = new Map();
      if (ethernetResult.success) {
        for (const row of ethernetResult.data) {
          if (row.name && row.speed) {
            speedByName.set(row.name, row.speed);
          }
        }
      }
 
      const data = ifacesResult.data
        .filter(row => row.name)
        .map(row => ({
          iface: row.name,
          macAddress: row['mac-address'] || null,
          rxByte: parseInt(row['rx-byte'] || 0, 10),
          txByte: parseInt(row['tx-byte'] || 0, 10),
          ifSpeed: speedByName.get(row.name) || null,
          running: row.running === 'true' || row.running === true,
          disabled: row.disabled === 'true' || row.disabled === true,
          type: row.type || 'unknown'
        }));
 
      return { success: true, data };
    } catch (error) {
      console.error('Failed to get interface counters:', error.message);
      return { success: false, error: error.message };
    }
  }
 



}



// Export singleton instance
module.exports = new MikrotikAPIService();