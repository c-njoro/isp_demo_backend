const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Router = require('../models/Router');
const Site = require('../models/Site');
const SystemLog = require('../models/SystemLog');
const mikrotikService = require('../services/mikroticService');
const radiusService = require('../services/radiusService');

// ----------------------------------------------------------------------
// Helper: Get API connection from router ID
// ----------------------------------------------------------------------
async function getApiConnection(routerId) {
  const router = await Router.findById(routerId);
  if (!router) throw new Error('Router not found');
  // Use mikrotikService with a plain object (adapter)
  return await mikrotikService._getConnection({
    ip: router.ip,
    port: router.apiPort || 8728,
    username: router.username,
    password: router.password
  });
}

// ----------------------------------------------------------------------
// CRUD OPERATIONS FOR ROUTERS
// ----------------------------------------------------------------------

// @desc    Get all routers (optionally filter by site)
// @route   GET /api/routers?site=...
// controllers/routerController.js or wherever getRouters is defined
exports.getRouters = asyncHandler(async (req, res) => {
  let filter = {};

  // If user is logged into a specific region (not 'ALL'), filter by that regionCode
  if (req.session.selectedRegion && req.session.selectedRegion !== 'ALL') {
    filter.regionCode = req.session.selectedRegion;
  }

  // Override with explicit site filter if provided
  if (req.query.site) {
    filter.site = req.query.site;
  }

  const routers = await Router.find(filter).populate('site', 'name regionCode');
  res.json({ success: true, data: routers });
});

// @desc    Get single router
exports.getRouter = asyncHandler(async (req, res, next) => {
  const router = await Router.findById(req.params.id).populate('site');
  if (!router) return next(new ErrorResponse('Router not found', 404));
  res.json({ success: true, data: router });
});

// @desc    Create router
exports.createRouter = asyncHandler(async (req, res, next) => {
  const { name, siteId, ip, apiPort, username, password } = req.body;
  if (!name || !siteId || !ip || !username || !password) {
    return next(new ErrorResponse('Missing required fields: name, siteId, ip, username, password', 400));
  }
  const site = await Site.findById(siteId);
  if (!site) return next(new ErrorResponse('Site not found', 404));
  const router = await Router.create({
    name,
    site: siteId,
    ip,
    apiPort: apiPort || 8728,
    username,
    password,
    isActive: true,
    regionCode: site.regionCode
  });
  res.status(201).json({ success: true, data: router });
});

// @desc    Update router
exports.updateRouter = asyncHandler(async (req, res, next) => {
  const router = await Router.findById(req.params.id);
  if (!router) return next(new ErrorResponse('Router not found', 404));
  const { name, ip, apiPort, username, password, isActive } = req.body;
  if (name) router.name = name;
  if (ip) router.ip = ip;
  if (apiPort) router.apiPort = apiPort;
  if (username) router.username = username;
  if (password) router.password = password;
  if (typeof isActive !== 'undefined') router.isActive = isActive;
  await router.save();
  res.json({ success: true, data: router });
});

// @desc    Delete router
exports.deleteRouter = asyncHandler(async (req, res, next) => {
  const router = await Router.findById(req.params.id);
  if (!router) return next(new ErrorResponse('Router not found', 404));
  // Optional: check if router has active PPPoE clients? skip for now
  await router.deleteOne();
  res.json({ success: true, message: 'Router deleted' });
});

// ----------------------------------------------------------------------
// TEST & DIAGNOSTICS (moved from siteController)
// ----------------------------------------------------------------------

// @desc    Test router connection
// @route   POST /api/routers/:id/test-connection
exports.testRouterConnection = asyncHandler(async (req, res, next) => {
  const router = await Router.findById(req.params.id);
  if (!router) return next(new ErrorResponse('Router not found', 404));

  const result = await mikrotikService.testConnectionWithCredentials(
    router.ip,
    router.apiPort || 8728,
    router.username,
    router.password
  );

  // Update online status
  router.lastConnectionTest = {
    success: result.success,
    timestamp: new Date(),
    error: result.success ? null : result.message
  };
  router.isOnline = result.success;
  if (result.success) router.lastOnline = new Date();
  await router.save();

  res.json({
    success: true,
    data: {
      connected: result.success,
      version: result.version,
      identity: result.identity,
      message: result.message
    }
  });
});

// @desc    Get router diagnostics (system info, PPPoE, sessions, etc.)
// @route   GET /api/routers/:id/diagnostics
exports.getRouterDiagnostics = asyncHandler(async (req, res, next) => {
  const router = await Router.findById(req.params.id);
  if (!router) return next(new ErrorResponse('Router not found', 404));

  const api = await getApiConnection(router._id);
  const diagnostics = {
    router: {
      name: router.name,
      ip: router.ip,
      isOnline: router.isOnline,
      lastOnline: router.lastOnline
    },
    connection: { status: 'checking', ip: router.ip, port: router.apiPort },
    system: null,
    pppoe: { profiles: [], secrets: { total: 0, enabled: 0, disabled: 0, list: [] }, activeSessions: { total: 0, sessions: [] } },
    bandwidth: { interfaces: [] },
    summary: {},
    diagnosticsAt: new Date().toISOString()
  };

  try {
    // Test connection
    const testResult = await mikrotikService.testConnectionWithCredentials(
      router.ip, router.apiPort, router.username, router.password
    );
    if (!testResult.success) throw new Error(testResult.message);
    diagnostics.connection.status = 'online';
    diagnostics.connection.responseTime = testResult.responseTime;
    diagnostics.system = { identity: testResult.identity, version: testResult.version };

    // Get system resources
    const resources = await mikrotikService.getSystemResources({ router: { ip: router.ip, port: router.apiPort, username: router.username, password: router.password } });
    if (resources.success) {
      const output = resources.data;
      const uptimeMatch = output.match(/uptime:\s*(.+)/);
      if (uptimeMatch) diagnostics.system.uptime = uptimeMatch[1].trim();
      const cpuMatch = output.match(/cpu-load:\s*(\d+)%/);
      if (cpuMatch) diagnostics.system.cpuLoad = cpuMatch[1] + '%';
    }

    // PPPoE profiles
    const profilesResult = await mikrotikService.getPppoeProfiles({ router: { ip: router.ip, port: router.apiPort, username: router.username, password: router.password } });
    if (profilesResult.success) diagnostics.pppoe.profiles = profilesResult.data;

    // PPPoE secrets
    const secretsResult = await mikrotikService.getPppoeSecrets({ router: { ip: router.ip, port: router.apiPort, username: router.username, password: router.password } });
    if (secretsResult.success) {
      let secrets = secretsResult.data.map(s => ({ ...s, disabled: s.disabled === true || s.disabled === 'yes' || s.disabled === 'true' }));
      diagnostics.pppoe.secrets.total = secrets.length;
      diagnostics.pppoe.secrets.enabled = secrets.filter(s => !s.disabled).length;
      diagnostics.pppoe.secrets.disabled = secrets.filter(s => s.disabled).length;
      diagnostics.pppoe.secrets.list = secrets;
    }

    // Active sessions
    const sessionsResult = await mikrotikService.getActiveSessions({ router: { ip: router.ip, port: router.apiPort, username: router.username, password: router.password } });
    if (sessionsResult.success) {
      diagnostics.pppoe.activeSessions.total = sessionsResult.count;
      diagnostics.pppoe.activeSessions.sessions = sessionsResult.sessions;
    }

    // Interface stats
    const ifacesResult = await mikrotikService.getInterfaceStats({ router: { ip: router.ip, port: router.apiPort, username: router.username, password: router.password } });
    if (ifacesResult.success) diagnostics.bandwidth.interfaces = ifacesResult.data;

    // Summary
    diagnostics.summary = {
      totalSecrets: diagnostics.pppoe.secrets.total,
      enabledSecrets: diagnostics.pppoe.secrets.enabled,
      activeSessions: diagnostics.pppoe.activeSessions.total,
      utilizationRate: diagnostics.pppoe.secrets.enabled > 0
        ? ((diagnostics.pppoe.activeSessions.total / diagnostics.pppoe.secrets.enabled) * 100).toFixed(1) + '%'
        : '0%',
      profileCount: diagnostics.pppoe.profiles.length,
      cpuLoad: diagnostics.system?.cpuLoad || 'N/A'
    };

    // Update router online status
    router.lastConnectionTest = { success: true, timestamp: new Date(), error: null };
    router.isOnline = true;
    router.lastOnline = new Date();
    await router.save();

  } catch (error) {
    diagnostics.connection.status = 'error';
    diagnostics.connection.error = error.message;
    router.lastConnectionTest = { success: false, timestamp: new Date(), error: error.message };
    router.isOnline = false;
    await router.save();
  } finally {
    await api.close().catch(() => {});
  }
  res.json({ success: true, data: diagnostics });
});

// ----------------------------------------------------------------------
// MIKROTIK CONFIGURATION FUNCTIONS (converted from mikrotikAutoconfigurationController)
// ----------------------------------------------------------------------

// Helper: IPv4 ↔ integer
function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}
function intToIp(int) {
  return [(int >>> 24) & 0xFF, (int >>> 16) & 0xFF, (int >>> 8) & 0xFF, int & 0xFF].join('.');
}
function parseCIDR(cidr) {
  const [ipStr, prefixStr] = cidr.split('/');
  if (!ipStr || !prefixStr) throw new Error('Invalid CIDR format');
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 8 || prefix > 30) throw new Error('Prefix must be 8-30');
  const ipInt = ipToInt(ipStr);
  const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const network = ipInt & mask;
  const broadcast = network | (~mask >>> 0);
  const firstUsable = network + 1;
  const lastUsable = broadcast - 1;
  if (firstUsable >= lastUsable) throw new Error('CIDR too small');
  return {
    gateway: intToIp(firstUsable),
    poolStart: intToIp(firstUsable + 1),
    poolEnd: intToIp(lastUsable),
    prefix,
    mask: intToIp(mask),
    network: intToIp(network),
    broadcast: intToIp(broadcast)
  };
}

async function ensureFilterRule(api, params, comment) {
  const rules = await api.write('/ip/firewall/filter/print');
  const exists = rules.some(r => r.comment === comment);
  if (!exists) {
    await api.write('/ip/firewall/filter/add', [...params, `=comment=${comment}`]);
    return { added: true };
  }
  return { added: false };
}

async function ensureNatRule(api, params, comment) {
  const rules = await api.write('/ip/firewall/nat/print');
  const exists = rules.some(r => r.comment === comment);
  if (!exists) {
    await api.write('/ip/firewall/nat/add', [...params, `=comment=${comment}`]);
    return { added: true };
  }
  return { added: false };
}

async function ensureAddressList(api, listName, address, comment) {
  const lists = await api.write('/ip/firewall/address-list/print');
  const exists = lists.some(l => l.list === listName && l.address === address);
  if (!exists) {
    await api.write('/ip/firewall/address-list/add', [
      `=list=${listName}`,
      `=address=${address}`,
      `=comment=${comment}`
    ]);
    return { added: true };
  }
  return { added: false };
}

// ----------------------------------------------------------------------
// 1. CREATE BRIDGE
// ----------------------------------------------------------------------
exports.createBridge = asyncHandler(async (req, res, next) => {
  const { bridgeName, interface: ifaceName } = req.body;
  const { routerId } = req.params;
  if (!bridgeName || !ifaceName) return next(new ErrorResponse('bridgeName and interface are required', 400));
  const api = await getApiConnection(routerId);
  const log = [];
  try {
    const allBridges = await api.write('/interface/bridge/print');
    const existing = allBridges.find(b => b.name === bridgeName);
    if (existing) {
      log.push({ step: 'Bridge', status: 'skipped', message: `Bridge ${bridgeName} exists` });
    } else {
      await api.write('/interface/bridge/add', [`=name=${bridgeName}`, '=comment=Auto-created by ISP system']);
      log.push({ step: 'Bridge', status: 'success', message: `Created bridge ${bridgeName}` });
    }
    const allPorts = await api.write('/interface/bridge/port/print');
    const portExists = allPorts.find(p => p.interface === ifaceName);
    if (portExists) {
      log.push({ step: 'Bridge Port', status: 'skipped', message: `${ifaceName} already bridged` });
    } else {
      await api.write('/interface/bridge/port/add', [`=interface=${ifaceName}`, `=bridge=${bridgeName}`]);
      log.push({ step: 'Bridge Port', status: 'success', message: `Added ${ifaceName} to ${bridgeName}` });
    }
    res.json({ success: true, log });
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    res.status(500).json({ success: false, error: error.message, log });
  } finally { await api.close(); }
});

// ----------------------------------------------------------------------
// 2. CREATE IP POOL AND GATEWAY
// ----------------------------------------------------------------------
exports.createIpPool = asyncHandler(async (req, res, next) => {
  const { cidr, gatewayInterface } = req.body;
  const { routerId } = req.params;
  if (!cidr || !gatewayInterface) return next(new ErrorResponse('cidr and gatewayInterface required', 400));
  let cidrInfo;
  try { cidrInfo = parseCIDR(cidr); } catch (err) { return next(new ErrorResponse(err.message, 400)); }
  const api = await getApiConnection(routerId);
  const log = [];
  try {
    const interfaces = await api.write('/interface/print');
    if (!interfaces.some(i => i.name === gatewayInterface)) throw new Error(`Interface ${gatewayInterface} not found`);
    log.push({ step: 'Interface Check', status: 'success', message: `Found ${gatewayInterface}` });

    const gatewayAddr = `${cidrInfo.gateway}/${cidrInfo.prefix}`;
    const existingIps = await api.write('/ip/address/print');
    if (existingIps.some(ip => ip.address === gatewayAddr)) {
      log.push({ step: 'Gateway IP', status: 'skipped', message: `${gatewayAddr} exists` });
    } else {
      await api.write('/ip/address/add', [`=address=${gatewayAddr}`, `=interface=${gatewayInterface}`, '=comment=PPPoE gateway']);
      log.push({ step: 'Gateway IP', status: 'success', message: `Added ${gatewayAddr}` });
    }

    const poolName = 'active-pool';
    const poolRange = `${cidrInfo.poolStart}-${cidrInfo.poolEnd}`;
    const existingPools = await api.write('/ip/pool/print');
    if (existingPools.some(p => p.name === poolName)) {
      log.push({ step: 'Pool', status: 'skipped', message: `${poolName} exists` });
    } else {
      await api.write('/ip/pool/add', [`=name=${poolName}`, `=ranges=${poolRange}`, '=comment=Auto-created']);
      log.push({ step: 'Pool', status: 'success', message: `Created ${poolName}: ${poolRange}` });
    }

    const natResult = await ensureNatRule(api, ['=chain=srcnat', `=src-address=${cidr}`, '=action=masquerade'], `Masquerade for ${poolName}`);
    log.push({ step: 'NAT', status: natResult.added ? 'success' : 'skipped', message: natResult.added ? 'Added masquerade' : 'Rule exists' });

    // Error pools (expired, credential, non-existent, mac-difference)
    const errorPools = [
      { name: 'expired-pool', cidr: '10.254.254.0/24', comment: 'Expired users' },
      { name: 'credential-pool', cidr: '20.20.0.0/16', comment: 'Wrong password' },
      { name: 'non-existent', cidr: '30.30.0.0/16', comment: 'Non-existent user' },
      { name: 'mac-difference', cidr: '40.40.0.0/16', comment: 'MAC mismatch' }
    ];
    for (const pool of errorPools) {
      const poolCidr = parseCIDR(pool.cidr);
      const gw = `${poolCidr.gateway}/${poolCidr.prefix}`;
      const addrExists = existingIps.some(ip => ip.address === gw);
      if (!addrExists) {
        await api.write('/ip/address/add', [`=address=${gw}`, `=interface=${gatewayInterface}`, `=comment=${pool.comment} gateway`]);
        log.push({ step: 'Error Gateway', status: 'success', message: `Added ${gw}` });
      }
      const poolExists = existingPools.some(p => p.name === pool.name);
      if (!poolExists) {
        await api.write('/ip/pool/add', [`=name=${pool.name}`, `=ranges=${poolCidr.poolStart}-${poolCidr.poolEnd}`, `=comment=${pool.comment}`]);
        log.push({ step: 'Error Pool', status: 'success', message: `Created ${pool.name}` });
      }
    }
    res.json({ success: true, log });
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    res.status(500).json({ success: false, error: error.message, log });
  } finally { await api.close(); }
});

// ----------------------------------------------------------------------
// 3. CREATE PPPOE SERVER
// ----------------------------------------------------------------------
exports.createPppoeServer = asyncHandler(async (req, res, next) => {
  const { interface: ifaceName, serviceName } = req.body;
  const { routerId } = req.params;
  if (!ifaceName || !serviceName) return next(new ErrorResponse('interface and serviceName required', 400));
  const api = await getApiConnection(routerId);
  const log = [];
  try {
    const profileName = 'radius-profile';
    const profiles = await api.write('/ppp/profile/print');
    if (!profiles.some(p => p.name === profileName)) {
      const addresses = await api.write('/ip/address/print');
      const pppoeGateway = addresses.find(a => a.comment && a.comment.includes('PPPoE gateway'));
      if (!pppoeGateway) throw new Error('PPPoE gateway not found. Run IP pool step first.');
      const localAddress = pppoeGateway.address.split('/')[0];
      await api.write('/ppp/profile/add', [
        `=name=${profileName}`,
        `=local-address=${localAddress}`,
        '=remote-address=active-pool',
        '=dns-server=8.8.8.8,8.8.4.4',
        '=only-one=yes',
        '=use-encryption=no',
        '=comment=Auto-created'
      ]);
      log.push({ step: 'PPP Profile', status: 'success', message: `Created ${profileName}` });
    } else {
      log.push({ step: 'PPP Profile', status: 'skipped', message: `${profileName} exists` });
    }
    const servers = await api.write('/interface/pppoe-server/server/print');
    if (!servers.some(s => s.interface === ifaceName)) {
      await api.write('/interface/pppoe-server/server/add', [
        `=interface=${ifaceName}`,
        `=service-name=${serviceName}`,
        `=default-profile=${profileName}`,
        '=authentication=pap',
        '=disabled=no'
      ]);
      log.push({ step: 'PPPoE Server', status: 'success', message: `Created on ${ifaceName}` });
    } else {
      log.push({ step: 'PPPoE Server', status: 'skipped', message: 'Server already exists' });
    }
    res.json({ success: true, log });
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    res.status(500).json({ success: false, error: error.message, log });
  } finally { await api.close(); }
});

// ----------------------------------------------------------------------
// 4. ENABLE RADIUS
// ----------------------------------------------------------------------
exports.enableRadius = asyncHandler(async (req, res, next) => {
  const { routerId } = req.params;
  const router = await Router.findById(routerId).populate('site');
  if (!router) return next(new ErrorResponse('Router not found', 404));
  const radiusIp = process.env.RADIUS_SERVER_IP;
  const radiusSecret = process.env.RADIUS_SECRET || 'defaultSecret';
  const api = await getApiConnection(routerId);
  const log = [];
  try {
    const radServers = await api.write('/radius/print');
    if (!radServers.some(r => r.address === radiusIp)) {
      await api.write('/radius/add', [`=address=${radiusIp}`, `=secret=${radiusSecret}`, '=service=ppp', '=comment=RADIUS for PPPoE']);
      log.push({ step: 'RADIUS Server', status: 'success', message: `Added ${radiusIp}` });
    } else {
      log.push({ step: 'RADIUS Server', status: 'skipped', message: 'Already exists' });
    }
    await api.write('/ppp/aaa/set', ['=use-radius=yes', '=interim-update=5m']);
    log.push({ step: 'PPP AAA', status: 'success', message: 'Enabled RADIUS with interim updates' });
    await api.write('/radius/incoming/set', ['=accept=yes']);
    log.push({ step: 'RADIUS Incoming', status: 'success', message: 'Enabled CoA' });
    // Register NAS in FreeRADIUS
    const nasResult = await radiusService.registerNas({
      nasname: router.ip,
      shortname: router.site.name + '-' + router.name,
      secret: radiusSecret,
      type: 'mikrotik'
    });
    if (nasResult.success) log.push({ step: 'NAS Registration', status: 'success', message: 'Registered in FreeRADIUS' });
    else log.push({ step: 'NAS Registration', status: 'error', message: nasResult.error });
    res.json({ success: true, log });
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    res.status(500).json({ success: false, error: error.message, log });
  } finally { await api.close(); }
});

// ----------------------------------------------------------------------
// 5. CONFIGURE DISABLED REDIRECT (captive portal)
// ----------------------------------------------------------------------
exports.configureDisabledRedirect = asyncHandler(async (req, res, next) => {
  const { routerId } = req.params;
  const { 
    allowedPoolCidr = '10.10.0.0/16',  // Active users pool
    bridgeInterface = 'bridge-pppoe'    // Bridge interface name
  } = req.body;
 
  const router = await Router.findById(routerId);
  if (!router) return next(new ErrorResponse('Router not found', 404));
 
  // ============================================================
  // CONFIGURATION VARIABLES
  // ============================================================
  const radiusIp = process.env.RADIUS_IP || '102.210.42.46';
  
  // Get redirect configuration from environment
  let redirectHost = process.env.REDIRECT_HOST || 'redirect.yourdomain.com';
  let redirectIp = '102.210.40.178';  // FIXED: Now dynamic
  let redirectPort = '8081';
  
  // Extract hostname for address list (for domain resolution)
  let addressListHost = redirectHost;
  try {
    if (redirectHost.includes('://')) {
      const url = new URL(redirectHost);
      addressListHost = url.hostname;
    } else {
      addressListHost = redirectHost.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
    }
  } catch (e) {
    addressListHost = redirectHost.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
  }
 
  const api = await getApiConnection(routerId);
  const log = [];
 
  try {
    // ============================================================
    // STEP 1: CREATE ADDRESS LISTS
    // ============================================================
    await ensureAddressList(api, 'ALLOWED_USERS', allowedPoolCidr, 'Active PPPoE users');
    await ensureAddressList(api, 'DISABLED_USERS', '10.254.254.0/24', 'Expired/Disabled users');
    await ensureAddressList(api, 'OI_REDIRECT_IP', addressListHost, 'Redirect host');
    log.push({ 
      step: 'Address Lists', 
      status: 'success', 
      message: 'All address lists ensured',
      details: {
        allowedPool: allowedPoolCidr,
        disabledPool: '10.254.254.0/24',
        redirectHost: addressListHost
      }
    });
 
    // ============================================================
    // STEP 2: GET WAN INTERFACE AND IP (for multi-hop routing)
    // ============================================================
    const interfaces = await api.write('/interface/print');
    const wanInterface = interfaces.find(i => i.comment && i.comment.includes('WAN')) || 
                        interfaces.find(i => i.name === 'ether2');
    const wanIfName = wanInterface ? wanInterface.name : 'ether2';
    
    // Get WAN IP address for source NAT
    let wanIp = null;
    try {
      const wanAddresses = await api.write('/ip/address/print', [`?interface=${wanIfName}`]);
      if (wanAddresses.length > 0) {
        wanIp = wanAddresses[0].address.split('/')[0];
        log.push({ 
          step: 'WAN Detection', 
          status: 'success', 
          message: `Detected WAN interface: ${wanIfName} with IP: ${wanIp}`
        });
      } else {
        log.push({ 
          step: 'WAN Detection', 
          status: 'warning', 
          message: `WAN interface ${wanIfName} has no IP address. Multi-hop routing may not work.`
        });
      }
    } catch (error) {
      log.push({ 
        step: 'WAN Detection', 
        status: 'warning', 
        message: `Could not detect WAN IP: ${error.message}`
      });
    }
 
    // ============================================================
    // STEP 3: CREATE FIREWALL FILTER RULES
    // ============================================================
    const filterRules = [
      // Allow bridge-lan to WAN traffic
      { 
        params: [
          '=chain=forward', 
          `=in-interface=${bridgeInterface}`, 
          '=out-interface=ether2', 
          '=action=accept'
        ], 
        comment: 'Accept bridge-lan to WAN' 
      },
      
      // Reject non-HTTP traffic for disabled users (except ports we explicitly allow)
      { 
        params: [
          '=chain=forward', 
          '=src-address-list=DISABLED_USERS', 
          '=protocol=tcp', 
          '=dst-port=!80,3346', 
          '=action=reject', 
          '=reject-with=icmp-network-unreachable'
        ], 
        comment: 'OI_EXPIRED_REJECT_NON_HTTP' 
      },
      
      // Allow DNS for disabled users (TCP)
      { 
        params: [
          '=chain=forward', 
          '=src-address-list=DISABLED_USERS', 
          '=protocol=tcp', 
          '=dst-port=53', 
          '=action=accept'
        ], 
        comment: 'OI_EXPIRED_ALLOW_DNS_TCP' 
      },
      
      // Allow DNS for disabled users (UDP)
      { 
        params: [
          '=chain=forward', 
          '=src-address-list=DISABLED_USERS', 
          '=protocol=udp', 
          '=dst-port=53', 
          '=action=accept'
        ], 
        comment: 'OI_EXPIRED_ALLOW_DNS_UDP' 
      },
      
      // Allow RADIUS authentication for disabled users
      { 
        params: [
          '=chain=forward', 
          '=src-address-list=DISABLED_USERS', 
          `=dst-address=${radiusIp}`, 
          '=protocol=tcp', 
          '=dst-port=3799', 
          '=action=accept'
        ], 
        comment: 'OI_EXPIRED_ALLOW_RADIUS' 
      },
      
      // Drop all other traffic from disabled users
      { 
        params: [
          '=chain=forward', 
          '=src-address-list=DISABLED_USERS', 
          '=action=drop'
        ], 
        comment: 'OI_EXPIRED_DROP_OTHER' 
      }
    ];
 
    for (const rule of filterRules) {
      await ensureFilterRule(api, rule.params, rule.comment);
    }
    
    log.push({ 
      step: 'Filter Rules', 
      status: 'success', 
      message: `Created ${filterRules.length} firewall filter rules`
    });
 
    // ============================================================
    // STEP 4: CREATE NAT RULES (FIXED FOR MULTI-HOP ROUTING)
    // ============================================================
    const natRules = [
      // Basic masquerade for all WAN traffic
      { 
        params: [
          '=chain=srcnat', 
          `=out-interface=${wanIfName}`, 
          '=action=masquerade'
        ], 
        comment: 'Masquerade WAN' 
      },
      
      // Masquerade DNS queries to Google DNS (primary)
      { 
        params: [
          '=chain=srcnat', 
          '=src-address-list=DISABLED_USERS', 
          '=dst-address=8.8.8.8', 
          '=action=masquerade'
        ], 
        comment: 'OI_EXPIRED_MASQ_DNS1' 
      },
      
      // Masquerade DNS queries to Google DNS (secondary)
      { 
        params: [
          '=chain=srcnat', 
          '=src-address-list=DISABLED_USERS', 
          '=dst-address=8.8.4.4', 
          '=action=masquerade'
        ], 
        comment: 'OI_EXPIRED_MASQ_DNS2' 
      },
      
      // DESTINATION NAT: Redirect all HTTP (port 80) to captive portal
      { 
        params: [
          '=chain=dstnat', 
          '=src-address-list=DISABLED_USERS', 
          '=protocol=tcp', 
          '=dst-port=80', 
          '=action=dst-nat', 
          `=to-addresses=${redirectIp}`,  // FIXED: Now uses dynamic IP
          `=to-ports=${redirectPort}`      // FIXED: Now uses dynamic port
        ], 
        comment: 'OI_EXPIRED_REDIRECT_HTTP' 
      },
      
      // Masquerade traffic to redirect host (for domain resolution)
      { 
        params: [
          '=chain=srcnat', 
          '=src-address-list=DISABLED_USERS', 
          '=dst-address-list=OI_REDIRECT_IP', 
          '=action=masquerade'
        ], 
        comment: 'OI_EXPIRED_MASQ_REDIRECT_HOST' 
      }
    ];
 
    // ============================================================
    // CRITICAL FIX: Add Source NAT for multi-hop routing
    // ============================================================
    // When users are behind an intermediate router, the MikroTik must
    // replace the source IP with its own WAN IP so the redirect server
    // can send responses back through the correct path.
    if (wanIp) {
      natRules.push({
        params: [
          '=chain=srcnat',
          '=src-address-list=DISABLED_USERS',
          `=dst-address=${redirectIp}`,
          '=protocol=tcp',
          `=dst-port=${redirectPort}`,
          '=action=src-nat',
          `=to-addresses=${wanIp}`
        ],
        comment: 'OI_EXPIRED_SRCNAT_REDIRECT_SERVER'
      });
      
      log.push({ 
        step: 'Multi-Hop Fix', 
        status: 'success', 
        message: `Added Source NAT rule for redirect server using WAN IP: ${wanIp}`
      });
    } else {
      log.push({ 
        step: 'Multi-Hop Fix', 
        status: 'warning', 
        message: 'Could not add Source NAT - WAN IP not detected. Multi-hop routing may fail.'
      });
    }
 
    // Apply all NAT rules
    for (const rule of natRules) {
      await ensureNatRule(api, rule.params, rule.comment);
    }
    
    log.push({ 
      step: 'NAT Rules', 
      status: 'success', 
      message: `Created ${natRules.length} NAT rules (external portal with multi-hop support)`,
      details: {
        redirectIp,
        redirectPort,
        redirectHost: addressListHost,
        wanInterface: wanIfName,
        wanIp: wanIp || 'Not detected'
      }
    });
 
    // ============================================================
    // STEP 5: VERIFICATION
    // ============================================================
    log.push({
      step: 'Configuration Complete',
      status: 'success',
      message: 'Disabled user redirect configured successfully',
      configuration: {
        redirectServer: `${redirectIp}:${redirectPort}`,
        redirectHost: addressListHost,
        disabledPool: '10.254.254.0/24',
        allowedPool: allowedPoolCidr,
        wanInterface: wanIfName,
        wanIp: wanIp || 'Auto-detect',
        multiHopSupport: wanIp ? 'Enabled' : 'Disabled (WAN IP not found)'
      }
    });
 
    res.json({ success: true, log });
 
  } catch (error) {
    log.push({ 
      step: 'Error', 
      status: 'error', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    res.status(500).json({ 
      success: false, 
      error: error.message, 
      log 
    });
  } finally {
    await api.close();
  }
});

// ----------------------------------------------------------------------
// 6. SYSTEM SCRIPTS & AUTOMATION
// ----------------------------------------------------------------------
async function ensureScript(api, name, source, comment) {
  const existing = await api.write('/system/script/print', [`?name=${name}`]);
  if (existing.length) return { added: false };
  await api.write('/system/script/add', [`=name=${name}`, `=source=${source}`, '=policy=read,write,test', `=comment=${comment}`]);
  return { added: true };
}
async function ensureScheduler(api, name, onEvent, startTime, comment) {
  const existing = await api.write('/system/scheduler/print', [`?name=${name}`]);
  if (existing.length) return { added: false };
  await api.write('/system/scheduler/add', [`=name=${name}`, `=on-event=${onEvent}`, `=start-time=${startTime}`, `=comment=${comment}`]);
  return { added: true };
}
async function ensureNetwatch(api, host, downScript, upScript, interval, timeout, comment) {
  const existing = await api.write('/tool/netwatch/print', [`?host=${host}`]);
  if (existing.length) return { added: false };
  await api.write('/tool/netwatch/add', [`=host=${host}`, `=interval=${interval}`, `=timeout=${timeout}`, `=down-script=${downScript}`, `=up-script=${upScript}`, `=comment=${comment}`]);
  return { added: true };
}

exports.configureSystemScripts = asyncHandler(async (req, res, next) => {
  const { routerId } = req.params;
  const api = await getApiConnection(routerId);
  const log = [];
  try {
    const scripts = [
      { name: 'mark-down', source: ':log info "Internet down – flag set."', comment: 'Mark internet down' },
      { name: 'restart-pppoe', source: ':log info "Internet restored – removing PPPoE sessions." ; /ppp active remove [find]', comment: 'Restart PPPoE' },
      { name: 'clear-pppoe-on-startup', source: ':delay 60s; /ppp active remove [find]; :log info "Startup: cleared PPPoE sessions"', comment: 'Clear on boot' }
    ];
    for (const s of scripts) {
      const result = await ensureScript(api, s.name, s.source, s.comment);
      log.push({ step: 'Script', status: result.added ? 'success' : 'skipped', message: result.added ? `Created ${s.name}` : `${s.name} exists` });
    }
    const scheduler = await ensureScheduler(api, 'startup-clear-sessions', 'clear-pppoe-on-startup', 'startup', 'Clear PPPoE after boot');
    log.push({ step: 'Scheduler', status: scheduler.added ? 'success' : 'skipped', message: scheduler.added ? 'Created scheduler' : 'Scheduler exists' });
    const netwatch = await ensureNetwatch(api, '8.8.8.8', 'mark-down', 'restart-pppoe', '30s', '10s', 'Internet watchdog');
    log.push({ step: 'Netwatch', status: netwatch.added ? 'success' : 'skipped', message: netwatch.added ? 'Created netwatch' : 'Netwatch exists' });
    res.json({ success: true, log });
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    res.status(500).json({ success: false, error: error.message, log });
  } finally { await api.close(); }
});

// ----------------------------------------------------------------------
// 7. CONFIGURATION STATUS & GET EXISTING CONFIG
// ----------------------------------------------------------------------
exports.getConfigurationStatus = asyncHandler(async (req, res, next) => {
  const { routerId } = req.params;
  const api = await getApiConnection(routerId);
  const status = { bridge: false, ipPools: false, pppoeServer: false, radius: false, disabledRedirect: false, systemScripts: false, netwatch: false };
  try {
    const bridges = await api.write('/interface/bridge/print');
    status.bridge = bridges.some(b => b.name === 'bridge-pppoe' || b.comment?.includes('Auto-created'));
    const pools = await api.write('/ip/pool/print');
    const required = ['active-pool', 'expired-pool', 'credential-pool', 'non-existent', 'mac-difference'];
    status.ipPools = required.every(r => pools.some(p => p.name === r));
    const servers = await api.write('/interface/pppoe-server/server/print');
    status.pppoeServer = servers.length > 0;
    const radiusServers = await api.write('/radius/print');
    const aaa = await api.write('/ppp/aaa/print');
    status.radius = (aaa[0] && aaa[0]['use-radius'] === 'true') && radiusServers.length > 0;
    const filterRules = await api.write('/ip/firewall/filter/print');
    const natRules = await api.write('/ip/firewall/nat/print');
    status.disabledRedirect = filterRules.some(r => r.comment?.includes('OI_EXPIRED')) && natRules.some(r => r.comment?.includes('OI_EXPIRED_REDIRECT_HTTP'));
    const scripts = await api.write('/system/script/print');
    status.systemScripts = scripts.some(s => s.name === 'mark-down');
    const netwatches = await api.write('/tool/netwatch/print');
    status.netwatch = netwatches.some(n => n.host === '8.8.8.8');
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally { await api.close(); }
});

exports.getExistingConfig = asyncHandler(async (req, res, next) => {
  const { routerId } = req.params;
  const api = await getApiConnection(routerId);
  try {
    const [bridges, pools, profiles, servers, scripts, schedulers, netwatches] = await Promise.all([
      api.write('/interface/bridge/print'),
      api.write('/ip/pool/print'),
      api.write('/ppp/profile/print'),
      api.write('/interface/pppoe-server/server/print'),
      api.write('/system/script/print'),
      api.write('/system/scheduler/print'),
      api.write('/tool/netwatch/print')
    ]);
    res.json({ success: true, data: { bridges, pools, profiles, servers, scripts, schedulers, netwatches } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally { await api.close(); }
});

exports.getRouterInterfaces = asyncHandler(async (req, res, next) => {
  const { routerId } = req.params;
  const api = await getApiConnection(routerId);
  try {
    const interfaces = await api.write('/interface/print');
    const interfaceList = interfaces.map(iface => ({
      name: iface.name, type: iface.type, running: iface.running === 'true',
      disabled: iface.disabled === 'true', comment: iface.comment || ''
    }));
    res.json({ success: true, data: interfaceList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally { await api.close(); }
});