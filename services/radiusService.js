const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class RadiusService {
  constructor() {
    this.pool = null;
    this.config = {
      host: process.env.RADIUS_DB_HOST || 'localhost',
      port: process.env.RADIUS_DB_PORT || 3306,
      user: process.env.RADIUS_DB_USER || 'radius',
      password: process.env.RADIUS_DB_PASSWORD,
      database: process.env.RADIUS_DB_NAME || 'radius',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    };
  }

  /**
   * Initialize connection pool
   */
  async connect() {
    if (!this.pool) {
      try {
        this.pool = await mysql.createPool(this.config);
        console.log('RADIUS database connected');
      } catch (error) {
        console.error('RADIUS database connection error:', error);
        throw error;
      }
    }
    return this.pool;
  }

  /**
   * Get connection from pool
   */
  async getConnection() {
    if (!this.pool) {
      await this.connect();
    }
    return await this.pool.getConnection();
  }

  /**
   * Kill active session by sending RADIUS disconnect to NAS
   * This forces the user to reconnect with updated settings
   */
  async killUserSession(username) {
    const connection = await this.getConnection();
    const startTime = Date.now();
  
    console.log(`\n🚀 [RADIUS] Starting disconnect for user: ${username}`);
  
    try {
      // 1. Fetch active session
      const [sessions] = await connection.query(
        `SELECT acctsessionid, nasipaddress, framedipaddress 
         FROM radacct 
         WHERE username = ? AND acctstoptime IS NULL 
         LIMIT 1`,
        [username]
      );
  
      console.log(`📡 Session query result:`, sessions);
  
      if (sessions.length === 0) {
        console.log("ℹ️ No active session found");
        return {
          success: true,
          message: 'No active session to disconnect'
        };
      }
  
      const session = sessions[0];
      console.log(`✅ Using session:`, session);
  
      // 2. Get NAS secret
      const [nas] = await connection.query(
        'SELECT nasname, secret FROM nas WHERE nasname = ?',
        [session.nasipaddress]
      );
  
      console.log(`📡 NAS lookup result:`, nas);
  
      if (nas.length === 0) {
        console.error(`❌ NAS not found for IP: ${session.nasipaddress}`);
        return {
          success: false,
          error: 'NAS device not found in database'
        };
      }
  
      const secret = nas[0].secret;
  
      // 3. Build disconnect payload
      const disconnectMessage = `User-Name="${username}"
  Acct-Session-Id="${session.acctsessionid}"
  NAS-IP-Address="${session.nasipaddress}"
  Framed-IP-Address="${session.framedipaddress}"`;
  
      console.log(`📤 Disconnect payload:\n${disconnectMessage}`);
  
      // 4. Build command (with timeout + retries reduced)
      const command = `echo '${disconnectMessage}' | radclient -x -t 2 -r 1 ${session.nasipaddress}:3799 disconnect ${secret}`;
  
      console.log(`🛠️ Executing command:\n${command}`);
  
      // 5. Execute
      const { stdout, stderr } = await execPromise(command);
  
      console.log(`📥 radclient stdout:\n${stdout}`);
      if (stderr) {
        console.error(`⚠️ radclient stderr:\n${stderr}`);
      }
  
      const duration = Date.now() - startTime;
      console.log(`⏱️ Disconnect completed in ${duration}ms`);
  
      // 6. Detect success/failure
      if (stdout.includes('Disconnect-ACK')) {
        console.log(`✅ MikroTik ACK received — session terminated`);
        return {
          success: true,
          message: `Session disconnected for ${username}`
        };
      } else {
        console.warn(`⚠️ No ACK received — MikroTik may not be responding`);
        return {
          success: false,
          message: 'Disconnect sent but no ACK received',
          rawOutput: stdout
        };
      }
  
    } catch (error) {
      const duration = Date.now() - startTime;
  
      console.error(`❌ Kill session error after ${duration}ms:`, error);
  
      if (error.stdout) {
        console.error(`📥 stdout:\n${error.stdout}`);
      }
      if (error.stderr) {
        console.error(`📥 stderr:\n${error.stderr}`);
      }
  
      return {
        success: false,
        error: error.message,
        details: {
          stdout: error.stdout,
          stderr: error.stderr
        }
      };
    } finally {
      connection.release();
    }
  }

  /**
 * Update active user session rate limit via CoA
 * WITHOUT disconnecting the session
 *
 * Flow:
 * 1. Find active session from radacct
 * 2. Find user's current group from radusergroup
 * 3. Fetch Mikrotik-Rate-Limit from radgroupreply
 * 4. Send CoA to MikroTik with new rate limit
 */
async updateUserRateLimit(username) {
  const connection = await this.getConnection();
  const startTime = Date.now();

  console.log(`\n🚀 [RADIUS] Starting CoA rate update for user: ${username}`);

  try {

    // ============================================
    // 1. FETCH ACTIVE SESSION
    // ============================================

    const [sessions] = await connection.query(
      `SELECT acctsessionid, nasipaddress, framedipaddress
       FROM radacct
       WHERE username = ?
       AND acctstoptime IS NULL
       ORDER BY acctstarttime DESC
       LIMIT 1`,
      [username]
    );

    console.log(`📡 Session query result:`, sessions);

    if (sessions.length === 0) {
      console.log(`ℹ️ No active session found`);

      return {
        success: true,
        message: 'No active session found'
      };
    }

    const session = sessions[0];

    // ============================================
    // 2. FETCH USER GROUP
    // ============================================

    const [groups] = await connection.query(
      `SELECT groupname
       FROM radusergroup
       WHERE username = ?
       ORDER BY priority
       LIMIT 1`,
      [username]
    );

    if (groups.length === 0) {
      return {
        success: false,
        error: 'User group not found'
      };
    }

    const groupName = groups[0].groupname;

    console.log(`📦 User group: ${groupName}`);

    // ============================================
    // 3. FETCH RATE LIMIT
    // ============================================

    const [replies] = await connection.query(
      `SELECT value
       FROM radgroupreply
       WHERE groupname = ?
       AND attribute = 'Mikrotik-Rate-Limit'
       LIMIT 1`,
      [groupName]
    );

    if (replies.length === 0) {
      return {
        success: false,
        error: 'Mikrotik-Rate-Limit not found'
      };
    }

    const rateLimit = replies[0].value;

    console.log(`⚡ New rate limit: ${rateLimit}`);

    // ============================================
    // 4. FETCH NAS SECRET
    // ============================================

    const [nas] = await connection.query(
      `SELECT secret
       FROM nas
       WHERE nasname = ?`,
      [session.nasipaddress]
    );

    if (nas.length === 0) {
      return {
        success: false,
        error: 'NAS not found'
      };
    }

    const secret = nas[0].secret;

    // ============================================
    // 5. BUILD CoA PAYLOAD
    // ============================================

    const coaMessage = `User-Name="${username}"
Acct-Session-Id="${session.acctsessionid}"
Mikrotik-Rate-Limit="${rateLimit}"`;

    console.log(`📤 CoA payload:\n${coaMessage}`);

    // ============================================
    // 6. SEND CoA
    // ============================================

    const command =
      `echo '${coaMessage}' | ` +
      `radclient -x -t 2 -r 1 ` +
      `${session.nasipaddress}:3799 coa ${secret}`;

    console.log(`🛠️ Executing command:\n${command}`);

    const { stdout, stderr } = await execPromise(command);

    console.log(`📥 radclient stdout:\n${stdout}`);

    if (stderr) {
      console.error(`⚠️ radclient stderr:\n${stderr}`);
    }

    const duration = Date.now() - startTime;

    console.log(`⏱️ CoA completed in ${duration}ms`);

    // ============================================
    // 7. CHECK RESPONSE
    // ============================================

    if (stdout.includes('CoA-ACK')) {

      console.log(`✅ MikroTik ACK received — rate updated live`);

      return {
        success: true,
        message: `Rate limit updated to ${rateLimit}`
      };

    } else {

      console.warn(`⚠️ No CoA-ACK received`);

      return {
        success: false,
        message: 'CoA sent but no ACK received',
        rawOutput: stdout
      };
    }

  } catch (error) {

    console.error(`❌ CoA update error:`, error);

    return {
      success: false,
      error: error.message,
      details: {
        stdout: error.stdout,
        stderr: error.stderr
      }
    };

  } finally {
    connection.release();
  }
}

  /**
   * Create user account in RADIUS
   */
  async createAccount(customer, packageData) {
    const connection = await this.getConnection();
    
    try {
      await connection.beginTransaction();

      // Insert into radcheck (authentication)
      await connection.query(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES 
         (?, 'Cleartext-Password', ':=', ?)`,
        [customer.pppoe.username, customer.pppoe.password]
      );

      // Insert into radgroupcheck (group membership)
      const groupName = packageData.packageName.replace(/\s+/g, '_').toUpperCase();
      
      await connection.query(
        `INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)`,
        [customer.pppoe.username, groupName]
      );

      // Insert bandwidth limits into radgroupreply if group doesn't exist
      const [existingGroup] = await connection.query(
        'SELECT * FROM radgroupreply WHERE groupname = ? LIMIT 1',
        [groupName]
      );

      if (existingGroup.length === 0) {
        // Mikrotik rate limit format: upload/download
        const rateLimit = `${packageData.speed.upload}M/${packageData.speed.download}M`;
        
        await connection.query(
          `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES 
           (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
          [groupName, rateLimit]
        );
      }

      // Insert MAC address binding if provided
      if (customer.pppoe.macAddress) {
        await connection.query(
          `INSERT INTO radcheck (username, attribute, op, value) VALUES 
           (?, 'Calling-Station-Id', '==', ?)`,
          [customer.pppoe.username, customer.pppoe.macAddress.toUpperCase()]
        );
      }

      await connection.commit();
      
      return {
        success: true,
        message: 'Account created in RADIUS'
      };
    } catch (error) {
      await connection.rollback();
      console.error('RADIUS create account error:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Update user password
   */
  async updatePassword(username, newPassword) {
    const connection = await this.getConnection();
    
    try {
      await connection.query(
        `UPDATE radcheck SET value = ? 
         WHERE username = ? AND attribute = 'Cleartext-Password'`,
        [newPassword, username]
      );

      // Auto-kill session after password change so user reconnects with new password
      await this.killUserSession(username);

      return {
        success: true,
        message: 'Password updated and session disconnected'
      };
    } catch (error) {
      console.error('RADIUS update password error:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Update bandwidth limits
   */
  async updateBandwidth(username, uploadSpeed, downloadSpeed, newGroupName = null) {
    const connection = await this.getConnection();
    
    try {
      await connection.beginTransaction();
  
      // If a new group name is provided, update the user's group
      if (newGroupName) {
        // Update radusergroup to new group
        const [updateResult] = await connection.query(
          `UPDATE radusergroup SET groupname = ? WHERE username = ?`,
          [newGroupName, username]
        );
  
        if (updateResult.affectedRows === 0) {
          // User not found in radusergroup, insert new entry
          await connection.query(
            `INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)`,
            [username, newGroupName]
          );
        }
  
        // Now the user's group is newGroupName
        // Ensure the new group has the correct rate limit
        const rateLimit = `${uploadSpeed}M/${downloadSpeed}M`;
  
        // Check if group already has a rate limit entry
        const [existing] = await connection.query(
          `SELECT * FROM radgroupreply WHERE groupname = ? AND attribute = 'Mikrotik-Rate-Limit'`,
          [newGroupName]
        );
  
        if (existing.length > 0) {
          // Update existing rate limit
          await connection.query(
            `UPDATE radgroupreply SET value = ? WHERE groupname = ? AND attribute = 'Mikrotik-Rate-Limit'`,
            [rateLimit, newGroupName]
          );
        } else {
          // Insert new rate limit for the group
          await connection.query(
            `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
            [newGroupName, rateLimit]
          );
        }
      } else {
        // No group change: update rate limit for current group
        // Get user's current group
        const [userGroups] = await connection.query(
          'SELECT groupname FROM radusergroup WHERE username = ? LIMIT 1',
          [username]
        );
  
        if (userGroups.length === 0) {
          return {
            success: false,
            error: 'User group not found'
          };
        }
  
        const groupName = userGroups[0].groupname;
        const rateLimit = `${uploadSpeed}M/${downloadSpeed}M`;
  
        // Update group rate limit
        const [updateResult] = await connection.query(
          `UPDATE radgroupreply SET value = ? WHERE groupname = ? AND attribute = 'Mikrotik-Rate-Limit'`,
          [rateLimit, groupName]
        );
  
        if (updateResult.affectedRows === 0) {
          // Group didn't have rate limit entry, insert it
          await connection.query(
            `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
            [groupName, rateLimit]
          );
        }
      }
  
      await connection.commit();

      // Auto-kill session after bandwidth change so user gets new speed limits
      await this.updateUserRateLimit(username);
  
      return {
        success: true,
        message: 'Bandwidth updated and session disconnected'
      };
    } catch (error) {
      await connection.rollback();
      console.error('RADIUS update bandwidth error:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Disable account (add to disabled group)
   */
  async disableAccount(username) {
    const connection = await this.getConnection();
    
    try {
      // Change user to disabled group
      await connection.query(
        `UPDATE radusergroup SET groupname = 'DISABLED' 
         WHERE username = ?`,
        [username]
      );

      // Auto-kill session when disabling account
      await this.killUserSession(username);

      return {
        success: true,
        message: 'Account disabled and session disconnected'
      };
    } catch (error) {
      console.error('RADIUS disable account error:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Enable account (restore original group)
   */
  async enableAccount(username, groupName) {
    const connection = await this.getConnection();
    
    try {
      // Change user back to active group
      await connection.query(
        `UPDATE radusergroup SET groupname = ? 
         WHERE username = ?`,
        [groupName, username]
      );

      // Auto-kill any existing session so user can reconnect with enabled status
      await this.killUserSession(username);

      return {
        success: true,
        message: 'Account enabled and ready to connect'
      };
    } catch (error) {
      console.error('RADIUS enable account error:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Delete account completely
   */
  async deleteAccount(username) {
    const connection = await this.getConnection();
    
    try {
      await connection.beginTransaction();

      // Kill session before deleting
      await this.killUserSession(username);

      // Delete from radcheck (authentication)
      await connection.query(
        'DELETE FROM radcheck WHERE username = ?',
        [username]
      );

      // Delete from radusergroup (group membership)
      await connection.query(
        'DELETE FROM radusergroup WHERE username = ?',
        [username]
      );

      // Optionally keep accounting history in radacct for records
      // If you want to delete it:
      // await connection.query('DELETE FROM radacct WHERE username = ?', [username]);

      await connection.commit();

      return {
        success: true,
        message: 'Account deleted from RADIUS'
      };
    } catch (error) {
      await connection.rollback();
      console.error('RADIUS delete account error:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Get user session status
   */
  async getUserSession(username) {
    const connection = await this.getConnection();
    
    try {
      const [sessions] = await connection.query(
        `SELECT acctsessionid, acctstarttime, framedipaddress, 
                nasipaddress, acctinputoctets, acctoutputoctets, 
                acctsessiontime
         FROM radacct 
         WHERE username = ? AND acctstoptime IS NULL 
         ORDER BY acctstarttime DESC 
         LIMIT 1`,
        [username]
      );

      if (sessions.length > 0) {
        const session = sessions[0];
        return {
          success: true,
          isOnline: true,
          sessionId: session.acctsessionid,
          startTime: session.acctstarttime,
          ipAddress: session.framedipaddress,
          nasIpAddress: session.nasipaddress,
          uploadBytes: parseInt(session.acctinputoctets || 0),
          downloadBytes: parseInt(session.acctoutputoctets || 0),
          sessionTime: parseInt(session.acctsessiontime || 0)
        };
      } else {
        return {
          success: true,
          isOnline: false
        };
      }
    } catch (error) {
      console.error('RADIUS get session error:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Get user usage statistics
   */
/**
 * Get user usage statistics for a given date range
 * @param {string} username - PPPoE username
 * @param {Date} dateFrom - Start date (optional)
 * @param {Date} dateTo - End date (optional)
 * @returns {Promise<Object>}
 */
async getUserUsageStats(username, dateFrom, dateTo) {
  const connection = await this.getConnection();
  try {
    let query = `
      SELECT 
        COUNT(*) as sessions,
        SUM(acctinputoctets) as totalUpload,
        SUM(acctoutputoctets) as totalDownload,
        SUM(acctsessiontime) as totalTime
      FROM radacct 
      WHERE username = ?
    `;
    const params = [username];
    if (dateFrom) {
      query += ' AND acctstarttime >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ' AND acctstarttime <= ?';
      params.push(dateTo);
    }
    const [results] = await connection.query(query, params);
    const stats = results[0];
    const up = parseInt(stats.totalUpload || 0);
    const down = parseInt(stats.totalDownload || 0);
    const time = parseInt(stats.totalTime || 0);
    return {
      success: true,
      sessions: stats.sessions || 0,
      uploadGB: (up / (1024 ** 3)).toFixed(2),
      downloadGB: (down / (1024 ** 3)).toFixed(2),
      totalGB: ((up + down) / (1024 ** 3)).toFixed(2),
      totalTime: time
    };
  } catch (error) {
    console.error('RADIUS get usage stats error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

  /**
   * Get all active sessions
   */
  async getActiveSessions(nasIpAddress = null) {
    const connection = await this.getConnection();
    
    try {
      let query = `
        SELECT username, acctsessionid, acctstarttime, 
               framedipaddress, nasipaddress, 
               acctinputoctets, acctoutputoctets, acctsessiontime
        FROM radacct 
        WHERE acctstoptime IS NULL
      `;

      const params = [];

      if (nasIpAddress) {
        query += ' AND nasipaddress = ?';
        params.push(nasIpAddress);
      }

      query += ' ORDER BY acctstarttime DESC';

      const [sessions] = await connection.query(query, params);

      return {
        success: true,
        count: sessions.length,
        sessions: sessions.map(s => ({
          username: s.username,
          sessionId: s.acctsessionid,
          startTime: s.acctstarttime,
          ipAddress: s.framedipaddress,
          nasIpAddress: s.nasipaddress,
          uploadBytes: parseInt(s.acctinputoctets || 0),
          downloadBytes: parseInt(s.acctoutputoctets || 0),
          sessionTime: parseInt(s.acctsessiontime || 0)
        }))
      };
    } catch (error) {
      console.error('RADIUS get active sessions error:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Disconnect user session (legacy method - logs to radpostauth)
   * Use killUserSession() for actual session termination
   */
  async disconnectUser(username) {
    const connection = await this.getConnection();
    
    try {
      // This is handled by Mikrotik, but we can log it
      await connection.query(
        `INSERT INTO radpostauth (username, pass, reply, authdate) 
         VALUES (?, '', 'Disconnect-Request', NOW())`,
        [username]
      );

      return {
        success: true,
        message: 'Disconnect request logged in RADIUS'
      };
    } catch (error) {
      console.error('RADIUS disconnect user error:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      connection.release();
    }
  }


  /**
 * Register or update a NAS (Network Access Server) in the RADIUS database
 * @param {string} nasIp - IP address of the MikroTik router
 * @param {string} secret - Shared secret (must match router's RADIUS secret)
 * @param {string} shortName - Optional friendly name (default: nasIp)
 * @returns {Promise<Object>} { success, message, error? }
 */
  async registerNas(nasIp, secret, shortName = null) {
    const connection = await this.getConnection();
    try {
      const name = shortName || nasIp;
      const [existing] = await connection.query('SELECT id FROM nas WHERE nasname = ?', [nasIp]);
      if (existing.length > 0) {
        await connection.query(
          'UPDATE nas SET secret = ?, shortname = ?, type = "mikrotik" WHERE nasname = ?',
          [secret, name, nasIp]
        );
      } else {
        await connection.query(
          'INSERT INTO nas (nasname, shortname, type, secret) VALUES (?, ?, "mikrotik", ?)',
          [nasIp, name, secret]
        );
      }
      return { success: true, message: `NAS ${nasIp} registered/updated` };
    } catch (error) {
      console.error('RADIUS register NAS error:', error);
      return { success: false, error: error.message };
    } finally {
      connection.release();
    }
  }


  /**
 * Add a NAS client to FreeRADIUS clients.conf
 * @param {string} nasname - IP address of the NAS
 * @param {string} secret - RADIUS shared secret
 * @param {string} shortname - Short name for the client
 * @param {string} type - NAS type (default 'mikrotik')
 * @returns {Promise<{success: boolean, message: string}>}
 */
async  addClientToConfig(nasname, secret, shortname, type = 'mikrotik') {
  const configPath = '/etc/freeradius/3.0/clients.conf';
  const clientEntry = `
client ${shortname} {
    ipaddr = ${nasname}
    secret = ${secret}
    shortname = ${shortname}
    nastype = ${type}
}
`;

  try {
    // Read current config
    const data = await fs.readFile(configPath, 'utf8');
    
    // Check if client already exists (by ipaddr)
    const ipPattern = new RegExp(`ipaddr\\s*=\\s*${nasname.replace(/\./g, '\\.')}`, 'i');
    if (ipPattern.test(data)) {
      return { success: false, message: `Client with IP ${nasname} already exists in config` };
    }

    // Append new client entry
    await fs.appendFile(configPath, clientEntry);
    
    // Test configuration
    const { stderr: testErr } = await execPromise('freeradius -C');
    if (testErr) {
      // Rollback: remove the appended entry
      const newData = await fs.readFile(configPath, 'utf8');
      const updated = newData.replace(clientEntry, '');
      await fs.writeFile(configPath, updated);
      return { success: false, message: `Configuration test failed: ${testErr}` };
    }

    // Restart FreeRADIUS service
    await execPromise('sudo systemctl restart freeradius');
    return { success: true, message: `Client ${shortname} added and RADIUS restarted` };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * Check if IP belongs to a CIDR range
 */
isIpInCidr(ip, cidr) {
  if (!ip || !cidr) return false;
  try {
    const [range, bits] = cidr.split('/');
    const mask = ~((1 << (32 - parseInt(bits))) - 1);
    const ipLong = ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
    const rangeLong = range.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
    return (ipLong & mask) === (rangeLong & mask);
  } catch (e) {
    console.error('CIDR check error:', e);
    return false;
  }
} 

/**
 * Get detailed session status including disabled pool check and auth failures
 * @param {string} username - PPPoE username
 * @returns {Promise<Object>} 
 */
async getUserConnectionStatus(username, expectedNasIp = null) {
  const connection = await this.getConnection();
  const disabledPoolCidr = process.env.DISABLED_POOL_CIDR || '10.254.254.0/24';

  try {
    // 1. Check active session (any NAS)
    const [sessions] = await connection.query(
      `SELECT acctsessionid, acctstarttime, framedipaddress, 
              nasipaddress, acctinputoctets, acctoutputoctets, 
              acctsessiontime, callingstationid
       FROM radacct 
       WHERE username = ? AND acctstoptime IS NULL 
       ORDER BY acctstarttime DESC 
       LIMIT 1`,
      [username]
    );

    if (sessions.length > 0) {
      const session = sessions[0];
      const assignedIp = session.framedipaddress;
      const inDisabledPool = this.isIpInCidr(assignedIp, disabledPoolCidr);
      const isOnDifferentNas = expectedNasIp && session.nasipaddress !== expectedNasIp;
      const callingMac = session.callingstationid;

      if (inDisabledPool) {
        return {
          success: true,
          isOnline: false,
          isOnlineNoInternet: true,
          reason: 'IP assigned from disabled pool (no internet)',
          sessionId: session.acctsessionid,
          startTime: session.acctstarttime,
          ipAddress: assignedIp,
          nasIpAddress: session.nasipaddress,
          isOnDifferentNas,
          uploadBytes: parseInt(session.acctinputoctets || 0),
          downloadBytes: parseInt(session.acctoutputoctets || 0),
          sessionTime: parseInt(session.acctsessiontime || 0),
          callingMac
        };
      } else {
        return {
          success: true,
          isOnline: true,
          isOnlineNoInternet: false,
          reason: null,
          sessionId: session.acctsessionid,
          startTime: session.acctstarttime,
          ipAddress: assignedIp,
          nasIpAddress: session.nasipaddress,
          isOnDifferentNas,
          uploadBytes: parseInt(session.acctinputoctets || 0),
          downloadBytes: parseInt(session.acctoutputoctets || 0),
          sessionTime: parseInt(session.acctsessiontime || 0),
          callingMac
        };
      }
    }

    // 2. No active session – get last auth success and failure
    const [lastSuccess] = await connection.query(
      `SELECT authdate FROM radpostauth 
       WHERE username = ? AND reply = 'Access-Accept' 
       ORDER BY authdate DESC LIMIT 1`,
      [username]
    );
    const [lastFailure] = await connection.query(
      `SELECT pass, authdate, reply FROM radpostauth 
       WHERE username = ? AND reply = 'Access-Reject' 
       ORDER BY authdate DESC LIMIT 1`,
      [username]
    );

    const lastSuccessDate = lastSuccess[0]?.authdate || null;
    const lastFailureDate = lastFailure[0]?.authdate || null;

    // Determine if the last event is a failure and no success after it
    let authFailure = null;
    if (lastFailureDate && (!lastSuccessDate || lastFailureDate > lastSuccessDate)) {
      authFailure = {
        attemptedPassword: lastFailure[0].pass,
        timestamp: lastFailure[0].authdate,
        reply: lastFailure[0].reply
      };
    }

    return {
      success: true,
      isOnline: false,
      isOnlineNoInternet: false,
      reason: authFailure ? 'Authentication failed' : 'No active session',
      authFailure,
      lastSuccessAuth: lastSuccessDate,
      lastFailureAuth: lastFailureDate
    };

  } catch (error) {
    console.error('RADIUS get connection status error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Get connection status for multiple usernames in one query
 * @param {string[]} usernames - Array of PPPoE usernames
 * @param {Object} expectedNasIpMap - Optional mapping of username -> expected NAS IP
 * @returns {Promise<Object>} { [username]: { isOnline, isOnlineNoInternet, ipAddress, nasIpAddress, reason, sessionTime, startTime, callingMac } }
 */
async getBulkUserConnectionStatus(usernames, expectedNasIpMap = {}) {
  if (!usernames || usernames.length === 0) return {};
  const connection = await this.getConnection();
  const expiredPoolCidr = process.env.DISABLED_POOL_CIDR || '10.254.254.0/24';
  try {
    const placeholders = usernames.map(() => '?').join(',');
    const [sessions] = await connection.query(
      `SELECT username, acctsessionid, acctstarttime, framedipaddress,
              nasipaddress, acctinputoctets, acctoutputoctets,
              acctsessiontime, callingstationid
       FROM radacct
       WHERE username IN (${placeholders}) AND acctstoptime IS NULL
       ORDER BY acctstarttime DESC`,
      usernames
    );

    const activeMap = new Map();
    for (const sess of sessions) {
      if (!activeMap.has(sess.username)) {
        activeMap.set(sess.username, sess);
      }
    }

    const results = {};
    for (const username of usernames) {
      const session = activeMap.get(username);
      if (session) {
        const assignedIp = session.framedipaddress;
        const expectedNasIp = expectedNasIpMap[username] || null;
        const isOnDifferentNas = expectedNasIp && session.nasipaddress !== expectedNasIp;
        let statusType = 'online'; // default
        let reason = null;

        // Check expired pool (10.254.254.0/24)
        if (this.isIpInCidr(assignedIp, expiredPoolCidr)) {
          statusType = 'expired';
          reason = 'Account disabled (expired/paused)';
        }
        // Check wrong password pool (20.20.0.0/16)
        else if (assignedIp && assignedIp.startsWith('20.20.')) {
          statusType = 'wrong-password';
          reason = 'Wrong password';
        }
        // Check non-existent user pool (30.30.0.0/16)
        else if (assignedIp && assignedIp.startsWith('30.30.')) {
          statusType = 'non-existent';
          reason = 'User does not exist in RADIUS';
        }
        // Check MAC mismatch pool (40.40.0.0/16)
        else if (assignedIp && assignedIp.startsWith('40.40.')) {
          statusType = 'mac-mismatch';
          reason = 'MAC address mismatch';
        }

        if (statusType !== 'online') {
          results[username] = {
            isOnline: false,
            isOnlineNoInternet: true,
            reason,
            sessionId: session.acctsessionid,
            startTime: session.acctstarttime,
            ipAddress: assignedIp,
            nasIpAddress: session.nasipaddress,
            isOnDifferentNas,
            sessionTime: parseInt(session.acctsessiontime || 0),
            callingMac: session.callingstationid,
            statusType // add for debugging/frontend
          };
        } else {
          results[username] = {
            isOnline: true,
            isOnlineNoInternet: false,
            reason: null,
            sessionId: session.acctsessionid,
            startTime: session.acctstarttime,
            ipAddress: assignedIp,
            nasIpAddress: session.nasipaddress,
            isOnDifferentNas,
            sessionTime: parseInt(session.acctsessiontime || 0),
            callingMac: session.callingstationid
          };
        }
      } else {
        results[username] = {
          isOnline: false,
          isOnlineNoInternet: false,
          reason: 'No active session',
          ipAddress: null,
          nasIpAddress: null,
          sessionTime: 0
        };
      }
    }
    return results;
  } catch (error) {
    console.error('RADIUS bulk get connection status error:', error);
    const fallback = {};
    for (const username of usernames) {
      fallback[username] = { isOnline: false, isOnlineNoInternet: false, reason: 'Query failed', ipAddress: null };
    }
    return fallback;
  } finally {
    connection.release();
  }
}


/**
 * Get active session by IP address (used by redirect server)
 * @param {string} ipAddress - Framed IP address from radacct
 * @returns {Promise<Object|null>}
 */
async getActiveSessionByIp(ipAddress) {
  const connection = await this.getConnection();
  try {
      const [rows] = await connection.query(
          `SELECT username, framedipaddress, nasipaddress, acctstarttime
           FROM radacct 
           WHERE framedipaddress = ? AND acctstoptime IS NULL
           ORDER BY acctstarttime DESC
           LIMIT 1`,
          [ipAddress]
      );
      return rows[0] || null;
  } finally {
      connection.release();
  }
}

/**
* Get last authentication attempt for a username
* @param {string} username
* @returns {Promise<Object|null>} { reply, pass, authdate }
*/
async getLastAuthAttempt(username) {
  const connection = await this.getConnection();
  try {
      const [rows] = await connection.query(
          `SELECT reply, pass, authdate
           FROM radpostauth
           WHERE username = ?
           ORDER BY authdate DESC
           LIMIT 1`,
          [username]
      );
      return rows[0] || null;
  } finally {
      connection.release();
  }
}

/**
* Determine if an active session (by IP) is due to wrong password
* @param {string} ipAddress
* @returns {Promise<{isWrongPassword: boolean, username?: string, lastAuth?: Object}>}
*/
async isWrongPasswordSession(ipAddress) {
  const session = await this.getActiveSessionByIp(ipAddress);
  if (!session) return { isWrongPassword: false };

  const lastAuth = await this.getLastAuthAttempt(session.username);
  // If the last authentication was a reject, and the session exists (thanks to our override),
  // then this session is the result of a wrong password.
  const isWrong = lastAuth && lastAuth.reply === 'Access-Reject';
  return {
      isWrongPassword: isWrong,
      username: session.username,
      lastAuth
  };
}

// Add after the disableAccount method or near other MAC-related code

/**
 * Update MAC binding for a user
 * @param {string} username - PPPoE username
 * @param {string} newMacAddress - New MAC address (format: XX:XX:XX:XX:XX:XX)
 * @returns {Promise<Object>}
 */
async updateMacBinding(username, newMacAddress) {
  const connection = await this.getConnection();
  try {
    // Normalize MAC: uppercase, colons
    const normalizedMac = newMacAddress ? newMacAddress.toUpperCase().replace(/[^A-F0-9]/g, '').replace(/(..)/g, '$1:').slice(0, 17) : null;
    
    // Remove old MAC binding (if any)
    await connection.query(
      `DELETE FROM radcheck WHERE username = ? AND attribute = 'Calling-Station-Id'`,
      [username]
    );
    
    // Insert new MAC binding if provided
    if (normalizedMac) {
      await connection.query(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Calling-Station-Id', '==', ?)`,
        [username, normalizedMac]
      );
    }
    
    // Optionally kill session to force re-authentication with new MAC
    await this.killUserSession(username);
    
    return { success: true, message: 'MAC binding updated' };
  } catch (error) {
    console.error('RADIUS update MAC binding error:', error);
    return { success: false, error: error.message };
  } finally {
    connection.release();
  }
}

/**
 * Clear MAC binding for a user (remove restriction)
 * @param {string} username
 * @returns {Promise<Object>}
 */
async clearMacBinding(username) {
  const connection = await this.getConnection();
  try {
    await connection.query(
      `DELETE FROM radcheck WHERE username = ? AND attribute = 'Calling-Station-Id'`,
      [username]
    );
    // Kill session to allow reconnection without MAC check
    await this.killUserSession(username);
    return { success: true, message: 'MAC binding cleared' };
  } catch (error) {
    console.error('RADIUS clear MAC binding error:', error);
    return { success: false, error: error.message };
  } finally {
    connection.release();
  }
}

/**
 * Ensure RADIUS groups (normal and throttled) exist for a package
 */
async ensurePackageGroups(packageDoc) {
  const connection = await this.getConnection();
  try {
    const normalGroup = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();
    const throttledGroup = `THROTTLED_${normalGroup}`;
    const normalRate = `${packageDoc.speed.upload}M/${packageDoc.speed.download}M`;
    const throttleRate = `${packageDoc.fup.throttleUploadMbps}M/${packageDoc.fup.throttleDownloadMbps}M`;

    // Update or insert normal group rate limit
    const [existingNormal] = await connection.query(
      'SELECT id FROM radgroupreply WHERE groupname = ? AND attribute = "Mikrotik-Rate-Limit" LIMIT 1',
      [normalGroup]
    );
    if (existingNormal.length) {
      await connection.query(
        'UPDATE radgroupreply SET value = ? WHERE groupname = ? AND attribute = "Mikrotik-Rate-Limit"',
        [normalRate, normalGroup]
      );
    } else {
      await connection.query(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
        [normalGroup, normalRate]
      );
    }

    // Update or insert Acct-Interim-Interval for normal group (300 seconds = 5 minutes)
    const [existingInterval] = await connection.query(
      'SELECT id FROM radgroupreply WHERE groupname = ? AND attribute = "Acct-Interim-Interval" LIMIT 1',
      [normalGroup]
    );
    if (existingInterval.length) {
      await connection.query(
        'UPDATE radgroupreply SET value = ? WHERE groupname = ? AND attribute = "Acct-Interim-Interval"',
        ['300', normalGroup]
      );
    } else {
      await connection.query(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Acct-Interim-Interval', ':=', '300')`,
        [normalGroup]
      );
    }

    // Update or insert throttled group if FUP enabled
    if (packageDoc.fup?.enabled) {
      const [existingThrottled] = await connection.query(
        'SELECT id FROM radgroupreply WHERE groupname = ? AND attribute = "Mikrotik-Rate-Limit" LIMIT 1',
        [throttledGroup]
      );
      if (existingThrottled.length) {
        await connection.query(
          'UPDATE radgroupreply SET value = ? WHERE groupname = ? AND attribute = "Mikrotik-Rate-Limit"',
          [throttleRate, throttledGroup]
        );
      } else {
        await connection.query(
          `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
          [throttledGroup, throttleRate]
        );
      }
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to ensure RADIUS groups:', error);
    return { success: false, error: error.message };
  } finally {
    connection.release();
  }
}


/**
 * Enable FUP for a customer (insert Max-Monthly-Traffic into radcheck)
 * @param {string} username - PPPoE username
 * @param {number} quotaBytes - Data threshold in bytes
 * @returns {Promise<Object>}
 */
async enableFUPForCustomer(username, quotaBytes) {
  const connection = await this.getConnection();
  try {
    await connection.query(
      `INSERT INTO radcheck (username, attribute, op, value) VALUES 
       (?, 'Max-Monthly-Traffic', ':=', ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [username, quotaBytes]
    );
    // Force re-authentication to apply new quota
    await this.killUserSession(username);
    return { success: true };
  } catch (error) {
    console.error(`Failed to enable FUP for ${username}:`, error);
    return { success: false, error: error.message };
  } finally {
    connection.release();
  }
}

/**
 * Disable FUP for a customer (remove Max-Monthly-Traffic from radcheck)
 * @param {string} username - PPPoE username
 * @param {string} normalGroup - Optional: group to switch the user back to (e.g., '10MBPS_HOME')
 * @returns {Promise<Object>}
 */
async disableFUPForCustomer(username, normalGroup = null) {
  const connection = await this.getConnection();
  try {
    await connection.query(
      `DELETE FROM radcheck WHERE username = ? AND attribute = 'Max-Monthly-Traffic'`,
      [username]
    );
    // If a normal group is provided, ensure the user is in that group (in case they were throttled)
    if (normalGroup) {
      await this.enableAccount(username, normalGroup);
    }

    await this.killUserSession(username);
    return { success: true };
  } catch (error) {
    console.error(`Failed to disable FUP for ${username}:`, error);
    return { success: false, error: error.message };
  } finally {
    connection.release();
  }
}

/**
 * Set or update the billing cycle start date for a user
 * @param {string} username - PPPoE username
 * @param {Date} startDate - New start date
 */
async setBillingCycleStart(username, startDate) {
  const connection = await this.getConnection();
  try {
    const formattedDate = startDate.toISOString().slice(0, 10);
    await connection.query(
      `INSERT INTO user_billing_cycle (username, cycle_start) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE cycle_start = VALUES(cycle_start)`,
      [username, formattedDate]
    );
    return { success: true };
  } catch (error) {
    console.error(`Failed to set billing cycle start for ${username}:`, error);
    return { success: false, error: error.message };
  } finally {
    connection.release();
  }
}

/**
 * Get billing cycle start date for a user
 * @param {string} username
 * @returns {Promise<Date|null>}
 */
async getBillingCycleStart(username) {
  const connection = await this.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT cycle_start FROM user_billing_cycle WHERE username = ?`,
      [username]
    );
    return rows.length ? rows[0].cycle_start : null;
  } finally {
    connection.release();
  }
}


// ============================================
// RADIUS SERVICE - OVERRIDE & TEMPORARY GROUPS
// Add these functions to radiusService.js class
// ============================================

/**
 * Create temporary override group for burst speed
 * @param {string} username - PPPoE username
 * @param {string} overrideGroupName - Unique temporary group name
 * @param {number} uploadSpeed - Upload speed in Mbps
 * @param {number} downloadSpeed - Download speed in Mbps
 */
async createTemporaryOverrideGroup(username, overrideGroupName, uploadSpeed, downloadSpeed) {
  const connection = await this.getConnection();
  
  try {
    await connection.beginTransaction();

    // 1. Create the override group with specified speeds
    const rateLimit = `${uploadSpeed}M/${downloadSpeed}M`;
    
    await connection.query(
      `INSERT INTO radgroupreply (groupname, attribute, op, value) 
       VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
      [overrideGroupName, rateLimit]
    );

    // 2. Switch user to override group
    const [updateResult] = await connection.query(
      `UPDATE radusergroup SET groupname = ? WHERE username = ?`,
      [overrideGroupName, username]
    );

    if (updateResult.affectedRows === 0) {
      // User not in radusergroup, insert
      await connection.query(
        `INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)`,
        [username, overrideGroupName]
      );
    }

    await connection.commit();

    // 3. Kill session to apply new speeds
    await this.updateUserRateLimit(username);

    return {
      success: true,
      message: `Override group created: ${uploadSpeed}M↑/${downloadSpeed}M↓`,
      groupName: overrideGroupName
    };
  } catch (error) {
    await connection.rollback();
    console.error('RADIUS create override group error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Remove temporary override group and restore original package
 * @param {string} username - PPPoE username
 * @param {string} overrideGroupName - Temporary group to remove
 * @param {string} originalGroupName - Original package group to restore
 */
async removeTemporaryOverrideGroup(username, overrideGroupName, originalGroupName) {
  const connection = await this.getConnection();
  
  try {
    await connection.beginTransaction();

    // 1. Switch user back to original group
    await connection.query(
      `UPDATE radusergroup SET groupname = ? WHERE username = ?`,
      [originalGroupName, username]
    );

    // 2. Delete the temporary override group
    await connection.query(
      `DELETE FROM radgroupreply WHERE groupname = ?`,
      [overrideGroupName]
    );

    await connection.commit();

    // 3. Kill session to apply restored speeds
    await this.updateUserRateLimit(username);

    return {
      success: true,
      message: `Override removed, restored to ${originalGroupName}`
    };
  } catch (error) {
    await connection.rollback();
    console.error('RADIUS remove override group error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Get all temporary override groups (for cleanup)
 * Returns groups that start with "OVERRIDE_"
 */
async getTemporaryOverrideGroups() {
  const connection = await this.getConnection();
  
  try {
    const [groups] = await connection.query(
      `SELECT DISTINCT groupname FROM radgroupreply 
       WHERE groupname LIKE 'OVERRIDE_%'`
    );

    return {
      success: true,
      groups: groups.map(g => g.groupname)
    };
  } catch (error) {
    console.error('RADIUS get override groups error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Clean up expired override groups
 * This should be called by a cron job
 * @param {Array<string>} expiredGroupNames - Array of group names to clean
 */
async cleanupExpiredOverrides(expiredGroupNames) {
  const connection = await this.getConnection();
  const results = {
    success: [],
    failed: []
  };
  
  try {
    for (const groupName of expiredGroupNames) {
      try {
        // Get users in this group
        const [users] = await connection.query(
          'SELECT username FROM radusergroup WHERE groupname = ?',
          [groupName]
        );

        // Delete the group
        await connection.query(
          'DELETE FROM radgroupreply WHERE groupname = ?',
          [groupName]
        );

        results.success.push({
          groupName,
          usersAffected: users.length
        });

        console.log(`✅ Cleaned up override group: ${groupName} (${users.length} users)`);
      } catch (error) {
        results.failed.push({
          groupName,
          error: error.message
        });
        console.error(`❌ Failed to cleanup ${groupName}:`, error);
      }
    }

    return {
      success: true,
      results
    };
  } catch (error) {
    console.error('RADIUS cleanup expired overrides error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Check if user has an active override
 * @param {string} username - PPPoE username
 */
async getUserOverrideStatus(username) {
  const connection = await this.getConnection();
  
  try {
    const [userGroups] = await connection.query(
      'SELECT groupname FROM radusergroup WHERE username = ? LIMIT 1',
      [username]
    );

    if (userGroups.length === 0) {
      return {
        success: true,
        hasOverride: false
      };
    }

    const groupName = userGroups[0].groupname;
    const hasOverride = groupName.startsWith('OVERRIDE_');

    if (hasOverride) {
      // Get override speeds
      const [groupReply] = await connection.query(
        `SELECT value FROM radgroupreply 
         WHERE groupname = ? AND attribute = 'Mikrotik-Rate-Limit'`,
        [groupName]
      );

      if (groupReply.length > 0) {
        const rateLimit = groupReply[0].value;
        const [upload, download] = rateLimit.split('/').map(s => s.replace('M', ''));

        return {
          success: true,
          hasOverride: true,
          overrideGroup: groupName,
          uploadSpeed: parseInt(upload),
          downloadSpeed: parseInt(download)
        };
      }
    }

    return {
      success: true,
      hasOverride: false,
      currentGroup: groupName
    };
  } catch (error) {
    console.error('RADIUS get override status error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Batch update multiple users to a new group
 * Useful for bulk package changes
 * @param {Array<string>} usernames - Array of PPPoE usernames
 * @param {string} newGroupName - Target group name
 */
async batchUpdateUserGroups(usernames, newGroupName) {
  const connection = await this.getConnection();
  const results = {
    success: [],
    failed: []
  };
  
  try {
    await connection.beginTransaction();

    for (const username of usernames) {
      try {
        await connection.query(
          `UPDATE radusergroup SET groupname = ? WHERE username = ?`,
          [newGroupName, username]
        );

        results.success.push(username);

        // Kill session to apply changes
        await this.killUserSession(username);
      } catch (error) {
        results.failed.push({
          username,
          error: error.message
        });
      }
    }

    await connection.commit();

    return {
      success: true,
      results,
      totalSuccess: results.success.length,
      totalFailed: results.failed.length
    };
  } catch (error) {
    await connection.rollback();
    console.error('RADIUS batch update groups error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Get current group and speeds for a user
 * @param {string} username - PPPoE username
 */
async getUserCurrentPackage(username) {
  const connection = await this.getConnection();
  
  try {
    // Get user's group
    const [userGroups] = await connection.query(
      'SELECT groupname FROM radusergroup WHERE username = ? LIMIT 1',
      [username]
    );

    if (userGroups.length === 0) {
      return {
        success: false,
        error: 'User not found in RADIUS'
      };
    }

    const groupName = userGroups[0].groupname;

    // Get group's rate limit
    const [groupReply] = await connection.query(
      `SELECT value FROM radgroupreply 
       WHERE groupname = ? AND attribute = 'Mikrotik-Rate-Limit'`,
      [groupName]
    );

    if (groupReply.length === 0) {
      return {
        success: true,
        groupName,
        rateLimit: null,
        uploadSpeed: null,
        downloadSpeed: null
      };
    }

    const rateLimit = groupReply[0].value;
    const [upload, download] = rateLimit.split('/').map(s => s.replace('M', ''));

    return {
      success: true,
      groupName,
      rateLimit,
      uploadSpeed: parseInt(upload),
      downloadSpeed: parseInt(download),
      isOverride: groupName.startsWith('OVERRIDE_')
    };
  } catch (error) {
    console.error('RADIUS get user package error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Update user's MAC address binding
 * @param {string} username - PPPoE username
 * @param {string} newMacAddress - New MAC address (or null to remove binding)
 */
async updateMacAddressBinding(username, newMacAddress) {
  const connection = await this.getConnection();
  
  try {
    await connection.beginTransaction();

    // Remove existing MAC binding
    await connection.query(
      `DELETE FROM radcheck 
       WHERE username = ? AND attribute = 'Calling-Station-Id'`,
      [username]
    );

    // Add new MAC binding if provided
    if (newMacAddress) {
      const formattedMac = newMacAddress.toUpperCase().replace(/[:-]/g, '');
      const macWithColons = formattedMac.match(/.{1,2}/g).join(':');

      await connection.query(
        `INSERT INTO radcheck (username, attribute, op, value) 
         VALUES (?, 'Calling-Station-Id', '==', ?)`,
        [username, macWithColons]
      );
    }

    await connection.commit();

    // Kill session to apply changes
    await this.killUserSession(username);

    return {
      success: true,
      message: newMacAddress 
        ? `MAC binding updated to ${newMacAddress}` 
        : 'MAC binding removed'
    };
  } catch (error) {
    await connection.rollback();
    console.error('RADIUS update MAC binding error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

// Export note: Add these functions to the RadiusService class in radiusService.js


/**
 * Apply burst speed override for a user
 * @param {string} username
 * @param {string} originalGroup - User's normal package group
 * @param {number} uploadMbps
 * @param {number} downloadMbps
 * @param {string} burstGroupName - e.g., "BURST_username_timestamp"
 */
async applyBurstOverride(username, originalGroup, uploadMbps, downloadMbps, burstGroupName) {
  const connection = await this.getConnection();
  try {
    await connection.beginTransaction();

    // Create burst group with specified speeds
    const rateLimit = `${uploadMbps}M/${downloadMbps}M`;
    await connection.query(
      `INSERT INTO radgroupreply (groupname, attribute, op, value) 
       VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
      [burstGroupName, rateLimit]
    );

    // Move user to burst group
    await connection.query(
      `UPDATE radusergroup SET groupname = ? WHERE username = ?`,
      [burstGroupName, username]
    );

    await connection.commit();

    // Kill session to apply new speed
    await this.updateUserRateLimit(username);

    return { success: true };
  } catch (error) {
    await connection.rollback();
    console.error('applyBurstOverride error:', error);
    return { success: false, error: error.message };
  } finally {
    connection.release();
  }
}

/**
 * Remove burst override and restore original group
 */
async removeBurstOverride(username, originalGroup, burstGroupName) {
  const connection = await this.getConnection();
  try {
    await connection.beginTransaction();

    // Restore user to original group
    await connection.query(
      `UPDATE radusergroup SET groupname = ? WHERE username = ?`,
      [originalGroup, username]
    );

    // Delete burst group
    await connection.query(
      `DELETE FROM radgroupreply WHERE groupname = ?`,
      [burstGroupName]
    );

    await connection.commit();

    await this.updateUserRateLimit(username);

    return { success: true };
  } catch (error) {
    await connection.rollback();
    console.error('removeBurstOverride error:', error);
    return { success: false, error: error.message };
  } finally {
    connection.release();
  }
}




/**
 * ====================================
 * HOTSPOT USER MANAGEMENT FUNCTIONS
 * ====================================
 */

/**
 * Create RADIUS account for hotspot user (MAC-based)
 * @param {string} macAddress - User's MAC address (will be used as identifier)
 * @param {string} packageGroupName - RADIUS group name (e.g., "10Mbps", "20Mbps")
 * @param {number} dataLimitMB - Data limit in MB (optional)
 * @param {Date} expiryDate - Session expiry date
 * @returns {Object} { success, username, password }
 */
async createHotspotAccount(macAddress, packageGroupName, dataLimitMB = null, expiryDate = null) {
  const connection = await this.getConnection();
  
  try {
    await connection.beginTransaction();

    // Generate username from MAC address
    const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();
    const username = `hs_${cleanMac}`; // e.g., hs_F09FC2E46AB1
    
    // Generate random password
    const crypto = require('crypto');
    const password = crypto.randomBytes(12).toString('hex');

    console.log(`\n🆕 [RADIUS] Creating hotspot account for MAC: ${macAddress}`);
    console.log(`   Username: ${username}`);

    // 1. Check if account already exists
    const [existing] = await connection.query(
      'SELECT username FROM radcheck WHERE username = ? LIMIT 1',
      [username]
    );

    if (existing.length > 0) {
      // Account exists - delete old one and create new
      console.log(`⚠️  Account exists - removing old account first`);
      await this.deleteHotspotAccount(macAddress);
    }

    // 2. Insert username & password
    await connection.query(
      `INSERT INTO radcheck (username, attribute, op, value) 
       VALUES (?, 'Cleartext-Password', ':=', ?)`,
      [username, password]
    );

    // 3. Bind to MAC address (CRITICAL for hotspot)
    const formattedMac = macAddress.toUpperCase().replace(/[:-]/g, '');
    const macWithColons = formattedMac.match(/.{1,2}/g).join(':');
    
    await connection.query(
      `INSERT INTO radcheck (username, attribute, op, value) 
       VALUES (?, 'Calling-Station-Id', '==', ?)`,
      [username, macWithColons]
    );

    console.log(`   MAC Binding: ${macWithColons}`);

    // 4. Assign to speed group
    await connection.query(
      `INSERT INTO radusergroup (username, groupname, priority) 
       VALUES (?, ?, 1)`,
      [username, packageGroupName]
    );

    console.log(`   Package Group: ${packageGroupName}`);

    // 5. Set data limit if provided
    if (dataLimitMB && dataLimitMB > 0) {
      const bytesLimit = dataLimitMB * 1024 * 1024; // Convert MB to bytes
      await connection.query(
        `INSERT INTO radcheck (username, attribute, op, value) 
         VALUES (?, 'Max-Monthly-Traffic', ':=', ?)`,
        [username, bytesLimit]
      );

      console.log(`   Data Limit: ${dataLimitMB}MB`);
    }

    // 6. Set expiry date if provided
    if (expiryDate) {
      const expiryString = expiryDate.toISOString().slice(0, 19).replace('T', ' ');
      await connection.query(
        `INSERT INTO radcheck (username, attribute, op, value) 
         VALUES (?, 'Expiration', ':=', ?)`,
        [username, expiryString]
      );

      console.log(`   Expires: ${expiryString}`);
    }

    // 7. Set billing cycle start date (for FUP calculation)
    await connection.query(
      `INSERT INTO user_billing_cycle (username, cycle_start) 
       VALUES (?, NOW()) 
       ON DUPLICATE KEY UPDATE cycle_start = NOW()`,
      [username]
    );

    await connection.commit();

    console.log(`✅ [RADIUS] Hotspot account created successfully`);

    return {
      success: true,
      username,
      password,
      macAddress: macWithColons
    };

  } catch (error) {
    await connection.rollback();
    console.error('❌ [RADIUS] Create hotspot account error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Delete hotspot RADIUS account by MAC address
 * @param {string} macAddress - User's MAC address
 */
async deleteHotspotAccount(macAddress) {
  const connection = await this.getConnection();
  
  try {
    const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();
    const username = `hs_${cleanMac}`;

    console.log(`\n🗑️  [RADIUS] Deleting hotspot account: ${username}`);

    // Delete from all RADIUS tables
    await connection.query('DELETE FROM radcheck WHERE username = ?', [username]);
    await connection.query('DELETE FROM radusergroup WHERE username = ?', [username]);
    await connection.query('DELETE FROM radreply WHERE username = ?', [username]);
    await connection.query('DELETE FROM user_billing_cycle WHERE username = ?', [username]);

    // Mark active sessions as stopped
    await connection.query(
      `UPDATE radacct 
       SET acctstoptime = NOW(), 
           acctterminatecause = 'Session-Expired' 
       WHERE username = ? AND acctstoptime IS NULL`,
      [username]
    );

    console.log(`✅ [RADIUS] Hotspot account deleted`);

    return { success: true };

  } catch (error) {
    console.error('❌ [RADIUS] Delete hotspot account error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Get hotspot user's current usage (in bytes)
 * @param {string} macAddress - User's MAC address
 * @returns {Object} { success, totalBytes, totalMB }
 */
async getHotspotUsage(macAddress) {
  const connection = await this.getConnection();
  
  try {
    const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();
    const username = `hs_${cleanMac}`;

    const [rows] = await connection.query(
      `SELECT COALESCE(SUM(acctinputoctets + acctoutputoctets), 0) as total_bytes
       FROM radacct 
       WHERE username = ? 
       AND acctstarttime >= COALESCE(
         (SELECT cycle_start FROM user_billing_cycle WHERE username = ?),
         DATE_FORMAT(NOW(), '%Y-%m-01')
       )`,
      [username, username]
    );

    const totalBytes = rows[0].total_bytes;
    const totalMB = Math.round(totalBytes / (1024 * 1024));

    return {
      success: true,
      username,
      totalBytes,
      totalMB
    };

  } catch (error) {
    console.error('❌ [RADIUS] Get hotspot usage error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Check if hotspot user is currently online
 * @param {string} macAddress - User's MAC address
 */
async isHotspotUserOnline(macAddress) {
  const connection = await this.getConnection();
  
  try {
    const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();
    const username = `hs_${cleanMac}`;

    const [rows] = await connection.query(
      `SELECT COUNT(*) as count, 
              MAX(acctstarttime) as last_session_start,
              MAX(framedipaddress) as current_ip
       FROM radacct 
       WHERE username = ? AND acctstoptime IS NULL`,
      [username]
    );

    const isOnline = rows[0].count > 0;

    return {
      success: true,
      isOnline,
      lastSessionStart: rows[0].last_session_start,
      currentIp: rows[0].current_ip
    };

  } catch (error) {
    console.error('❌ [RADIUS] Check hotspot online status error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Force disconnect hotspot user
 * @param {string} macAddress - User's MAC address
 */
async disconnectHotspotUser(macAddress) {
  const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();
  const username = `hs_${cleanMac}`;
  
  console.log(`\n🔌 [RADIUS] Disconnecting hotspot user: ${macAddress}`);
  
  // Use existing killUserSession method
  return await this.killUserSession(username);
}

/**
 * Get hotspot account credentials by MAC address
 * @param {string} macAddress - User's MAC address
 * @returns {Object} { success, username, exists }
 */
async getHotspotAccountInfo(macAddress) {
  const connection = await this.getConnection();
  
  try {
    const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();
    const username = `hs_${cleanMac}`;

    const [rows] = await connection.query(
      `SELECT 
        rc.value as password,
        rug.groupname,
        rgr.value as rate_limit
       FROM radcheck rc
       LEFT JOIN radusergroup rug ON rc.username = rug.username
       LEFT JOIN radgroupreply rgr ON rug.groupname = rgr.groupname 
         AND rgr.attribute = 'Mikrotik-Rate-Limit'
       WHERE rc.username = ? 
       AND rc.attribute = 'Cleartext-Password'
       LIMIT 1`,
      [username]
    );

    if (rows.length === 0) {
      return {
        success: true,
        exists: false
      };
    }

    return {
      success: true,
      exists: true,
      username,
      password: rows[0].password,
      groupName: rows[0].groupname,
      rateLimit: rows[0].rate_limit
    };

  } catch (error) {
    console.error('❌ [RADIUS] Get hotspot account info error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Update hotspot user's package (change speed group)
 * @param {string} macAddress - User's MAC address
 * @param {string} newGroupName - New package group name
 */
async updateHotspotPackage(macAddress, newGroupName) {
  const connection = await this.getConnection();
  
  try {
    const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();
    const username = `hs_${cleanMac}`;

    console.log(`\n📦 [RADIUS] Updating hotspot package: ${macAddress} -> ${newGroupName}`);

    await connection.query(
      `UPDATE radusergroup SET groupname = ? WHERE username = ?`,
      [newGroupName, username]
    );

    // Apply changes via CoA (without disconnecting)
    await this.updateUserRateLimit(username);

    console.log(`✅ [RADIUS] Package updated successfully`);

    return { success: true };

  } catch (error) {
    console.error('❌ [RADIUS] Update hotspot package error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Get all active hotspot sessions
 * Useful for monitoring dashboard
 */
async getActiveHotspotSessions() {
  const connection = await this.getConnection();
  
  try {
    const [sessions] = await connection.query(
      `SELECT 
        username,
        framedipaddress,
        nasipaddress,
        acctstarttime,
        TIMESTAMPDIFF(MINUTE, acctstarttime, NOW()) as duration_minutes,
        acctinputoctets,
        acctoutputoctets,
        (acctinputoctets + acctoutputoctets) / 1024 / 1024 as total_mb
       FROM radacct 
       WHERE username LIKE 'hs_%' 
       AND acctstoptime IS NULL
       ORDER BY acctstarttime DESC`
    );

    return {
      success: true,
      count: sessions.length,
      sessions
    };

  } catch (error) {
    console.error('❌ [RADIUS] Get active hotspot sessions error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Get hotspot authentication logs (from your custom radius_auth_log table)
 * @param {string} macAddress - Optional: filter by specific MAC
 * @param {number} limit - Number of records to return
 */
async getHotspotAuthLogs(macAddress = null, limit = 50) {
  const connection = await this.getConnection();
  
  try {
    let query = `
      SELECT 
        username,
        password,
        calling_station_id,
        nas_ip_address,
        auth_result,
        auth_time
      FROM radius_auth_log 
      WHERE username LIKE 'hs_%'
    `;

    const params = [];

    if (macAddress) {
      const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();
      query += ` AND username = ?`;
      params.push(`hs_${cleanMac}`);
    }

    query += ` ORDER BY auth_time DESC LIMIT ?`;
    params.push(limit);

    const [logs] = await connection.query(query, params);

    return {
      success: true,
      count: logs.length,
      logs
    };

  } catch (error) {
    console.error('❌ [RADIUS] Get hotspot auth logs error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

/**
 * Extend hotspot session expiry
 * @param {string} macAddress - User's MAC address
 * @param {Date} newExpiryDate - New expiry date
 */
async extendHotspotSession(macAddress, newExpiryDate) {
  const connection = await this.getConnection();
  
  try {
    const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();
    const username = `hs_${cleanMac}`;

    const expiryString = newExpiryDate.toISOString().slice(0, 19).replace('T', ' ');

    console.log(`\n⏰ [RADIUS] Extending hotspot session: ${macAddress} -> ${expiryString}`);

    // Update or insert expiration
    await connection.query(
      `INSERT INTO radcheck (username, attribute, op, value) 
       VALUES (?, 'Expiration', ':=', ?)
       ON DUPLICATE KEY UPDATE value = ?`,
      [username, expiryString, expiryString]
    );

    console.log(`✅ [RADIUS] Session extended`);

    return { success: true, newExpiry: newExpiryDate };

  } catch (error) {
    console.error('❌ [RADIUS] Extend hotspot session error:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    connection.release();
  }
}

  /**
   * Close connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('RADIUS database connection closed');
    }
  }
}

module.exports = new RadiusService();