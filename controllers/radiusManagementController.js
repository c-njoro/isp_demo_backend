const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const radiusService = require('../services/radiusService');

// ----------------------------------------------------------------------
// USERS (radcheck + radusergroup)
// ----------------------------------------------------------------------

/**
 * @desc    Get all RADIUS users (with group info)
 * @route   GET /api/radius/users
 * @access  Private (admin only)
 */
exports.getUsers = asyncHandler(async (req, res, next) => {
    const { search, group, hasMac } = req.query;
    const connection = await radiusService.getConnection();
    try {
      // Get all radcheck entries (password only)
      let usersQuery = `
        SELECT username, attribute, value FROM radcheck WHERE attribute = 'Cleartext-Password'
      `;
      let groupQuery = `SELECT username, groupname FROM radusergroup`;
      let macQuery = `SELECT username, value AS macAddress FROM radcheck WHERE attribute = 'Calling-Station-Id'`;
  
      // No dynamic filtering on these base queries; we'll filter in JavaScript for simplicity
      const [users] = await connection.query(usersQuery);
      const [groups] = await connection.query(groupQuery);
      const [macs] = await connection.query(macQuery);
  
      // Combine data
      const userMap = {};
      users.forEach(u => {
        userMap[u.username] = {
          username: u.username,
          password: u.value,
          group: null,
          macAddress: null
        };
      });
      groups.forEach(g => {
        if (userMap[g.username]) userMap[g.username].group = g.groupname;
      });
      macs.forEach(m => {
        if (userMap[m.username]) userMap[m.username].macAddress = m.macAddress;
      });
  
      let results = Object.values(userMap);
  
      // Apply filters
      if (search) {
        const searchLower = search.toLowerCase();
        results = results.filter(user =>
          user.username.toLowerCase().includes(searchLower) ||
          (user.group && user.group.toLowerCase().includes(searchLower)) ||
          (user.macAddress && user.macAddress.toLowerCase().includes(searchLower))
        );
      }
      if (group) {
        results = results.filter(user => user.group === group);
      }
      if (hasMac === 'true') {
        results = results.filter(user => user.macAddress);
      } else if (hasMac === 'false') {
        results = results.filter(user => !user.macAddress);
      }
  
      res.json({ success: true, data: results });
    } catch (error) {
      console.error('Get RADIUS users error:', error);
      return next(new ErrorResponse('Failed to fetch users', 500));
    } finally {
      connection.release();
    }
  });

/**
 * @desc    Get a single RADIUS user details
 * @route   GET /api/radius/users/:username
 * @access  Private (admin only)
 */
exports.getUser = asyncHandler(async (req, res, next) => {
  const { username } = req.params;
  const connection = await radiusService.getConnection();
  try {
    // Password
    const [pass] = await connection.query(
      `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Cleartext-Password'`,
      [username]
    );
    if (pass.length === 0) return next(new ErrorResponse('User not found', 404));
    
    // Group
    const [group] = await connection.query(
      `SELECT groupname FROM radusergroup WHERE username = ?`,
      [username]
    );
    
    // MAC binding
    const [mac] = await connection.query(
      `SELECT value FROM radcheck WHERE username = ? AND attribute = 'Calling-Station-Id'`,
      [username]
    );
    
    res.json({
      success: true,
      data: {
        username,
        password: pass[0].value,
        group: group.length ? group[0].groupname : null,
        macAddress: mac.length ? mac[0].value : null
      }
    });
  } catch (error) {
    console.error('Get RADIUS user error:', error);
    return next(new ErrorResponse('Failed to fetch user', 500));
  } finally {
    connection.release();
  }
});

/**
 * @desc    Disable a RADIUS user (move to DISABLED group)
 * @route   POST /api/radius/users/:username/disable
 * @access  Private (admin only)
 */
exports.disableUser = asyncHandler(async (req, res, next) => {
  const { username } = req.params;
  const result = await radiusService.disableAccount(username);
  if (!result.success) return next(new ErrorResponse(result.error, 500));
  res.json({ success: true, message: `User ${username} disabled` });
});

/**
 * @desc    Enable a RADIUS user (restore to original group)
 * @route   POST /api/radius/users/:username/enable
 * @access  Private (admin only)
 */
exports.enableUser = asyncHandler(async (req, res, next) => {
  const { username, groupName } = req.body;
  if (!groupName) return next(new ErrorResponse('groupName is required', 400));
  const result = await radiusService.enableAccount(username, groupName);
  if (!result.success) return next(new ErrorResponse(result.error, 500));
  res.json({ success: true, message: `User ${username} enabled` });
});

/**
 * @desc    Delete a RADIUS user completely
 * @route   DELETE /api/radius/users/:username
 * @access  Private (admin only)
 */
exports.deleteUser = asyncHandler(async (req, res, next) => {
  const { username } = req.params;
  const result = await radiusService.deleteAccount(username);
  if (!result.success) return next(new ErrorResponse(result.error, 500));
  res.json({ success: true, message: `User ${username} deleted` });
});

// ----------------------------------------------------------------------
// GROUPS (plans)
// ----------------------------------------------------------------------

/**
 * @desc    Get all groups (from radgroupreply)
 * @route   GET /api/radius/groups
 * @access  Private (admin only)
 */
exports.getGroups = asyncHandler(async (req, res, next) => {
    const { search } = req.query;
    const connection = await radiusService.getConnection();
    try {
      let query = `SELECT groupname, attribute, value FROM radgroupreply WHERE attribute = 'Mikrotik-Rate-Limit'`;
      if (search) {
        query += ` AND groupname LIKE ?`;
        const params = [`%${search}%`];
        const [groups] = await connection.query(query, params);
        return res.json({ success: true, data: groups });
      } else {
        const [groups] = await connection.query(query);
        return res.json({ success: true, data: groups });
      }
    } catch (error) {
      console.error('Get RADIUS groups error:', error);
      return next(new ErrorResponse('Failed to fetch groups', 500));
    } finally {
      connection.release();
    }
  });

/**
 * @desc    Update a group's rate limit
 * @route   PUT /api/radius/groups/:groupName
 * @access  Private (admin only)
 */
exports.updateGroup = asyncHandler(async (req, res, next) => {
  const { groupName } = req.params;
  const { uploadSpeed, downloadSpeed } = req.body;
  if (!uploadSpeed || !downloadSpeed) {
    return next(new ErrorResponse('uploadSpeed and downloadSpeed required', 400));
  }
  const rateLimit = `${uploadSpeed}M/${downloadSpeed}M`;
  const connection = await radiusService.getConnection();
  try {
    const [existing] = await connection.query(
      `SELECT * FROM radgroupreply WHERE groupname = ? AND attribute = 'Mikrotik-Rate-Limit'`,
      [groupName]
    );
    if (existing.length > 0) {
      await connection.query(
        `UPDATE radgroupreply SET value = ? WHERE groupname = ? AND attribute = 'Mikrotik-Rate-Limit'`,
        [rateLimit, groupName]
      );
    } else {
      await connection.query(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)`,
        [groupName, rateLimit]
      );
    }
    res.json({ success: true, message: `Group ${groupName} updated` });
  } catch (error) {
    console.error('Update group error:', error);
    return next(new ErrorResponse('Failed to update group', 500));
  } finally {
    connection.release();
  }
});

/**
 * @desc    Delete a group (and remove users from it)
 * @route   DELETE /api/radius/groups/:groupName
 * @access  Private (admin only)
 */
exports.deleteGroup = asyncHandler(async (req, res, next) => {
  const { groupName } = req.params;
  const connection = await radiusService.getConnection();
  try {
    await connection.beginTransaction();
    // Move users to DISABLED or delete? Safer to set them to DISABLED.
    await connection.query(
      `UPDATE radusergroup SET groupname = 'DISABLED' WHERE groupname = ?`,
      [groupName]
    );
    await connection.query(
      `DELETE FROM radgroupreply WHERE groupname = ?`,
      [groupName]
    );
    await connection.commit();
    res.json({ success: true, message: `Group ${groupName} deleted` });
  } catch (error) {
    await connection.rollback();
    console.error('Delete group error:', error);
    return next(new ErrorResponse('Failed to delete group', 500));
  } finally {
    connection.release();
  }
});

// ----------------------------------------------------------------------
// NAS DEVICES
// ----------------------------------------------------------------------

/**
 * @desc    Get all NAS devices
 * @route   GET /api/radius/nas
 * @access  Private (admin only)
 */
exports.getNasDevices = asyncHandler(async (req, res, next) => {
  const connection = await radiusService.getConnection();
  try {
    const [nas] = await connection.query(`SELECT id, nasname, shortname, type, secret FROM nas`);
    res.json({ success: true, data: nas });
  } catch (error) {
    console.error('Get NAS devices error:', error);
    return next(new ErrorResponse('Failed to fetch NAS devices', 500));
  } finally {
    connection.release();
  }
});

/**
 * @desc    Add or update a NAS device
 * @route   POST /api/radius/nas
 * @access  Private (admin only)
 */
exports.upsertNas = asyncHandler(async (req, res, next) => {
  const { nasname, shortname, type = 'mikrotik' } = req.body;
  if (!nasname) return next(new ErrorResponse('nasname is required', 400));

  const radiusSecret = process.env.RADIUS_SECRET;
  if (!radiusSecret) {
    return next(new ErrorResponse('RADIUS_SECRET environment variable not set', 500));
  }

  const result = await radiusService.registerNas(nasname, radiusSecret, shortname, type);
  if (!result.success) return next(new ErrorResponse(result.error, 500));

  // Also add to FreeRADIUS clients.conf
  const fileResult = await radiusService.addClientToConfig(nasname, radiusSecret, shortname, type);
  if (!fileResult.success) {
    console.error('Failed to add client to config:', fileResult.message);
  }

  res.json({
    success: true,
    message: result.message,
    configFile: fileResult
  });
});

/**
 * @desc    Delete a NAS device
 * @route   DELETE /api/radius/nas/:id
 * @access  Private (admin only)
 */
exports.deleteNas = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const connection = await radiusService.getConnection();
  try {
    await connection.query(`DELETE FROM nas WHERE id = ?`, [id]);
    res.json({ success: true, message: 'NAS deleted' });
  } catch (error) {
    console.error('Delete NAS error:', error);
    return next(new ErrorResponse('Failed to delete NAS', 500));
  } finally {
    connection.release();
  }
});

/**
 * @desc    Update a RADIUS user's password
 * @route   PUT /api/radius/users/:username/password
 * @access  Private (admin only)
 */
exports.updateUserPassword = asyncHandler(async (req, res, next) => {
  const { username } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return next(new ErrorResponse('Password must be at least 8 characters', 400));
  }
  const result = await radiusService.updatePassword(username, newPassword);
  if (!result.success) return next(new ErrorResponse(result.error, 500));
  res.json({ success: true, message: `Password updated for ${username}` });
});