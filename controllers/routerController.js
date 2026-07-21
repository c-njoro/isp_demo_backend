// const asyncHandler = require('../middleware/asyncHandler');
// const { ErrorResponse } = require('../middleware/errorHandler');
// const Router = require('../models/Router');
// const Site = require('../models/Site');
// const SystemLog = require('../models/SystemLog');
// const mikrotikService = require('../services/mikroticService');
// const radiusService = require('../services/radiusService');
// const JSZip      = require('jszip');
// const vpnService = require('../services/vpnService');

// // ----------------------------------------------------------------------
// // Helper: Get API connection from router ID
// // ----------------------------------------------------------------------
// async function getApiConnection(routerId) {
//   const router = await Router.findById(routerId);
//   if (!router) throw new Error('Router not found');
//   // Use mikrotikService with a plain object (adapter)
//   return await mikrotikService._getConnection({
//     ip: router.ip,
//     port: router.apiPort || 8728,
//     username: router.username,
//     password: router.password
//   });
// }

// // ----------------------------------------------------------------------
// // CRUD OPERATIONS FOR ROUTERS
// // ----------------------------------------------------------------------

// // @desc    Get all routers (optionally filter by site)
// // @route   GET /api/routers?site=...
// // controllers/routerController.js or wherever getRouters is defined
// exports.getRouters = asyncHandler(async (req, res) => {
//   let filter = {};

//   // If user is logged into a specific region (not 'ALL'), filter by that regionCode
//   if (req.session.selectedRegion && req.session.selectedRegion !== 'ALL') {
//     filter.regionCode = req.session.selectedRegion;
//   }

//   // Override with explicit site filter if provided
//   if (req.query.site) {
//     filter.site = req.query.site;
//   }

//   const routers = await Router.find(filter).populate('site', 'name regionCode');
//   res.json({ success: true, data: routers });
// });

// // @desc    Get single router
// exports.getRouter = asyncHandler(async (req, res, next) => {
//   const router = await Router.findById(req.params.id).populate('site');
//   if (!router) return next(new ErrorResponse('Router not found', 404));
//   res.json({ success: true, data: router });
// });

// // @desc    Create router
// exports.createRouter = asyncHandler(async (req, res, next) => {
//   const { name, siteId, username, password } = req.body;
//   if (!name || !siteId || !username || !password) {
//     return next(new ErrorResponse('Missing required fields: name, siteId, username, password', 400));
//   }
//   const site = await Site.findById(siteId);
//   if (!site) return next(new ErrorResponse('Site not found', 404));

//   const router = await Router.create({
//     ip: '0.0.0.0',
//     name,
//     site: siteId,
//     username,
//     password,
//     isActive: true,
//     regionCode: site.regionCode,
//   });

//   // Generate VPN config (certificates, client name, tunnel IP)
//   const vpnResult = await vpnService.generateRouterVpnConfig(router);
//   if (vpnResult.success) {
//     router.ip = vpnResult.tunnelIp;
//     router.tunnelIp = vpnResult.tunnelIp;
//     router.vpnClientName = vpnResult.clientName;
//     router.vpnConnected = false;
//     await router.save();
//   } else {
//     console.error('VPN generation failed:', vpnResult.error);
//   }

//   res.status(201).json({ success: true, data: router });
// });


// // @desc    Get MikroTik script to set up OVPN client
// // @route   GET /api/routers/:id/vpn/script
// exports.getVpnSetupScript = asyncHandler(async (req, res, next) => {
//   const router = await Router.findById(req.params.id);
//   if (!router) return next(new ErrorResponse('Router not found', 404));
//   if (!router.vpnClientName) {
//     return next(new ErrorResponse('VPN config not generated yet', 400));
//   }

//   const script = `# ============================================
// # OpenVPN Client Setup for ${router.name}
// # ============================================

// # 1. Upload the following files to MikroTik (via Winbox / Files):
// #    - ca.crt
// #    - ${router.vpnClientName}.crt
// #    - ${router.vpnClientName}.key
// #    - client.ovpn (or use the commands below)

// # 2. Import certificates
// /certificate import file-name=ca.crt passphrase=""
// /certificate import file-name=${router.vpnClientName}.crt passphrase=""
// /certificate import file-name=${router.vpnClientName}.key passphrase=""

// # 3. Find the certificate names
// :local certName [/certificate find where name~"${router.vpnClientName}"]
// :put "Certificate name: $certName"

// # 4. Create OVPN client (replace cert name and server IP)
// /interface ovpn-client add \\
//     name=skylink-vpn \\
//     connect-to=${process.env.VPN_SERVER_IP || 'your-vpn-server-ip'} \\
//     port=1194 \\
//     mode=ip \\
//     user=${router.vpnClientName} \\
//     certificate=$certName \\
//     cipher=aes128 \\
//     add-default-route=no \\
//     disabled=no

// # 5. Set default route via OVPN interface
// /ip route add dst-address=0.0.0.0/0 gateway=skylink-vpn routing-mark=main

// # 6. Verify connection
// /interface ovpn-client monitor 0

// # After connection, the router's tunnel IP will be shown. 
// # Update the router's IP in the ISP panel to that address.`;

//   res.set('Content-Type', 'text/plain');
//   res.send(script);
// });


// // @desc    Generate VPN config for a router
// // @route   POST /api/routers/:id/vpn/generate
// // @desc    Generate VPN config for a router
// // @route   POST /api/routers/:id/vpn/generate
// exports.generateVpnConfig = asyncHandler(async (req, res, next) => {
//   const router = await Router.findById(req.params.id);
//   if (!router) return next(new ErrorResponse('Router not found', 404));

//   const result = await vpnService.generateRouterVpnConfig(router);
//   if (!result.success) return next(new ErrorResponse(result.error || 'VPN generation failed', 500));

//   res.json({
//     success:    true,
//     tunnelIp:   result.tunnelIp,
//     clientName: result.clientName,
//     message:    `VPN config generated. Update router IP to ${result.tunnelIp} after connecting.`
//   });
// });

// // @desc    Download VPN cert bundle as ZIP
// // @route   GET /api/routers/:id/vpn/download
// exports.downloadVpnConfig = asyncHandler(async (req, res, next) => {
//   const router = await Router.findById(req.params.id);
//   if (!router) return next(new ErrorResponse('Router not found', 404));

//   const vpnService = require('../services/vpnService');
//   const result = await vpnService.generateRouterVpnConfig(router);
//   if (!result.success) return next(new ErrorResponse(result.error || 'VPN config unavailable', 500));

//   const JSZip = require('jszip');
//   const zip = new JSZip();

//   // Add certificate files
//   for (const [name, buffer] of Object.entries(result.files)) {
//     zip.file(name, buffer);
//   }

//   // The setup script — exact commands that work on RouterOS 6.x through 7.x
//   const clientName = result.clientName;
//   const vpsIp      = process.env.VPS_PUBLIC_IP || '102.210.40.178';
//   const radiusSecret = process.env.RADIUS_SECRET || '';

//   const setupScript = [
//     '# ============================================================',
//     `# SkyLink VPN Setup Script`,
//     `# Router:     ${router.name}`,
//     `# Tunnel IP:  ${result.tunnelIp}`,
//     `# Generated:  ${new Date().toISOString()}`,
//     '# ============================================================',
//     '#',
//     '# STEP 1: Upload these files to MikroTik via Winbox -> Files:',
//     '#   - ca.crt',
//     `#   - ${clientName}.crt`,
//     `#   - ${clientName}.key`,
//     '#',
//     '# STEP 2: Open MikroTik terminal and run the commands below.',
//     '#         Each command must be run as ONE single line.',
//     '#',
//     '# ============================================================',
//     '',
//     '# --- Import Certificates ---',
//     '/certificate import file-name=ca.crt passphrase=""',
//     `/certificate import file-name=${clientName}.crt passphrase=""`,
//     `/certificate import file-name=${clientName}.key passphrase=""`,
//     '',
//     '# --- Verify certificates imported correctly ---',
//     '# Run this and note the exact NAME of the client cert (e.g. ' + clientName + '.crt_0)',
//     '/certificate print detail',
//     '',
//     '# --- Add OpenVPN Client ---',
//     '# Replace "' + clientName + '.crt_0" with the exact name from the step above if different',
//     `/interface ovpn-client add name=skylink-vpn connect-to=${vpsIp} port=1194 mode=ip user=${clientName} certificate=${clientName}.crt_0 cipher=aes128 add-default-route=no disabled=no`,
//     '',
//     '# --- Verify VPN Connected ---',
//     '# Expected output:',
//     '#   status: connected',
//     '#   encoding: AES-128-CBC/SHA1',
//     '#   mtu: 1500',
//     '/interface ovpn-client monitor 0',
//     '',
//     '# --- Check Tunnel IP ---',
//     `# Expected: ${result.tunnelIp}/32 on skylink-vpn interface`,
//     '/ip address print',
//     '',
//     '# --- Configure RADIUS to use VPN tunnel ---',
//     '# This ensures RADIUS traffic always goes through the VPN, never the public IP',
//     '/radius remove [find]',
//     `/radius add address=10.8.0.1 secret=${radiusSecret} src-address=${result.tunnelIp} service=ppp,hotspot,login timeout=3000 authentication-port=1812 accounting-port=1813`,
//     '',
//     '# --- Enable RADIUS for PPPoE ---',
//     '/ppp aaa set use-radius=yes',
//     '',
//     '# --- Enable RADIUS for Hotspot (if applicable) ---',
//     '/ip hotspot profile set [find] use-radius=yes',
//     '',
//     '# --- Verify RADIUS config ---',
//     '# Expected: address=10.8.0.1  src-address=' + result.tunnelIp,
//     '/radius print',
//     '',
//   ].join('\n');

//   zip.file('MIKROTIK_SETUP.rsc', setupScript);

//   // Also include a plain text readme
//   const readme = [
//     `SkyLink VPN Config — ${router.name}`,
//     '='.repeat(40),
//     `Tunnel IP:   ${result.tunnelIp}`,
//     `Client Name: ${clientName}`,
//     `VPS IP:      ${vpsIp}`,
//     `Generated:   ${new Date().toISOString()}`,
//     '',
//     'Files in this ZIP:',
//     '  ca.crt               — Certificate Authority (same for all routers)',
//     `  ${clientName}.crt    — This router's certificate`,
//     `  ${clientName}.key    — This router's private key`,
//     '  MIKROTIK_SETUP.rsc   — MikroTik terminal commands (copy/paste)',
//     '  README.txt           — This file',
//     '',
//   ].join('\n');

//   zip.file('README.txt', readme);

//   const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

//   res.set({
//     'Content-Type':        'application/zip',
//     'Content-Disposition': `attachment; filename=${clientName}-vpn-config.zip`,
//     'Content-Length':      zipBuffer.length,
//   });
//   res.send(zipBuffer);
// });

// // @desc    Get VPN status for a router
// // @route   GET /api/routers/:id/vpn/status
// exports.getVpnStatus = asyncHandler(async (req, res, next) => {
//   const router = await Router.findById(req.params.id);
//   if (!router) return next(new ErrorResponse('Router not found', 404));

//   res.json({
//     success: true,
//     data: {
//       hasVpnConfig:  !!router.vpnClientName,
//       tunnelIp:      router.tunnelIp      || null,
//       vpnClientName: router.vpnClientName || null,
//       vpnConnected:  router.vpnConnected  || false,
//       vpnLastSeen:   router.vpnLastSeen   || null,
//     }
//   });
// });

// // @desc    Revoke VPN config for a router
// // @route   DELETE /api/routers/:id/vpn
// exports.revokeVpnConfig = asyncHandler(async (req, res, next) => {
//   const router = await Router.findById(req.params.id);
//   if (!router) return next(new ErrorResponse('Router not found', 404));

//   const result = await vpnService.revokeRouterVpnConfig(router);
//   if (!result.success) return next(new ErrorResponse(result.error, 400));

//   res.json({ success: true, message: 'VPN config revoked successfully' });
// });



// // @desc    Update router
// exports.updateRouter = asyncHandler(async (req, res, next) => {
//   const router = await Router.findById(req.params.id);
//   if (!router) return next(new ErrorResponse('Router not found', 404));
//   const { name, ip, apiPort, username, password, isActive } = req.body;
//   if (name) router.name = name;
//   if (ip) router.ip = ip;
//   if (apiPort) router.apiPort = apiPort;
//   if (username) router.username = username;
//   if (password) router.password = password;
//   if (typeof isActive !== 'undefined') router.isActive = isActive;
//   await router.save();
//   res.json({ success: true, data: router });
// });

// // @desc    Delete router
// exports.deleteRouter = asyncHandler(async (req, res, next) => {
//   const router = await Router.findById(req.params.id);
//   if (!router) return next(new ErrorResponse('Router not found', 404));
//   // Optional: check if router has active PPPoE clients? skip for now
//   await router.deleteOne();
//   res.json({ success: true, message: 'Router deleted' });
// });

// // ----------------------------------------------------------------------
// // TEST & DIAGNOSTICS (moved from siteController)
// // ----------------------------------------------------------------------

// // @desc    Test router connection
// // @route   POST /api/routers/:id/test-connection
// exports.testRouterConnection = asyncHandler(async (req, res, next) => {
//   const router = await Router.findById(req.params.id);
//   if (!router) return next(new ErrorResponse('Router not found', 404));

//   const result = await mikrotikService.testConnectionWithCredentials(
//     router.ip,
//     router.apiPort || 8728,
//     router.username,
//     router.password
//   );

//   // Update online status
//   router.lastConnectionTest = {
//     success: result.success,
//     timestamp: new Date(),
//     error: result.success ? null : result.message
//   };
//   router.isOnline = result.success;
//   if (result.success) router.lastOnline = new Date();
//   await router.save();

//   res.json({
//     success: true,
//     data: {
//       connected: result.success,
//       version: result.version,
//       identity: result.identity,
//       message: result.message
//     }
//   });
// });

// // @desc    Get router diagnostics (system info, PPPoE, sessions, etc.)
// // @route   GET /api/routers/:id/diagnostics
// exports.getRouterDiagnostics = asyncHandler(async (req, res, next) => {
//   const router = await Router.findById(req.params.id);
//   if (!router) return next(new ErrorResponse('Router not found', 404));

//   const api = await getApiConnection(router._id);
//   const diagnostics = {
//     router: {
//       name: router.name,
//       ip: router.ip,
//       isOnline: router.isOnline,
//       lastOnline: router.lastOnline
//     },
//     connection: { status: 'checking', ip: router.ip, port: router.apiPort },
//     system: null,
//     pppoe: { profiles: [], secrets: { total: 0, enabled: 0, disabled: 0, list: [] }, activeSessions: { total: 0, sessions: [] } },
//     bandwidth: { interfaces: [] },
//     summary: {},
//     diagnosticsAt: new Date().toISOString()
//   };

//   try {
//     // Test connection
//     const testResult = await mikrotikService.testConnectionWithCredentials(
//       router.ip, router.apiPort, router.username, router.password
//     );
//     if (!testResult.success) throw new Error(testResult.message);
//     diagnostics.connection.status = 'online';
//     diagnostics.connection.responseTime = testResult.responseTime;
//     diagnostics.system = { identity: testResult.identity, version: testResult.version };

//     // Get system resources
//     const resources = await mikrotikService.getSystemResources({ router: { ip: router.ip, port: router.apiPort, username: router.username, password: router.password } });
//     if (resources.success) {
//       const output = resources.data;
//       const uptimeMatch = output.match(/uptime:\s*(.+)/);
//       if (uptimeMatch) diagnostics.system.uptime = uptimeMatch[1].trim();
//       const cpuMatch = output.match(/cpu-load:\s*(\d+)%/);
//       if (cpuMatch) diagnostics.system.cpuLoad = cpuMatch[1] + '%';
//     }

//     // PPPoE profiles
//     const profilesResult = await mikrotikService.getPppoeProfiles({ router: { ip: router.ip, port: router.apiPort, username: router.username, password: router.password } });
//     if (profilesResult.success) diagnostics.pppoe.profiles = profilesResult.data;

//     // PPPoE secrets
//     const secretsResult = await mikrotikService.getPppoeSecrets({ router: { ip: router.ip, port: router.apiPort, username: router.username, password: router.password } });
//     if (secretsResult.success) {
//       let secrets = secretsResult.data.map(s => ({ ...s, disabled: s.disabled === true || s.disabled === 'yes' || s.disabled === 'true' }));
//       diagnostics.pppoe.secrets.total = secrets.length;
//       diagnostics.pppoe.secrets.enabled = secrets.filter(s => !s.disabled).length;
//       diagnostics.pppoe.secrets.disabled = secrets.filter(s => s.disabled).length;
//       diagnostics.pppoe.secrets.list = secrets;
//     }

//     // Active sessions
//     const sessionsResult = await mikrotikService.getActiveSessions({ router: { ip: router.ip, port: router.apiPort, username: router.username, password: router.password } });
//     if (sessionsResult.success) {
//       diagnostics.pppoe.activeSessions.total = sessionsResult.count;
//       diagnostics.pppoe.activeSessions.sessions = sessionsResult.sessions;
//     }

//     // Interface stats
//     const ifacesResult = await mikrotikService.getInterfaceStats({ router: { ip: router.ip, port: router.apiPort, username: router.username, password: router.password } });
//     if (ifacesResult.success) diagnostics.bandwidth.interfaces = ifacesResult.data;

//     // Summary
//     diagnostics.summary = {
//       totalSecrets: diagnostics.pppoe.secrets.total,
//       enabledSecrets: diagnostics.pppoe.secrets.enabled,
//       activeSessions: diagnostics.pppoe.activeSessions.total,
//       utilizationRate: diagnostics.pppoe.secrets.enabled > 0
//         ? ((diagnostics.pppoe.activeSessions.total / diagnostics.pppoe.secrets.enabled) * 100).toFixed(1) + '%'
//         : '0%',
//       profileCount: diagnostics.pppoe.profiles.length,
//       cpuLoad: diagnostics.system?.cpuLoad || 'N/A'
//     };

//     // Update router online status
//     router.lastConnectionTest = { success: true, timestamp: new Date(), error: null };
//     router.isOnline = true;
//     router.lastOnline = new Date();
//     await router.save();

//   } catch (error) {
//     diagnostics.connection.status = 'error';
//     diagnostics.connection.error = error.message;
//     router.lastConnectionTest = { success: false, timestamp: new Date(), error: error.message };
//     router.isOnline = false;
//     await router.save();
//   } finally {
//     await api.close().catch(() => {});
//   }
//   res.json({ success: true, data: diagnostics });
// });

// // ----------------------------------------------------------------------
// // MIKROTIK CONFIGURATION FUNCTIONS (converted from mikrotikAutoconfigurationController)
// // ----------------------------------------------------------------------

// // Helper: IPv4 ↔ integer
// function ipToInt(ip) {
//   return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
// }
// function intToIp(int) {
//   return [(int >>> 24) & 0xFF, (int >>> 16) & 0xFF, (int >>> 8) & 0xFF, int & 0xFF].join('.');
// }
// function parseCIDR(cidr) {
//   const [ipStr, prefixStr] = cidr.split('/');
//   if (!ipStr || !prefixStr) throw new Error('Invalid CIDR format');
//   const prefix = parseInt(prefixStr, 10);
//   if (isNaN(prefix) || prefix < 8 || prefix > 30) throw new Error('Prefix must be 8-30');
//   const ipInt = ipToInt(ipStr);
//   const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
//   const network = ipInt & mask;
//   const broadcast = network | (~mask >>> 0);
//   const firstUsable = network + 1;
//   const lastUsable = broadcast - 1;
//   if (firstUsable >= lastUsable) throw new Error('CIDR too small');
//   return {
//     gateway: intToIp(firstUsable),
//     poolStart: intToIp(firstUsable + 1),
//     poolEnd: intToIp(lastUsable),
//     prefix,
//     mask: intToIp(mask),
//     network: intToIp(network),
//     broadcast: intToIp(broadcast)
//   };
// }

// async function ensureFilterRule(api, params, comment) {
//   const rules = await api.write('/ip/firewall/filter/print');
//   const exists = rules.some(r => r.comment === comment);
//   if (!exists) {
//     await api.write('/ip/firewall/filter/add', [...params, `=comment=${comment}`]);
//     return { added: true };
//   }
//   return { added: false };
// }

// async function ensureNatRule(api, params, comment) {
//   const rules = await api.write('/ip/firewall/nat/print');
//   const exists = rules.some(r => r.comment === comment);
//   if (!exists) {
//     await api.write('/ip/firewall/nat/add', [...params, `=comment=${comment}`]);
//     return { added: true };
//   }
//   return { added: false };
// }

// async function ensureAddressList(api, listName, address, comment) {
//   const lists = await api.write('/ip/firewall/address-list/print');
//   const exists = lists.some(l => l.list === listName && l.address === address);
//   if (!exists) {
//     await api.write('/ip/firewall/address-list/add', [
//       `=list=${listName}`,
//       `=address=${address}`,
//       `=comment=${comment}`
//     ]);
//     return { added: true };
//   }
//   return { added: false };
// }

// // ----------------------------------------------------------------------
// // 1. CREATE BRIDGE
// // ----------------------------------------------------------------------
// exports.createBridge = asyncHandler(async (req, res, next) => {
//   const { bridgeName, interface: ifaceName } = req.body;
//   const { routerId } = req.params;
//   if (!bridgeName || !ifaceName) return next(new ErrorResponse('bridgeName and interface are required', 400));
//   const api = await getApiConnection(routerId);
//   const log = [];
//   try {
//     const allBridges = await api.write('/interface/bridge/print');
//     const existing = allBridges.find(b => b.name === bridgeName);
//     if (existing) {
//       log.push({ step: 'Bridge', status: 'skipped', message: `Bridge ${bridgeName} exists` });
//     } else {
//       await api.write('/interface/bridge/add', [`=name=${bridgeName}`, '=comment=Auto-created by ISP system']);
//       log.push({ step: 'Bridge', status: 'success', message: `Created bridge ${bridgeName}` });
//     }
//     const allPorts = await api.write('/interface/bridge/port/print');
//     const portExists = allPorts.find(p => p.interface === ifaceName);
//     if (portExists) {
//       log.push({ step: 'Bridge Port', status: 'skipped', message: `${ifaceName} already bridged` });
//     } else {
//       await api.write('/interface/bridge/port/add', [`=interface=${ifaceName}`, `=bridge=${bridgeName}`]);
//       log.push({ step: 'Bridge Port', status: 'success', message: `Added ${ifaceName} to ${bridgeName}` });
//     }
//     res.json({ success: true, log });
//   } catch (error) {
//     log.push({ step: 'Error', status: 'error', message: error.message });
//     res.status(500).json({ success: false, error: error.message, log });
//   } finally { await api.close(); }
// });

// // ----------------------------------------------------------------------
// // 2. CREATE IP POOL AND GATEWAY
// // ----------------------------------------------------------------------
// exports.createIpPool = asyncHandler(async (req, res, next) => {
//   const { cidr, gatewayInterface } = req.body;
//   const { routerId } = req.params;
//   if (!cidr || !gatewayInterface) return next(new ErrorResponse('cidr and gatewayInterface required', 400));
//   let cidrInfo;
//   try { cidrInfo = parseCIDR(cidr); } catch (err) { return next(new ErrorResponse(err.message, 400)); }
//   const api = await getApiConnection(routerId);
//   const log = [];
//   try {
//     const interfaces = await api.write('/interface/print');
//     if (!interfaces.some(i => i.name === gatewayInterface)) throw new Error(`Interface ${gatewayInterface} not found`);
//     log.push({ step: 'Interface Check', status: 'success', message: `Found ${gatewayInterface}` });

//     const gatewayAddr = `${cidrInfo.gateway}/${cidrInfo.prefix}`;
//     const existingIps = await api.write('/ip/address/print');
//     if (existingIps.some(ip => ip.address === gatewayAddr)) {
//       log.push({ step: 'Gateway IP', status: 'skipped', message: `${gatewayAddr} exists` });
//     } else {
//       await api.write('/ip/address/add', [`=address=${gatewayAddr}`, `=interface=${gatewayInterface}`, '=comment=PPPoE gateway']);
//       log.push({ step: 'Gateway IP', status: 'success', message: `Added ${gatewayAddr}` });
//     }

//     const poolName = 'active-pool';
//     const poolRange = `${cidrInfo.poolStart}-${cidrInfo.poolEnd}`;
//     const existingPools = await api.write('/ip/pool/print');
//     if (existingPools.some(p => p.name === poolName)) {
//       log.push({ step: 'Pool', status: 'skipped', message: `${poolName} exists` });
//     } else {
//       await api.write('/ip/pool/add', [`=name=${poolName}`, `=ranges=${poolRange}`, '=comment=Auto-created']);
//       log.push({ step: 'Pool', status: 'success', message: `Created ${poolName}: ${poolRange}` });
//     }

//     const natResult = await ensureNatRule(api, ['=chain=srcnat', `=src-address=${cidr}`, '=action=masquerade'], `Masquerade for ${poolName}`);
//     log.push({ step: 'NAT', status: natResult.added ? 'success' : 'skipped', message: natResult.added ? 'Added masquerade' : 'Rule exists' });

//     // Error pools (expired, credential, non-existent, mac-difference)
//     const errorPools = [
//       { name: 'expired-pool', cidr: '10.254.254.0/24', comment: 'Expired users' },
//       { name: 'credential-pool', cidr: '20.20.0.0/16', comment: 'Wrong password' },
//       { name: 'non-existent', cidr: '30.30.0.0/16', comment: 'Non-existent user' },
//       { name: 'mac-difference', cidr: '40.40.0.0/16', comment: 'MAC mismatch' }
//     ];
//     for (const pool of errorPools) {
//       const poolCidr = parseCIDR(pool.cidr);
//       const gw = `${poolCidr.gateway}/${poolCidr.prefix}`;
//       const addrExists = existingIps.some(ip => ip.address === gw);
//       if (!addrExists) {
//         await api.write('/ip/address/add', [`=address=${gw}`, `=interface=${gatewayInterface}`, `=comment=${pool.comment} gateway`]);
//         log.push({ step: 'Error Gateway', status: 'success', message: `Added ${gw}` });
//       }
//       const poolExists = existingPools.some(p => p.name === pool.name);
//       if (!poolExists) {
//         await api.write('/ip/pool/add', [`=name=${pool.name}`, `=ranges=${poolCidr.poolStart}-${poolCidr.poolEnd}`, `=comment=${pool.comment}`]);
//         log.push({ step: 'Error Pool', status: 'success', message: `Created ${pool.name}` });
//       }
//     }
//     res.json({ success: true, log });
//   } catch (error) {
//     log.push({ step: 'Error', status: 'error', message: error.message });
//     res.status(500).json({ success: false, error: error.message, log });
//   } finally { await api.close(); }
// });

// // ----------------------------------------------------------------------
// // 3. CREATE PPPOE SERVER
// // ----------------------------------------------------------------------
// exports.createPppoeServer = asyncHandler(async (req, res, next) => {
//   const { interface: ifaceName, serviceName } = req.body;
//   const { routerId } = req.params;
//   if (!ifaceName || !serviceName) return next(new ErrorResponse('interface and serviceName required', 400));
//   const api = await getApiConnection(routerId);
//   const log = [];
//   try {
//     const profileName = 'radius-profile';
//     const profiles = await api.write('/ppp/profile/print');
//     if (!profiles.some(p => p.name === profileName)) {
//       const addresses = await api.write('/ip/address/print');
//       const pppoeGateway = addresses.find(a => a.comment && a.comment.includes('PPPoE gateway'));
//       if (!pppoeGateway) throw new Error('PPPoE gateway not found. Run IP pool step first.');
//       const localAddress = pppoeGateway.address.split('/')[0];
//       await api.write('/ppp/profile/add', [
//         `=name=${profileName}`,
//         `=local-address=${localAddress}`,
//         '=remote-address=active-pool',
//         '=dns-server=8.8.8.8,8.8.4.4',
//         '=only-one=yes',
//         '=use-encryption=no',
//         '=comment=Auto-created'
//       ]);
//       log.push({ step: 'PPP Profile', status: 'success', message: `Created ${profileName}` });
//     } else {
//       log.push({ step: 'PPP Profile', status: 'skipped', message: `${profileName} exists` });
//     }
//     const servers = await api.write('/interface/pppoe-server/server/print');
//     if (!servers.some(s => s.interface === ifaceName)) {
//       await api.write('/interface/pppoe-server/server/add', [
//         `=interface=${ifaceName}`,
//         `=service-name=${serviceName}`,
//         `=default-profile=${profileName}`,
//         '=authentication=pap',
//         '=disabled=no'
//       ]);
//       log.push({ step: 'PPPoE Server', status: 'success', message: `Created on ${ifaceName}` });
//     } else {
//       log.push({ step: 'PPPoE Server', status: 'skipped', message: 'Server already exists' });
//     }
//     res.json({ success: true, log });
//   } catch (error) {
//     log.push({ step: 'Error', status: 'error', message: error.message });
//     res.status(500).json({ success: false, error: error.message, log });
//   } finally { await api.close(); }
// });

// // ----------------------------------------------------------------------
// // 4. ENABLE RADIUS
// // ----------------------------------------------------------------------
// exports.enableRadius = asyncHandler(async (req, res, next) => {
//   const { routerId } = req.params;
//   const router = await Router.findById(routerId).populate('site');
//   if (!router) return next(new ErrorResponse('Router not found', 404));
//   const radiusIp = process.env.RADIUS_SERVER_IP;
//   const radiusSecret = process.env.RADIUS_SECRET || 'defaultSecret';
//   const api = await getApiConnection(routerId);
//   const log = [];
//   try {
//     const radServers = await api.write('/radius/print');
//     if (!radServers.some(r => r.address === radiusIp)) {
//       await api.write('/radius/add', [`=address=${radiusIp}`, `=secret=${radiusSecret}`, '=service=ppp', '=comment=RADIUS for PPPoE']);
//       log.push({ step: 'RADIUS Server', status: 'success', message: `Added ${radiusIp}` });
//     } else {
//       log.push({ step: 'RADIUS Server', status: 'skipped', message: 'Already exists' });
//     }
//     await api.write('/ppp/aaa/set', ['=use-radius=yes', '=interim-update=5m']);
//     log.push({ step: 'PPP AAA', status: 'success', message: 'Enabled RADIUS with interim updates' });
//     await api.write('/radius/incoming/set', ['=accept=yes']);
//     log.push({ step: 'RADIUS Incoming', status: 'success', message: 'Enabled CoA' });
//     // Register NAS in FreeRADIUS
//     const nasResult = await radiusService.registerNas({
//       nasname: router.ip,
//       shortname: router.site.name + '-' + router.name,
//       secret: radiusSecret,
//       type: 'mikrotik'
//     });
//     if (nasResult.success) log.push({ step: 'NAS Registration', status: 'success', message: 'Registered in FreeRADIUS' });
//     else log.push({ step: 'NAS Registration', status: 'error', message: nasResult.error });
//     res.json({ success: true, log });
//   } catch (error) {
//     log.push({ step: 'Error', status: 'error', message: error.message });
//     res.status(500).json({ success: false, error: error.message, log });
//   } finally { await api.close(); }
// });

// // ----------------------------------------------------------------------
// // 5. CONFIGURE DISABLED REDIRECT (captive portal)
// // ----------------------------------------------------------------------
// // ============================================================
// // UPDATED: CONFIGURE DISABLED REDIRECT USING PROXY METHOD
// // This approach uses MikroTik's built-in IP proxy to redirect
// // HTTP traffic while preserving the original client IP
// // ============================================================

// // ============================================================
// // CONFIGURE DISABLED REDIRECT - RouterOS v6.x COMPATIBLE
// // This version works with MikroTik RouterOS 6.x
// // ============================================================

// exports.configureDisabledRedirect = asyncHandler(async (req, res, next) => {
//   const { routerId } = req.params;
//   const { 
//     allowedPoolCidr = '10.10.0.0/16',  // Active users pool
//     bridgeInterface = 'bridge-pppoe'    // Bridge interface name
//   } = req.body;
 
//   const router = await Router.findById(routerId);
//   if (!router) return next(new ErrorResponse('Router not found', 404));
 
//   // ============================================================
//   // CONFIGURATION VARIABLES
//   // ============================================================
//   const redirectDomain = 'redirect.skylinknetworks.co.ke';
//   const proxyPort = 3346; // MikroTik proxy port
  
//   // All error pools that should be redirected
//   const errorPools = [
//     '10.254.254.0/24',  // Expired users
//     '20.20.0.0/16',     // Wrong password
//     '30.30.0.0/16',     // Non-existent user  
//     '40.40.0.0/16',     // MAC mismatch
//     '10.50.10.0/24'     // Hotspot unpaid users
//   ];
 
//   const api = await getApiConnection(routerId);
//   const log = [];
 
//   try {
//     // ============================================================
//     // STEP 1: CREATE ADDRESS LISTS
//     // ============================================================
    
//     // Add allowed users pool
//     await ensureAddressList(api, 'ALLOWED_USERS', allowedPoolCidr, 'Active PPPoE users');
//     log.push({ 
//       step: 'Allowed Users List', 
//       status: 'success', 
//       message: `Added ${allowedPoolCidr} to ALLOWED_USERS`
//     });
    
//     // Add all error pools to DISABLED_USERS list
//     for (const pool of errorPools) {
//       await ensureAddressList(api, 'DISABLED_USERS', pool, 'Disabled/Error users');
//     }
//     log.push({ 
//       step: 'Disabled Users Lists', 
//       status: 'success', 
//       message: `Added ${errorPools.length} pools to DISABLED_USERS`,
//       details: { pools: errorPools }
//     });
    
//     // Add redirect domain to address list for walled garden
//     await ensureAddressList(api, 'OI_REDIRECT_IP', redirectDomain, 'Redirect domain');
//     log.push({ 
//       step: 'Redirect Domain List', 
//       status: 'success', 
//       message: `Added ${redirectDomain} to OI_REDIRECT_IP`
//     });
 
//     // ============================================================
//     // STEP 2: CONFIGURE IP PROXY (RouterOS v6.x)
//     // ============================================================
    
//     // Enable IP proxy on port 3346
//     await api.write('/ip/proxy/set', [
//       '=enabled=yes',
//       `=port=${proxyPort}`,
//       '=max-cache-size=none',
//       '=src-address=0.0.0.0',
//       '=parent-proxy=0.0.0.0'
//     ]);
//     log.push({ 
//       step: 'IP Proxy', 
//       status: 'success', 
//       message: `Enabled IP proxy on port ${proxyPort}`
//     });
    
//     // ============================================================
//     // STEP 3: ADD PROXY ACCESS RULES (RouterOS v6.x syntax)
//     // ============================================================
    
//     // In RouterOS v6.x, proxy doesn't support action=redirect directly
//     // We need to use action=deny/allow with redirect-to parameter
//     // OR use a different approach with web-proxy
    
//     const proxyAccessRules = await api.write('/ip/proxy/access/print');
    
  
    
//     // RouterOS v6.x approach: Use action=deny with redirect-to
//     // This tells the proxy to send a redirect response
//     const redirectRuleExists = proxyAccessRules.some(r => 
//       r['redirect-to'] && r['redirect-to'].includes(redirectDomain)
//     );
    
//     if (!redirectRuleExists) {
//       // Add proxy access rule with redirect-to parameter (v6.x compatible)
//       await api.write('/ip/proxy/access/add', [
//         '=action=deny',
//         `=redirect-to=http://${redirectDomain}/portal`,
//         `=dst-host=!*.skylinknetworks.co.ke`,  // Exclude your domain
//         '=comment=Redirect to portal'
//       ]);
//       log.push({ 
//         step: 'Proxy Access Rule', 
//         status: 'success', 
//         message: `Added proxy redirect rule to ${redirectDomain}/portal`
//       });
//     } else {
//       log.push({ 
//         step: 'Proxy Access Rule', 
//         status: 'skipped', 
//         message: 'Proxy redirect rule already exists'
//       });
//     }
    
//     // Add allow rule for the redirect domain itself
//     const allowRuleExists = proxyAccessRules.some(r => 
//       r['dst-host'] && r['dst-host'].includes('skylinknetworks.co.ke')
//     );
    
//     if (!allowRuleExists) {
//       await api.write('/ip/proxy/access/add', [
//         '=action=allow',
//         '=dst-host=*.skylinknetworks.co.ke',
//         '=comment=Allow redirect domain'
//       ]);
//       log.push({ 
//         step: 'Proxy Allow Rule', 
//         status: 'success', 
//         message: 'Added allow rule for redirect domain'
//       });
//     }
 
//     // ============================================================
//     // STEP 4: CREATE FIREWALL FILTER RULES
//     // ============================================================
    
//     const filterRules = [
//       // Allow forward traffic from bridge to WAN
//       { 
//         params: [
//           '=chain=forward', 
//           `=in-interface=${bridgeInterface}`, 
//           '=out-interface=ether2', 
//           '=action=accept'
//         ], 
//         comment: 'Accept bridge-lan to WAN' 
//       },
      
//       // Allow traffic to redirect server
//       { 
//         params: [
//           '=chain=forward', 
//           '=src-address-list=DISABLED_USERS',
//           '=dst-address-list=OI_REDIRECT_IP',
//           '=action=accept'
//         ], 
//         comment: 'ALLOW portal domain' 
//       },
      
//       // Block QUIC (UDP 443) to force HTTP
//       { 
//         params: [
//           '=chain=forward', 
//           '=src-address-list=DISABLED_USERS', 
//           '=protocol=udp',
//           '=dst-port=443', 
//           '=action=drop'
//         ], 
//         comment: 'Block QUIC' 
//       },
      
//       // Block HTTPS to force captive portal
//       { 
//         params: [
//           '=chain=forward', 
//           '=src-address-list=DISABLED_USERS', 
//           '=protocol=tcp',
//           '=dst-port=443', 
//           '=action=drop'
//         ], 
//         comment: 'Block HTTPS for captive enforcement' 
//       },
      
//       // Allow DNS for disabled users (TCP)
//       { 
//         params: [
//           '=chain=forward', 
//           '=src-address-list=DISABLED_USERS', 
//           '=protocol=tcp', 
//           '=dst-port=53', 
//           '=action=accept'
//         ], 
//         comment: 'ALLOW DNS TCP' 
//       },
      
//       // Allow DNS for disabled users (UDP)
//       { 
//         params: [
//           '=chain=forward', 
//           '=src-address-list=DISABLED_USERS', 
//           '=protocol=udp', 
//           '=dst-port=53', 
//           '=action=accept'
//         ], 
//         comment: 'ALLOW DNS UDP' 
//       },
      
//       // Drop all other traffic from disabled users
//       { 
//         params: [
//           '=chain=forward', 
//           '=src-address-list=DISABLED_USERS', 
//           '=action=drop'
//         ], 
//         comment: 'BLOCK ALL INTERNET FOR DISABLED USERS' 
//       }
//     ];
 
//     for (const rule of filterRules) {
//       await ensureFilterRule(api, rule.params, rule.comment);
//     }
    
//     log.push({ 
//       step: 'Filter Rules', 
//       status: 'success', 
//       message: `Created/verified ${filterRules.length} firewall filter rules`
//     });
 
//     // ============================================================
//     // STEP 5: CREATE NAT RULES
//     // ============================================================
    
//     const natRules = [
//       // Redirect HTTP (port 80) to proxy (port 3346)
//       { 
//         params: [
//           '=chain=dstnat',
//           '=src-address-list=DISABLED_USERS',
//           '=protocol=tcp',
//           '=dst-port=80',
//           '=action=redirect',
//           `=to-ports=${proxyPort}`
//         ], 
//         comment: 'Redirect HTTP to proxy' 
//       },
      
//       // Masquerade for allowed users
//       { 
//         params: [
//           '=chain=srcnat', 
//           '=src-address-list=ALLOWED_USERS', 
//           '=action=masquerade'
//         ], 
//         comment: 'Masquerade for active-pool' 
//       },
      
//       // Masquerade DNS queries to Google DNS (primary)
//       { 
//         params: [
//           '=chain=srcnat', 
//           '=src-address-list=DISABLED_USERS', 
//           '=dst-address=8.8.8.8', 
//           '=action=masquerade'
//         ], 
//         comment: 'Masquerade DNS to 8.8.8.8' 
//       },
      
//       // Masquerade DNS queries to Google DNS (secondary)
//       { 
//         params: [
//           '=chain=srcnat', 
//           '=src-address-list=DISABLED_USERS', 
//           '=dst-address=8.8.4.4', 
//           '=action=masquerade'
//         ], 
//         comment: 'Masquerade DNS to 8.8.4.4' 
//       },
      
//       // Masquerade traffic to redirect domain
//       { 
//         params: [
//           '=chain=srcnat', 
//           '=src-address-list=DISABLED_USERS', 
//           '=dst-address-list=OI_REDIRECT_IP', 
//           '=action=masquerade'
//         ], 
//         comment: 'Masquerade to redirect domain' 
//       },
      
//       // Force DNS redirect (UDP) - ensure disabled users use MikroTik DNS
//       { 
//         params: [
//           '=chain=dstnat',
//           '=src-address-list=DISABLED_USERS',
//           '=protocol=udp',
//           '=dst-port=53',
//           '=action=redirect',
//           '=to-ports=53'
//         ], 
//         comment: 'Force DNS UDP' 
//       },
      
//       // Force DNS redirect (TCP) - ensure disabled users use MikroTik DNS
//       { 
//         params: [
//           '=chain=dstnat',
//           '=src-address-list=DISABLED_USERS',
//           '=protocol=tcp',
//           '=dst-port=53',
//           '=action=redirect',
//           '=to-ports=53'
//         ], 
//         comment: 'Force DNS TCP' 
//       }
//     ];
 
//     // Apply all NAT rules
//     for (const rule of natRules) {
//       await ensureNatRule(api, rule.params, rule.comment);
//     }
    
//     log.push({ 
//       step: 'NAT Rules', 
//       status: 'success', 
//       message: `Created/verified ${natRules.length} NAT rules`,
//       details: {
//         proxyPort,
//         redirectDomain
//       }
//     });
 
//     // ============================================================
//     // STEP 6: VERIFICATION AND SUMMARY
//     // ============================================================
//     log.push({
//       step: 'Configuration Complete',
//       status: 'success',
//       message: 'Proxy-based redirect configured successfully (RouterOS v6.x)',
//       configuration: {
//         method: 'IP Proxy with HTTP redirect (v6.x compatible)',
//         redirectDomain,
//         proxyPort,
//         disabledPools: errorPools,
//         allowedPool: allowedPoolCidr,
//         ipPreservation: 'Original client IP preserved via proxy',
//         captivePortalUrl: `http://${redirectDomain}/portal`,
//         routerOSVersion: '6.x compatible'
//       },
//       instructions: [
//         'Users in DISABLED_USERS pools will be redirected to the captive portal',
//         'Proxy uses action=deny with redirect-to parameter (v6.x syntax)',
//         'Original client IP is preserved and passed to redirect server',
//         'HTTPS is blocked to force users to HTTP for portal redirect',
//         'DNS is allowed for domain resolution',
//         'Configure your Node.js redirect server to handle requests at /portal'
//       ]
//     });
 
//     res.json({ success: true, log });
 
//   } catch (error) {
//     log.push({ step: 'Error', status: 'error', message: error.message });
//     res.status(500).json({ success: false, error: error.message, log });
//   } finally { 
//     await api.close().catch(() => {}); 
//   }
// });


// // ----------------------------------------------------------------------
// // 6. SYSTEM SCRIPTS & AUTOMATION
// // ----------------------------------------------------------------------
// async function ensureScript(api, name, source, comment) {
//   const existing = await api.write('/system/script/print', [`?name=${name}`]);
//   if (existing.length) return { added: false };
//   await api.write('/system/script/add', [`=name=${name}`, `=source=${source}`, '=policy=read,write,test', `=comment=${comment}`]);
//   return { added: true };
// }
// async function ensureScheduler(api, name, onEvent, startTime, comment) {
//   const existing = await api.write('/system/scheduler/print', [`?name=${name}`]);
//   if (existing.length) return { added: false };
//   await api.write('/system/scheduler/add', [`=name=${name}`, `=on-event=${onEvent}`, `=start-time=${startTime}`, `=comment=${comment}`]);
//   return { added: true };
// }
// async function ensureNetwatch(api, host, downScript, upScript, interval, timeout, comment) {
//   const existing = await api.write('/tool/netwatch/print', [`?host=${host}`]);
//   if (existing.length) return { added: false };
//   await api.write('/tool/netwatch/add', [`=host=${host}`, `=interval=${interval}`, `=timeout=${timeout}`, `=down-script=${downScript}`, `=up-script=${upScript}`, `=comment=${comment}`]);
//   return { added: true };
// }

// exports.configureSystemScripts = asyncHandler(async (req, res, next) => {
//   const { routerId } = req.params;
//   const api = await getApiConnection(routerId);
//   const log = [];
//   try {
//     const scripts = [
//       { name: 'mark-down', source: ':log info "Internet down – flag set."', comment: 'Mark internet down' },
//       { name: 'restart-pppoe', source: ':log info "Internet restored – removing PPPoE sessions." ; /ppp active remove [find]', comment: 'Restart PPPoE' },
//       { name: 'clear-pppoe-on-startup', source: ':delay 60s; /ppp active remove [find]; :log info "Startup: cleared PPPoE sessions"', comment: 'Clear on boot' }
//     ];
//     for (const s of scripts) {
//       const result = await ensureScript(api, s.name, s.source, s.comment);
//       log.push({ step: 'Script', status: result.added ? 'success' : 'skipped', message: result.added ? `Created ${s.name}` : `${s.name} exists` });
//     }
//     const scheduler = await ensureScheduler(api, 'startup-clear-sessions', 'clear-pppoe-on-startup', 'startup', 'Clear PPPoE after boot');
//     log.push({ step: 'Scheduler', status: scheduler.added ? 'success' : 'skipped', message: scheduler.added ? 'Created scheduler' : 'Scheduler exists' });
//     const netwatch = await ensureNetwatch(api, '8.8.8.8', 'mark-down', 'restart-pppoe', '30s', '10s', 'Internet watchdog');
//     log.push({ step: 'Netwatch', status: netwatch.added ? 'success' : 'skipped', message: netwatch.added ? 'Created netwatch' : 'Netwatch exists' });
//     res.json({ success: true, log });
//   } catch (error) {
//     log.push({ step: 'Error', status: 'error', message: error.message });
//     res.status(500).json({ success: false, error: error.message, log });
//   } finally { await api.close(); }
// });

// // ----------------------------------------------------------------------
// // 7. CONFIGURATION STATUS & GET EXISTING CONFIG
// // ----------------------------------------------------------------------
// exports.getConfigurationStatus = asyncHandler(async (req, res, next) => {
//   const { routerId } = req.params;
//   const api = await getApiConnection(routerId);
//   const status = { bridge: false, ipPools: false, pppoeServer: false, radius: false, disabledRedirect: false, systemScripts: false, netwatch: false };
//   try {
//     const bridges = await api.write('/interface/bridge/print');
//     status.bridge = bridges.some(b => b.name === 'bridge-pppoe' || b.comment?.includes('Auto-created'));
//     const pools = await api.write('/ip/pool/print');
//     const required = ['active-pool', 'expired-pool', 'credential-pool', 'non-existent', 'mac-difference'];
//     status.ipPools = required.every(r => pools.some(p => p.name === r));
//     const servers = await api.write('/interface/pppoe-server/server/print');
//     status.pppoeServer = servers.length > 0;
//     const radiusServers = await api.write('/radius/print');
//     const aaa = await api.write('/ppp/aaa/print');
//     status.radius = (aaa[0] && aaa[0]['use-radius'] === 'true') && radiusServers.length > 0;
//     const filterRules = await api.write('/ip/firewall/filter/print');
//     const natRules = await api.write('/ip/firewall/nat/print');
//     status.disabledRedirect = filterRules.some(r => r.comment?.includes('OI_EXPIRED')) && natRules.some(r => r.comment?.includes('OI_EXPIRED_REDIRECT_HTTP'));
//     const scripts = await api.write('/system/script/print');
//     status.systemScripts = scripts.some(s => s.name === 'mark-down');
//     const netwatches = await api.write('/tool/netwatch/print');
//     status.netwatch = netwatches.some(n => n.host === '8.8.8.8');
//     res.json({ success: true, data: status });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   } finally { await api.close(); }
// });

// exports.getExistingConfig = asyncHandler(async (req, res, next) => {
//   const { routerId } = req.params;
//   const api = await getApiConnection(routerId);
//   try {
//     const [bridges, pools, profiles, servers, scripts, schedulers, netwatches] = await Promise.all([
//       api.write('/interface/bridge/print'),
//       api.write('/ip/pool/print'),
//       api.write('/ppp/profile/print'),
//       api.write('/interface/pppoe-server/server/print'),
//       api.write('/system/script/print'),
//       api.write('/system/scheduler/print'),
//       api.write('/tool/netwatch/print')
//     ]);
//     res.json({ success: true, data: { bridges, pools, profiles, servers, scripts, schedulers, netwatches } });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   } finally { await api.close(); }
// });

// exports.getRouterInterfaces = asyncHandler(async (req, res, next) => {
//   const { routerId } = req.params;
//   const api = await getApiConnection(routerId);
//   try {
//     const interfaces = await api.write('/interface/print');
    
//     // SAFETY: node-routeros can return non-array for single/no results
//     const rawArray = Array.isArray(interfaces) ? interfaces : [];
    
//     const interfaceList = rawArray.map(iface => ({
//       name: iface.name || 'unknown', 
//       type: iface.type || 'unknown', 
//       running: iface.running === 'true' || iface.running === true,
//       disabled: iface.disabled === 'true' || iface.disabled === true, 
//       comment: iface.comment || ''
//     }));
    
//     res.json({ success: true, data: interfaceList });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   } finally { 
//     await api.close().catch(() => {}); 
//   }
// });




const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Router = require('../models/Router');
const Site = require('../models/Site');
const IfaceStatsTimeseries = require('../models/IfaceStatsTimeseries');
const SystemLog = require('../models/SystemLog');
const mikrotikService = require('../services/mikroticService');
const radiusService = require('../services/radiusService');
const JSZip      = require('jszip');
const vpnService = require('../services/vpnService');

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
// routerController.js - getRouters

// @desc    Get all routers with pagination, search by name/IP, and site filter
// @route   GET /api/routers
// @access  Private
exports.getRouters = asyncHandler(async (req, res) => {
  const {
    site,
    page = 1,
    limit = 10,
    search,
    sortBy = 'name',
    sortOrder = 'asc'
  } = req.query;

  const filter = {};

  // Region filter from session
  if (req.session.selectedRegion && req.session.selectedRegion !== 'ALL') {
    filter.regionCode = req.session.selectedRegion;
  }

  // Explicit site filter
  if (site) {
    filter.site = site;
  }

  // Search by name or IP (partial match, case-insensitive)
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { ip: { $regex: search, $options: 'i' } }
    ];
  }

  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitNum = parseInt(limit);

  const [routers, total] = await Promise.all([
    Router.find(filter)
      .populate('site', 'name regionCode')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Router.countDocuments(filter)
  ]);

  res.json({
    success: true,
    data: {
      routers,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    }
  });
});



exports.getRoutersForFilters = asyncHandler(async (req, res) => {
  let filter = {};

  // If user is logged into a specific region (not 'ALL'), filter by that regionCode
  if (req.session.selectedRegion && req.session.selectedRegion !== 'ALL') {
    filter.regionCode = req.session.selectedRegion;
  }

  // Override with explicit site filter if provided
  if (req.query.site) {
    filter.site = req.query.site;
  }

  const routers = await Router.find(filter);
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
  const { name, siteId, username, password } = req.body;
  if (!name || !siteId || !username || !password) {
    return next(new ErrorResponse('Missing required fields: name, siteId, username, password', 400));
  }
  const site = await Site.findById(siteId);
  if (!site) return next(new ErrorResponse('Site not found', 404));

  const router = await Router.create({
    ip: '0.0.0.0',
    name,
    site: siteId,
    username,
    password,
    isActive: true,
    regionCode: site.regionCode,
  });

  // Generate VPN config (certificates, client name, tunnel IP)
  const vpnResult = await vpnService.generateRouterVpnConfig(router);
  if (vpnResult.success) {
    router.ip = vpnResult.tunnelIp;
    router.tunnelIp = vpnResult.tunnelIp;
    router.vpnClientName = vpnResult.clientName;
    router.vpnConnected = false;
    await router.save();
  } else {
    console.error('VPN generation failed:', vpnResult.error);
  }

  res.status(201).json({ success: true, data: router });
});


// @desc    Get MikroTik script to set up OVPN client
// @route   GET /api/routers/:id/vpn/script
exports.getVpnSetupScript = asyncHandler(async (req, res, next) => {
  const router = await Router.findById(req.params.id);
  if (!router) return next(new ErrorResponse('Router not found', 404));
  if (!router.vpnClientName) {
    return next(new ErrorResponse('VPN config not generated yet', 400));
  }

  const clientName    = router.vpnClientName;
  const vpsIp         = process.env.VPS_PUBLIC_IP || process.env.VPN_SERVER_IP || 'your-vpn-server-ip';
  const radiusSecret  = process.env.RADIUS_SECRET || '';
  const tunnelIp      = router.tunnelIp || '';

  const script = [
    '#DO NOT RUN THE WHOLE SCRIPT AT ONCE, COPY AND RUN BLOCK BY BLOCK',
    '# import the certificates',
    '/certificate import file-name=ca.crt passphrase=""',
    `/certificate import file-name=${clientName}.crt passphrase=""`,
    `/certificate import file-name=${clientName}.key passphrase=""`,
    '',
    '#CONFIRM YOUR MIKROTIK VERSION AND COPY THE OVPN SETUP LINE THAT MATCHES IT',
    '# set up ovpn client routers version 6',
    `/interface ovpn-client add name=skylink-vpn connect-to=${vpsIp} port=1194 mode=ip user=${clientName} certificate=${clientName}.crt_0 cipher=aes128 add-default-route=no disabled=no`,
    '',
    '# set up ovpn client routers version 7+',
    `/interface ovpn-client add name=skylink-vpn connect-to=${vpsIp} port=1194 mode=ip user=${clientName} certificate=${clientName}.crt_0 cipher=aes128-cbc add-default-route=no disabled=no`,
    '',
    '# point radius to the vpn tunnel',
    
    `/radius add address=10.8.0.1 secret=${radiusSecret} src-address=${tunnelIp} service=ppp,hotspot authentication-port=1812 accounting-port=1813`,
    '',
  ].join('\n');

  res.set('Content-Type', 'text/plain');
  res.send(script);
});


// @desc    Generate VPN config for a router
// @route   POST /api/routers/:id/vpn/generate
// @desc    Generate VPN config for a router
// @route   POST /api/routers/:id/vpn/generate
exports.generateVpnConfig = asyncHandler(async (req, res, next) => {
  const router = await Router.findById(req.params.id);
  if (!router) return next(new ErrorResponse('Router not found', 404));

  const result = await vpnService.generateRouterVpnConfig(router);
  if (!result.success) return next(new ErrorResponse(result.error || 'VPN generation failed', 500));

  res.json({
    success:    true,
    tunnelIp:   result.tunnelIp,
    clientName: result.clientName,
    message:    `VPN config generated. Update router IP to ${result.tunnelIp} after connecting.`
  });
});

// @desc    Download VPN cert bundle as ZIP (certificates only)
// @route   GET /api/routers/:id/vpn/download
exports.downloadVpnConfig = asyncHandler(async (req, res, next) => {
  const router = await Router.findById(req.params.id);
  if (!router) return next(new ErrorResponse('Router not found', 404));

  const vpnService = require('../services/vpnService');
  const result = await vpnService.generateRouterVpnConfig(router);
  if (!result.success) return next(new ErrorResponse(result.error || 'VPN config unavailable', 500));

  const JSZip = require('jszip');
  const zip = new JSZip();

  // Add the three certificate files only (ca.crt, <client>.crt, <client>.key)
  for (const [name, buffer] of Object.entries(result.files)) {
    zip.file(name, buffer);
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

  res.set({
    'Content-Type':        'application/zip',
    'Content-Disposition': `attachment; filename=${result.clientName}-vpn-config.zip`,
    'Content-Length':      zipBuffer.length,
  });
  res.send(zipBuffer);
});

// @desc    Get VPN status for a router
// @route   GET /api/routers/:id/vpn/status
exports.getVpnStatus = asyncHandler(async (req, res, next) => {
  const router = await Router.findById(req.params.id);
  if (!router) return next(new ErrorResponse('Router not found', 404));

  res.json({
    success: true,
    data: {
      hasVpnConfig:  !!router.vpnClientName,
      tunnelIp:      router.tunnelIp      || null,
      vpnClientName: router.vpnClientName || null,
      vpnConnected:  router.vpnConnected  || false,
      vpnLastSeen:   router.vpnLastSeen   || null,
    }
  });
});

// @desc    Revoke VPN config for a router
// @route   DELETE /api/routers/:id/vpn
exports.revokeVpnConfig = asyncHandler(async (req, res, next) => {
  const router = await Router.findById(req.params.id);
  if (!router) return next(new ErrorResponse('Router not found', 404));

  const result = await vpnService.revokeRouterVpnConfig(router);
  if (!result.success) return next(new ErrorResponse(result.error, 400));

  res.json({ success: true, message: 'VPN config revoked successfully' });
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
  router.vpnConnected = result.success;
  if (result.success) router.vpnLastSeen = new Date();

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
// ============================================================
// UPDATED: CONFIGURE DISABLED REDIRECT USING PROXY METHOD
// This approach uses MikroTik's built-in IP proxy to redirect
// HTTP traffic while preserving the original client IP
// ============================================================

// ============================================================
// CONFIGURE DISABLED REDIRECT - RouterOS v6.x COMPATIBLE
// This version works with MikroTik RouterOS 6.x
// ============================================================

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
  const redirectDomain = 'redirect.skylinknetworks.co.ke';
  const proxyPort = 3346; // MikroTik proxy port
  
  // All error pools that should be redirected
  const errorPools = [
    '10.254.254.0/24',  // Expired users
    '20.20.0.0/16',     // Wrong password
    '30.30.0.0/16',     // Non-existent user  
    '40.40.0.0/16',     // MAC mismatch
    '10.50.10.0/24'     // Hotspot unpaid users
  ];
 
  const api = await getApiConnection(routerId);
  const log = [];
 
  try {
    // ============================================================
    // STEP 1: CREATE ADDRESS LISTS
    // ============================================================
    
    // Add allowed users pool
    await ensureAddressList(api, 'ALLOWED_USERS', allowedPoolCidr, 'Active PPPoE users');
    log.push({ 
      step: 'Allowed Users List', 
      status: 'success', 
      message: `Added ${allowedPoolCidr} to ALLOWED_USERS`
    });
    
    // Add all error pools to DISABLED_USERS list
    for (const pool of errorPools) {
      await ensureAddressList(api, 'DISABLED_USERS', pool, 'Disabled/Error users');
    }
    log.push({ 
      step: 'Disabled Users Lists', 
      status: 'success', 
      message: `Added ${errorPools.length} pools to DISABLED_USERS`,
      details: { pools: errorPools }
    });
    
    // Add redirect domain to address list for walled garden
    await ensureAddressList(api, 'OI_REDIRECT_IP', redirectDomain, 'Redirect domain');
    log.push({ 
      step: 'Redirect Domain List', 
      status: 'success', 
      message: `Added ${redirectDomain} to OI_REDIRECT_IP`
    });
 
    // ============================================================
    // STEP 2: CONFIGURE IP PROXY (RouterOS v6.x)
    // ============================================================
    
    // Enable IP proxy on port 3346
    await api.write('/ip/proxy/set', [
      '=enabled=yes',
      `=port=${proxyPort}`,
      '=max-cache-size=none',
      '=src-address=0.0.0.0',
      '=parent-proxy=0.0.0.0'
    ]);
    log.push({ 
      step: 'IP Proxy', 
      status: 'success', 
      message: `Enabled IP proxy on port ${proxyPort}`
    });
    
    // ============================================================
    // STEP 3: ADD PROXY ACCESS RULES (RouterOS v6.x syntax)
    // ============================================================
    
    // In RouterOS v6.x, proxy doesn't support action=redirect directly
    // We need to use action=deny/allow with redirect-to parameter
    // OR use a different approach with web-proxy
    
    const proxyAccessRules = await api.write('/ip/proxy/access/print');
    
  
    
    // RouterOS v6.x approach: Use action=deny with redirect-to
    // This tells the proxy to send a redirect response
    const redirectRuleExists = proxyAccessRules.some(r => 
      r['redirect-to'] && r['redirect-to'].includes(redirectDomain)
    );
    
    if (!redirectRuleExists) {
      // Add proxy access rule with redirect-to parameter (v6.x compatible)
      await api.write('/ip/proxy/access/add', [
        '=action=deny',
        `=redirect-to=http://${redirectDomain}/portal`,
        `=dst-host=!*.skylinknetworks.co.ke`,  // Exclude your domain
        '=comment=Redirect to portal'
      ]);
      log.push({ 
        step: 'Proxy Access Rule', 
        status: 'success', 
        message: `Added proxy redirect rule to ${redirectDomain}/portal`
      });
    } else {
      log.push({ 
        step: 'Proxy Access Rule', 
        status: 'skipped', 
        message: 'Proxy redirect rule already exists'
      });
    }
    
    // Add allow rule for the redirect domain itself
    const allowRuleExists = proxyAccessRules.some(r => 
      r['dst-host'] && r['dst-host'].includes('skylinknetworks.co.ke')
    );
    
    if (!allowRuleExists) {
      await api.write('/ip/proxy/access/add', [
        '=action=allow',
        '=dst-host=*.skylinknetworks.co.ke',
        '=comment=Allow redirect domain'
      ]);
      log.push({ 
        step: 'Proxy Allow Rule', 
        status: 'success', 
        message: 'Added allow rule for redirect domain'
      });
    }
 
    // ============================================================
    // STEP 4: CREATE FIREWALL FILTER RULES
    // ============================================================
    
    const filterRules = [
      // Allow forward traffic from bridge to WAN
      { 
        params: [
          '=chain=forward', 
          `=in-interface=${bridgeInterface}`, 
          '=out-interface=ether2', 
          '=action=accept'
        ], 
        comment: 'Accept bridge-lan to WAN' 
      },
      
      // Allow traffic to redirect server
      { 
        params: [
          '=chain=forward', 
          '=src-address-list=DISABLED_USERS',
          '=dst-address-list=OI_REDIRECT_IP',
          '=action=accept'
        ], 
        comment: 'ALLOW portal domain' 
      },
      
      // Block QUIC (UDP 443) to force HTTP
      { 
        params: [
          '=chain=forward', 
          '=src-address-list=DISABLED_USERS', 
          '=protocol=udp',
          '=dst-port=443', 
          '=action=drop'
        ], 
        comment: 'Block QUIC' 
      },
      
      // Block HTTPS to force captive portal
      { 
        params: [
          '=chain=forward', 
          '=src-address-list=DISABLED_USERS', 
          '=protocol=tcp',
          '=dst-port=443', 
          '=action=drop'
        ], 
        comment: 'Block HTTPS for captive enforcement' 
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
        comment: 'ALLOW DNS TCP' 
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
        comment: 'ALLOW DNS UDP' 
      },
      
      // Drop all other traffic from disabled users
      { 
        params: [
          '=chain=forward', 
          '=src-address-list=DISABLED_USERS', 
          '=action=drop'
        ], 
        comment: 'BLOCK ALL INTERNET FOR DISABLED USERS' 
      }
    ];
 
    for (const rule of filterRules) {
      await ensureFilterRule(api, rule.params, rule.comment);
    }
    
    log.push({ 
      step: 'Filter Rules', 
      status: 'success', 
      message: `Created/verified ${filterRules.length} firewall filter rules`
    });
 
    // ============================================================
    // STEP 5: CREATE NAT RULES
    // ============================================================
    
    const natRules = [
      // Redirect HTTP (port 80) to proxy (port 3346)
      { 
        params: [
          '=chain=dstnat',
          '=src-address-list=DISABLED_USERS',
          '=protocol=tcp',
          '=dst-port=80',
          '=action=redirect',
          `=to-ports=${proxyPort}`
        ], 
        comment: 'Redirect HTTP to proxy' 
      },
      
      // Masquerade for allowed users
      { 
        params: [
          '=chain=srcnat', 
          '=src-address-list=ALLOWED_USERS', 
          '=action=masquerade'
        ], 
        comment: 'Masquerade for active-pool' 
      },
      
      // Masquerade DNS queries to Google DNS (primary)
      { 
        params: [
          '=chain=srcnat', 
          '=src-address-list=DISABLED_USERS', 
          '=dst-address=8.8.8.8', 
          '=action=masquerade'
        ], 
        comment: 'Masquerade DNS to 8.8.8.8' 
      },
      
      // Masquerade DNS queries to Google DNS (secondary)
      { 
        params: [
          '=chain=srcnat', 
          '=src-address-list=DISABLED_USERS', 
          '=dst-address=8.8.4.4', 
          '=action=masquerade'
        ], 
        comment: 'Masquerade DNS to 8.8.4.4' 
      },
      
      // Masquerade traffic to redirect domain
      { 
        params: [
          '=chain=srcnat', 
          '=src-address-list=DISABLED_USERS', 
          '=dst-address-list=OI_REDIRECT_IP', 
          '=action=masquerade'
        ], 
        comment: 'Masquerade to redirect domain' 
      },
      
      // Force DNS redirect (UDP) - ensure disabled users use MikroTik DNS
      { 
        params: [
          '=chain=dstnat',
          '=src-address-list=DISABLED_USERS',
          '=protocol=udp',
          '=dst-port=53',
          '=action=redirect',
          '=to-ports=53'
        ], 
        comment: 'Force DNS UDP' 
      },
      
      // Force DNS redirect (TCP) - ensure disabled users use MikroTik DNS
      { 
        params: [
          '=chain=dstnat',
          '=src-address-list=DISABLED_USERS',
          '=protocol=tcp',
          '=dst-port=53',
          '=action=redirect',
          '=to-ports=53'
        ], 
        comment: 'Force DNS TCP' 
      }
    ];
 
    // Apply all NAT rules
    for (const rule of natRules) {
      await ensureNatRule(api, rule.params, rule.comment);
    }
    
    log.push({ 
      step: 'NAT Rules', 
      status: 'success', 
      message: `Created/verified ${natRules.length} NAT rules`,
      details: {
        proxyPort,
        redirectDomain
      }
    });
 
    // ============================================================
    // STEP 6: VERIFICATION AND SUMMARY
    // ============================================================
    log.push({
      step: 'Configuration Complete',
      status: 'success',
      message: 'Proxy-based redirect configured successfully (RouterOS v6.x)',
      configuration: {
        method: 'IP Proxy with HTTP redirect (v6.x compatible)',
        redirectDomain,
        proxyPort,
        disabledPools: errorPools,
        allowedPool: allowedPoolCidr,
        ipPreservation: 'Original client IP preserved via proxy',
        captivePortalUrl: `http://${redirectDomain}/portal`,
        routerOSVersion: '6.x compatible'
      },
      instructions: [
        'Users in DISABLED_USERS pools will be redirected to the captive portal',
        'Proxy uses action=deny with redirect-to parameter (v6.x syntax)',
        'Original client IP is preserved and passed to redirect server',
        'HTTPS is blocked to force users to HTTP for portal redirect',
        'DNS is allowed for domain resolution',
        'Configure your Node.js redirect server to handle requests at /portal'
      ]
    });
 
    res.json({ success: true, log });
 
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    res.status(500).json({ success: false, error: error.message, log });
  } finally { 
    await api.close().catch(() => {}); 
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
    
    // SAFETY: node-routeros can return non-array for single/no results
    const rawArray = Array.isArray(interfaces) ? interfaces : [];
    
    const interfaceList = rawArray.map(iface => ({
      name: iface.name || 'unknown', 
      type: iface.type || 'unknown', 
      running: iface.running === 'true' || iface.running === true,
      disabled: iface.disabled === 'true' || iface.disabled === true, 
      comment: iface.comment || ''
    }));
    
    res.json({ success: true, data: interfaceList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally { 
    await api.close().catch(() => {}); 
  }
});




// ----------------------------------------------------------------------
// 8. NMS: TOPOLOGY (LLDP/MNDP neighbors, resolved against our Router fleet)
// ----------------------------------------------------------------------
 
// @desc    Get this router's neighbors, resolved against routers we manage.
//          Matched neighbors become a router_link candidate; unmatched ones
//          are still returned (something is plugged in, but it isn't a
//          router we track yet — useful to surface, not to hide).
// @route   GET /api/routers/:id/topology
exports.getRouterTopology = asyncHandler(async (req, res, next) => {
  const { routerId } = req.params;
  const router = await Router.findById(routerId);
  if (!router) return next(new ErrorResponse('Router not found', 404));
 
  const site = {
    ip: router.ip,
    port: router.apiPort || 8728,
    username: router.username,
    password: router.password
  };
 
  const neighborsResult = await mikrotikService.getNeighbors(site);
  if (!neighborsResult.success) {
    return res.status(500).json({ success: false, error: neighborsResult.error });
  }
 
  // Resolve each neighbor's reported identity against our Router collection.
  // We match by name first (the identity string), and fall back to nothing
  // if there's no match — we do NOT guess. An unmatched neighbor is real
  // data (something is on that port), it's just not a router we manage yet.
  const identities = [...new Set(neighborsResult.data.map(n => n.remoteIdentity))];
  const matchedRouters = identities.length
    ? await Router.find({ name: { $in: identities } }).select('_id name')
    : [];
  const routerByName = new Map(matchedRouters.map(r => [r.name, r]));
 
  const links = neighborsResult.data.map(n => {
    const matched = routerByName.get(n.remoteIdentity);
    return {
      localRouterId: router._id,
      localRouterName: router.name,
      localInterface: n.localInterface,
      remoteIdentity: n.remoteIdentity,
      remoteInterfaceName: n.remoteInterfaceName,
      remoteMac: n.remoteMac,
      remoteAddress: n.remoteAddress,
      remotePlatform: n.remotePlatform,
      // null when the neighbor isn't a router we track yet
      remoteRouterId: matched ? matched._id : null,
      resolved: Boolean(matched)
    };
  });
 
  res.json({
    success: true,
    data: {
      router: { id: router._id, name: router.name },
      links,
      summary: {
        totalNeighbors: links.length,
        resolved: links.filter(l => l.resolved).length,
        unresolved: links.filter(l => !l.resolved).length
      },
      checkedAt: new Date().toISOString()
    }
  });
});


 
// ----------------------------------------------------------------------
// 9. NMS: BANDWIDTH (raw interface counter snapshot)
// ----------------------------------------------------------------------
 
// @desc    Get a raw interface counter snapshot for this router (rx/tx bytes
//          + negotiated link speed). This is a single point-in-time reading,
//          NOT a rate — the poller/frontend computes bits-per-second by
//          diffing two consecutive snapshots. Returned here unprocessed so
//          the caller controls polling frequency and storage.
// @route   GET /api/routers/:id/bandwidth
exports.getRouterBandwidth = asyncHandler(async (req, res, next) => {
  const { routerId } = req.params;
  const router = await Router.findById(routerId);
  if (!router) return next(new ErrorResponse('Router not found', 404));
 
  const site = {
    ip: router.ip,
    port: router.apiPort || 8728,
    username: router.username,
    password: router.password
  };
 
  const countersResult = await mikrotikService.getInterfaceCounters(site);
  if (!countersResult.success) {
    return res.status(500).json({ success: false, error: countersResult.error });
  }
 
  res.json({
    success: true,
    data: {
      router: { id: router._id, name: router.name },
      interfaces: countersResult.data,
      sampledAt: new Date().toISOString()
    }
  });
});
 
// @desc    Get stored bandwidth history for one interface (or all interfaces
//          if `iface` is omitted), over the requested time window. This
//          reads from IfaceStatsTimeseries — the rows written every 5 min by
//          services/pollers/bandwidthPoller.js — NOT a live router call. If
//          the poller hasn't run yet for this router, this returns an empty
//          series rather than an error; an empty graph is the correct result
//          for "no history exists yet", not a failure.
// @route   GET /api/routers/:id/bandwidth/history?minutes=30&iface=ether1
exports.getRouterBandwidthHistory = asyncHandler(async (req, res, next) => {
  const { routerId } = req.params;
  const { iface, minutes } = req.query;
 
  const router = await Router.findById(routerId);
  if (!router) return next(new ErrorResponse('Router not found', 404));
 
  // Cap the window — this is a raw-sample store with a 7-day TTL (see
  // IfaceStatsTimeseries), so requesting more than that returns whatever
  // still exists rather than erroring, but we still bound the query itself
  // to avoid an accidentally huge scan from a bad query param.
  const requestedMinutes = parseInt(minutes, 10);
  const windowMinutes = Number.isFinite(requestedMinutes) && requestedMinutes > 0
    ? Math.min(requestedMinutes, 7 * 24 * 60)
    : 30; // default: the "30 minutes ago" window this whole feature was inspired by
 
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
 
  const query = { routerId: router._id, sampledAt: { $gte: since } };
  if (iface) query.iface = iface;
 
  const rows = await IfaceStatsTimeseries.find(query)
    .sort({ sampledAt: 1 })
    .select('iface rxBps txBps ifSpeed sampledAt -_id');
 
  res.json({
    success: true,
    data: {
      router: { id: router._id, name: router.name },
      windowMinutes,
      points: rows,
      pointCount: rows.length
    }
  });
});