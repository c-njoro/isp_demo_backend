const asyncHandler = require('../middleware/asyncHandler');
const { ErrorResponse } = require('../middleware/errorHandler');
const Site = require('../models/Site');
const SystemLog = require('../models/SystemLog');
const mikrotikService = require('../services/mikroticService');
const radiusService = require('../services/radiusService');

// Helper to get API connection
async function getApiConnection(siteId) {
  const site = await Site.findById(siteId).select('+router.password');
  if (!site) throw new Error('Site not found');
  if (!site.router || !site.router.ip) throw new Error('Site router not configured');
  return await mikrotikService._getConnection(site);
}

// Helper: IPv4 string ↔ integer
function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}
function intToIp(int) {
  return [(int >>> 24) & 0xFF, (int >>> 16) & 0xFF, (int >>> 8) & 0xFF, int & 0xFF].join('.');
}

// Parse CIDR (e.g., "10.251.10.0/16")
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
  if (firstUsable >= lastUsable) throw new Error('CIDR too small (no usable IPs for clients)');
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

// Helper to create a pool and its gateway IP on the bridge
async function createPoolAndGateway(api, bridgeInterface, poolName, cidrInfo, comment) {
  const log = [];
  const gatewayAddr = `${cidrInfo.gateway}/${cidrInfo.prefix}`;
  const poolRange = `${cidrInfo.poolStart}-${cidrInfo.poolEnd}`;

  const existingPools = await api.write('/ip/pool/print', [`?name=${poolName}`]);
  if (!existingPools.length) {
    await api.write('/ip/pool/add', [
      `=name=${poolName}`,
      `=ranges=${poolRange}`,
      `=comment=${comment}`
    ]);
    log.push({ step: 'Pool', status: 'success', message: `Created ${poolName}: ${poolRange}` });
  } else {
    log.push({ step: 'Pool', status: 'skipped', message: `Pool ${poolName} already exists` });
  }

  const existingIps = await api.write('/ip/address/print');
  const gatewayExists = existingIps.some(a => a.address === gatewayAddr);
  if (!gatewayExists) {
    await api.write('/ip/address/add', [
      `=address=${gatewayAddr}`,
      `=interface=${bridgeInterface}`,
      `=comment=${comment} gateway`,
      `=network=${cidrInfo.network}`
    ]);
    log.push({ step: 'Gateway', status: 'success', message: `Assigned ${gatewayAddr} to ${bridgeInterface}` });
  } else {
    log.push({ step: 'Gateway', status: 'skipped', message: `Gateway ${gatewayAddr} already exists` });
  }
  return log;
}

// Helper to ensure a firewall filter rule exists
async function ensureFilterRule(api, params, comment) {
  const rules = await api.write('/ip/firewall/filter/print');
  const exists = rules.some(r => r.comment === comment);
  if (!exists) {
    await api.write('/ip/firewall/filter/add', [...params, `=comment=${comment}`]);
    return { added: true, comment };
  }
  return { added: false, comment };
}

// Helper to ensure a NAT rule exists
async function ensureNatRule(api, params, comment) {
  const rules = await api.write('/ip/firewall/nat/print');
  const exists = rules.some(r => r.comment === comment);
  if (!exists) {
    await api.write('/ip/firewall/nat/add', [...params, `=comment=${comment}`]);
    return { added: true, comment };
  }
  return { added: false, comment };
}

// Helper to ensure address list exists
async function ensureAddressList(api, listName, address, comment) {
  const lists = await api.write('/ip/firewall/address-list/print');
  const exists = lists.some(l => l.list === listName && l.address === address);
  if (!exists) {
    await api.write('/ip/firewall/address-list/add', [
      `=list=${listName}`,
      `=address=${address}`,
      `=comment=${comment}`
    ]);
    return { added: true, listName, address };
  }
  return { added: false, listName, address };
}

// // Helper to ensure script exists
// async function ensureScript(api, name, source, comment, policy = 'read,write,test') {
//   const scripts = await api.write('/system/script/print');
//   const exists = scripts.some(s => s.name === name);
//   if (!exists) {
//     await api.write('/system/script/add', [
//       `=name=${name}`,
//       `=owner=admin`,
//       `=policy=${policy}`,
//       `=source=${source}`,
//       `=dont-require-permissions=no`
//     ]);
//     return { added: true, name };
//   }
//   return { added: false, name };
// }

// // Helper to ensure scheduler exists
// async function ensureScheduler(api, name, onEvent, startTime, comment, policy = 'ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon') {
//   const schedulers = await api.write('/system/scheduler/print');
//   const exists = schedulers.some(s => s.name === name);
//   if (!exists) {
//     await api.write('/system/scheduler/add', [
//       `=name=${name}`,
//       `=on-event=${onEvent}`,
//       `=start-time=${startTime}`,
//       `=policy=${policy}`,
//       `=comment=${comment}`
//     ]);
//     return { added: true, name };
//   }
//   return { added: false, name };
// }

// // Helper to ensure netwatch exists
// async function ensureNetwatch(api, host, downScript, upScript, interval = '30s', timeout = '10s', comment) {
//   const netwatches = await api.write('/tool/netwatch/print');
//   const exists = netwatches.some(n => n.host === host);
//   if (!exists) {
//     await api.write('/tool/netwatch/add', [
//       `=host=${host}`,
//       `=interval=${interval}`,
//       `=timeout=${timeout}`,
//       `=down-script=${downScript}`,
//       `=up-script=${upScript}`,
//       `=comment=${comment}`
//     ]);
//     return { added: true, host };
//   }
//   return { added: false, host };
// }

// ----------------------------------------------------------------------
// STEP 1: CREATE BRIDGE
// ----------------------------------------------------------------------
exports.createBridge = asyncHandler(async (req, res, next) => {
  const { bridgeName, interface: ifaceName } = req.body;
  if (!bridgeName || !ifaceName) {
    return next(new ErrorResponse('bridgeName and interface are required', 400));
  }
  const trimmedName = bridgeName.trim();
  const api = await getApiConnection(req.params.siteId);
  const log = [];
  try {
    const allBridges = await api.write('/interface/bridge/print');
    const existing = allBridges.find(b => b.name.toLowerCase() === trimmedName.toLowerCase());
    if (existing) {
      log.push({ step: 'Bridge', status: 'skipped', message: `Bridge ${trimmedName} already exists` });
    } else {
      await api.write('/interface/bridge/add', [
        `=name=${trimmedName}`,
        `=comment=Created by ISP Management System`
      ]);
      log.push({ step: 'Bridge', status: 'success', message: `Created bridge ${trimmedName}` });
    }

    const allPorts = await api.write('/interface/bridge/port/print');
    const portExists = allPorts.find(p => p.interface === ifaceName);
    if (portExists) {
      log.push({ step: 'Bridge Port', status: 'skipped', message: `${ifaceName} already in bridge ${portExists.bridge}` });
    } else {
      await api.write('/interface/bridge/port/add', [
        `=interface=${ifaceName}`,
        `=bridge=${trimmedName}`
      ]);
      log.push({ step: 'Bridge Port', status: 'success', message: `Added ${ifaceName} to ${trimmedName}` });
    }
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    return res.status(500).json({ success: false, error: error.message, log });
  } finally {
    await api.close();
  }
  res.json({ success: true, log });
});

// ----------------------------------------------------------------------
// STEP 2: CREATE IP POOLS (Active + Error Pools) AND GATEWAY
// ----------------------------------------------------------------------
exports.createIpPool = asyncHandler(async (req, res, next) => {
  const { cidr, gatewayInterface } = req.body;

  if (!cidr || !gatewayInterface) {
    return next(new ErrorResponse('cidr and gatewayInterface are required', 400));
  }

  let cidrInfo;
  try {
    cidrInfo = parseCIDR(cidr);
  } catch (err) {
    return next(new ErrorResponse(err.message, 400));
  }

  const { gateway, poolStart, poolEnd, prefix } = cidrInfo;
  const poolName = 'active-pool';
  const gatewayAddr = `${gateway}/${prefix}`;

  const api = await getApiConnection(req.params.siteId);
  const log = [];

  try {
    // Validate interface
    const interfaces = await api.write('/interface/print');
    const interfaceExists = interfaces.some(i => i.name === gatewayInterface);
    if (!interfaceExists) {
      throw new Error(`Interface "${gatewayInterface}" does not exist on router`);
    }
    log.push({ step: 'Interface Check', status: 'success', message: `Interface ${gatewayInterface} exists` });

    // Assign gateway IP for active pool
    const existingIps = await api.write('/ip/address/print');
    const ipExists = existingIps.some(ip => ip.address === gatewayAddr);
    if (ipExists) {
      log.push({ step: 'Gateway IP', status: 'skipped', message: `Gateway ${gatewayAddr} already exists` });
    } else {
      await api.write('/ip/address/add', [
        `=address=${gatewayAddr}`,
        `=interface=${gatewayInterface}`,
        `=comment=Gateway for PPPoE clients (${cidr})`,
        `=network=${cidrInfo.network}`
      ]);
      log.push({ step: 'Gateway IP', status: 'success', message: `Assigned ${gatewayAddr} to ${gatewayInterface}` });
    }

    // Create active IP pool
    const existingPools = await api.write('/ip/pool/print');
    const poolExists = existingPools.some(p => p.name === poolName);
    if (poolExists) {
      log.push({ step: 'Active Pool', status: 'skipped', message: `Pool ${poolName} already exists` });
    } else {
      await api.write('/ip/pool/add', [
        `=name=${poolName}`,
        `=ranges=${poolStart}-${poolEnd}`,
        `=comment=Auto-created from CIDR ${cidr}`
      ]);
      log.push({ step: 'Active Pool', status: 'success', message: `Created ${poolName}: ${poolStart}-${poolEnd}` });
    }

    // Create NAT masquerade for active pool
    const natResult = await ensureNatRule(
      api,
      ['=chain=srcnat', `=src-address=${cidr}`, '=action=masquerade'],
      `Auto-created for PPPoE pool ${poolName}`
    );
    if (natResult.added) {
      log.push({ step: 'NAT Masquerade', status: 'success', message: `Added masquerade for ${cidr}` });
    } else {
      log.push({ step: 'NAT Masquerade', status: 'skipped', message: 'Masquerade rule already exists' });
    }

    // Create error pools (expired, credential, non-existent, mac-difference)
    const errorPools = [
      { name: 'expired-pool', cidr: '10.254.254.0/24', comment: 'Expired/disabled users pool' },
      { name: 'credential-pool', cidr: '20.20.0.0/16', comment: 'Wrong password pool' },
      { name: 'non-existent', cidr: '30.30.0.0/16', comment: 'Non-existent user pool' },
      { name: 'mac-difference', cidr: '40.40.0.0/16', comment: 'MAC mismatch pool' }
    ];

    for (const pool of errorPools) {
      const poolCidr = parseCIDR(pool.cidr);
      const poolLogs = await createPoolAndGateway(api, gatewayInterface, pool.name, poolCidr, pool.comment);
      log.push(...poolLogs);
    }

    log.push({ step: 'Complete', status: 'success', message: 'IP pools and gateways configured successfully' });
    res.json({ success: true, log });
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    return res.status(500).json({ success: false, error: error.message, log });
  } finally {
    await api.close();
  }
});

// ----------------------------------------------------------------------
// STEP 3: CREATE PPPOE SERVER WITH PROFILE
// ----------------------------------------------------------------------
exports.createPppoeServer = asyncHandler(async (req, res, next) => {
  const { interface: ifaceName, serviceName } = req.body;

  if (!ifaceName || !serviceName) {
    return next(new ErrorResponse('interface and serviceName are required', 400));
  }

  const api = await getApiConnection(req.params.siteId);
  const log = [];

  try {
    // Get site info to determine active pool CIDR
    const site = await Site.findById(req.params.siteId);
    
    // Create PPP profile with local address only
    const profileName = 'radius-profile';
    const profiles = await api.write('/ppp/profile/print');
    const profileExists = profiles.some(p => p.name === profileName);
    
    if (!profileExists) {
      // Get the active pool to determine local address
      const pools = await api.write('/ip/pool/print');
      const activePool = pools.find(p => p.name === 'active-pool');
      
      if (!activePool) {
        throw new Error('Active pool not found. Please create IP pools first.');
      }

      // Get gateway IP from addresses
      const addresses = await api.write('/ip/address/print');
      const pppoeGateway = addresses.find(a => a.comment && a.comment.includes('Gateway for PPPoE'));
      
      if (!pppoeGateway) {
        throw new Error('PPPoE gateway not found. Please create IP pools first.');
      }

      const localAddress = pppoeGateway.address.split('/')[0];

      await api.write('/ppp/profile/add', [
        `=name=${profileName}`,
        `=local-address=${localAddress}`,
        `=remote-address=active-pool`,
        `=dns-server=8.8.8.8,8.8.4.4`,
        `=change-tcp-mss=yes`,
        `=only-one=yes`,
        `=use-encryption=no`,
        `=comment=Auto-created by ISP Management System`
      ]);
      log.push({ step: 'PPP Profile', status: 'success', message: `Created profile ${profileName} with local address ${localAddress}` });
    } else {
      log.push({ step: 'PPP Profile', status: 'skipped', message: `Profile ${profileName} already exists` });
    }

    // Create PPPoE server with PAP authentication only
    const servers = await api.write('/interface/pppoe-server/server/print');
    const serverExists = servers.some(s => s.interface === ifaceName);
    
    if (!serverExists) {
      await api.write('/interface/pppoe-server/server/add', [
        `=interface=${ifaceName}`,
        `=service-name=${serviceName}`,
        `=default-profile=${profileName}`,
        `=authentication=pap`,
        `=disabled=no`
      ]);
      log.push({ step: 'PPPoE Server', status: 'success', message: `Created PPPoE server on ${ifaceName} with PAP auth` });
    } else {
      log.push({ step: 'PPPoE Server', status: 'skipped', message: `PPPoE server already exists on ${ifaceName}` });
    }

    log.push({ step: 'Complete', status: 'success', message: 'PPPoE server configured successfully' });
    res.json({ success: true, log });
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    return res.status(500).json({ success: false, error: error.message, log });
  } finally {
    await api.close();
  }
});

// ----------------------------------------------------------------------
// STEP 4: ENABLE RADIUS
// ----------------------------------------------------------------------
exports.enableRadius = asyncHandler(async (req, res, next) => {
  const site = await Site.findById(req.params.siteId).select('+router.password');
  if (!site || !site.router) {
    return next(new ErrorResponse('Site or router not found', 404));
  }

  const radiusIp = process.env.RADIUS_SERVER_IP;
  const radiusSecret = process.env.RADIUS_SECRET || 'defaultSecret';

  const api = await mikrotikService._getConnection(site);
  const log = [];

  try {
    // 1. Add RADIUS server
    const radServers = await api.write('/radius/print');
    const existingServer = radServers.find(r => r.address === radiusIp);
    
    if (!existingServer) {
      await api.write('/radius/add', [
        `=address=${radiusIp}`,
        `=secret=${radiusSecret}`,
        `=service=ppp`,
        `=comment=RADIUS for PPPoE`
      ]);
      log.push({ step: 'RADIUS Server', status: 'success', message: `Added RADIUS server ${radiusIp}` });
    } else {
      log.push({ step: 'RADIUS Server', status: 'skipped', message: 'RADIUS server already configured' });
    }

    // 2. Enable RADIUS in PPP AAA (with interim updates)
    //    No need to specify .id; just set the parameters.
    await api.write('/ppp/aaa/set', [
      '=use-radius=yes',
      '=interim-update=5m'
    ]);
    log.push({ step: 'PPP AAA', status: 'success', message: 'Enabled RADIUS with 5min interim updates' });

    // 3. Enable RADIUS incoming (CoA – Change of Authority)
    await api.write('/radius/incoming/set', [
      '=accept=yes'
    ]);
    log.push({ step: 'RADIUS Incoming', status: 'success', message: 'Enabled RADIUS incoming requests' });

    // 4. Register NAS in FreeRADIUS (assuming your radiusService.registerNas works)
    const nasResult = await radiusService.registerNas(site.router.ip, process.env.RADIUS_SECRET, site.siteName);
    if (nasResult.success) {
      log.push({ step: 'NAS Registration', status: 'success', message: 'Registered NAS in FreeRADIUS' });
    } else {
      log.push({ step: 'NAS Registration', status: 'error', message: nasResult.error });
    }

    log.push({ step: 'Complete', status: 'success', message: 'RADIUS enabled successfully!' });
    res.json({ success: true, log });
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    return res.status(500).json({ success: false, error: error.message, log });
  } finally {
    await api.close();
  }
});

// ----------------------------------------------------------------------
// STEP 5: CONFIGURE DISABLED REDIRECT (SIMPLIFIED - NO USER INPUT NEEDED)
// --------------------------------------------------------
exports.configureDisabledRedirect = asyncHandler(async (req, res, next) => {
  const { bridgeInterface, allowedPoolCidr } = req.body;
 
  if (!bridgeInterface || !allowedPoolCidr) {
    return next(new ErrorResponse('bridgeInterface and allowedPoolCidr are required', 400));
  }
 
  const site = await Site.findById(req.params.siteId);
  const radiusIp = process.env.RADIUS_IP || '192.168.88.200';
  
  // Extract hostname/IP from REDIRECT_HOST for address list
  let redirectHost = process.env.REDIRECT_HOST || 'redirect.yourdomain.com';
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
 
  const api = await getApiConnection(req.params.siteId);
  const log = [];
 
  try {
    // Address Lists
    const addressListResult1 = await ensureAddressList(api, 'ALLOWED_USERS', allowedPoolCidr, 'Active PPPoE users (auto)');
    log.push({ step: 'Address List', status: addressListResult1.added ? 'success' : 'skipped', message: addressListResult1.added ? `Added ALLOWED_USERS: ${allowedPoolCidr}` : 'ALLOWED_USERS already exists' });
 
    const addressListResult2 = await ensureAddressList(api, 'DISABLED_USERS', '10.254.254.0/24', 'Expired/Disabled users (auto)');
    log.push({ step: 'Address List', status: addressListResult2.added ? 'success' : 'skipped', message: addressListResult2.added ? 'Added DISABLED_USERS: 10.254.254.0/24' : 'DISABLED_USERS already exists' });
 
    const addressListResult3 = await ensureAddressList(api, 'OI_REDIRECT_IP', addressListHost, '-- DON\'T REMOVE ::: OI EXPIRED USERS --');
    log.push({ step: 'Address List', status: addressListResult3.added ? 'success' : 'skipped', message: addressListResult3.added ? `Added redirect host: ${addressListHost}` : 'Redirect host already in address list' });
 
    // Firewall Filter Rules
    const filterRules = [
      { params: ['=chain=forward', '=in-interface=bridge-lan', '=out-interface=ether2', '=action=accept'], comment: 'Accept bridge-lan to WAN' },
      { params: ['=chain=forward', '=src-address-list=DISABLED_USERS', '=protocol=tcp', '=dst-port=!80,3346', '=action=reject', '=reject-with=icmp-network-unreachable'], comment: 'OI_EXPIRED_REJECT_NON_HTTP' },
      { params: ['=chain=forward', '=src-address-list=DISABLED_USERS', '=protocol=tcp', '=dst-port=53', '=action=accept'], comment: 'OI_EXPIRED_ALLOW_DNS_TCP' },
      { params: ['=chain=forward', '=src-address-list=DISABLED_USERS', '=protocol=udp', '=dst-port=53', '=action=accept'], comment: 'OI_EXPIRED_ALLOW_DNS_UDP' },
      { params: ['=chain=forward', '=src-address-list=DISABLED_USERS', `=dst-address=${radiusIp}`, '=protocol=tcp', '=dst-port=3799', '=action=accept'], comment: 'OI_EXPIRED_ALLOW_RADIUS' },
      { params: ['=chain=forward', '=src-address-list=DISABLED_USERS', '=action=drop'], comment: 'OI_EXPIRED_DROP_OTHER' }
    ];
 
    for (const rule of filterRules) {
      const result = await ensureFilterRule(api, rule.params, rule.comment);
      log.push({ step: 'Firewall Filter', status: result.added ? 'success' : 'skipped', message: result.added ? `Added rule: ${rule.comment}` : `Rule exists: ${rule.comment}` });
    }
 
    // Get WAN interface
    const interfaces = await api.write('/interface/print');
    const wanInterface = interfaces.find(i => i.comment && i.comment.includes('WAN')) || interfaces.find(i => i.name === 'ether2');
    const wanIfName = wanInterface ? wanInterface.name : 'ether2';
 
    // NAT Rules – using external captive portal (no proxy)
    const natRules = [
      { params: ['=chain=srcnat', `=out-interface=${wanIfName}`, '=action=masquerade'], comment: 'Masquerade WAN traffic' },
      { params: ['=chain=srcnat', '=src-address-list=DISABLED_USERS', '=dst-address=8.8.8.8', '=action=masquerade'], comment: 'OI_EXPIRED_MASQ_DNS1' },
      { params: ['=chain=srcnat', '=src-address-list=DISABLED_USERS', '=dst-address=8.8.4.4', '=action=masquerade'], comment: 'OI_EXPIRED_MASQ_DNS2' },
      // Direct DNAT to captive portal container (update IP/port as needed)
      { params: ['=chain=dstnat', '=src-address-list=DISABLED_USERS', '=protocol=tcp', '=dst-port=80', '=action=dst-nat', '=to-addresses=102.210.40.178', '=to-ports=8081'], comment: 'OI_EXPIRED_REDIRECT_HTTP' },
      { params: ['=chain=srcnat', '=src-address-list=DISABLED_USERS', '=dst-address-list=OI_REDIRECT_IP', '=action=masquerade'], comment: 'OI_EXPIRED_MASQ_REDIRECT_HOST' }
    ];
 
    for (const rule of natRules) {
      const result = await ensureNatRule(api, rule.params, rule.comment);
      log.push({ step: 'NAT Rule', status: result.added ? 'success' : 'skipped', message: result.added ? `Added rule: ${rule.comment}` : `Rule exists: ${rule.comment}` });
    }
 
    // ✅ All done – no web proxy configuration
    log.push({ step: 'Complete', status: 'success', message: 'Disabled user redirect fully configured using external captive portal!' });
    res.json({ success: true, log });
 
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    return res.status(500).json({ success: false, error: error.message, log });
  } finally {
    await api.close();
  }
});

// ----------------------------------------------------------------------
// STEP 6: CONFIGURE SYSTEM SCRIPTS AND AUTOMATION
// ----------------------------------------------------------------------

async function ensureScript(api, name, source, comment) {
  // Check if script already exists
  const existing = await api.write('/system/script/print', [
    `?name=${name}`
  ]);
  if (existing && existing.length > 0) {
    // Optionally update? we skip for simplicity
    return { added: false };
  }
  // Add script with proper policy (read,write,test) – no explicit owner
  await api.write('/system/script/add', [
    `=name=${name}`,
    `=source=${source}`,
    `=policy=read,write,test`,
    `=comment=${comment}`
  ]);
  return { added: true };
}

async function ensureScheduler(api, name, onEvent, startTime, comment) {
  const existing = await api.write('/system/scheduler/print', { '?name': name });
  if (existing && existing.length > 0) return { added: false };
  await api.write('/system/scheduler/add', [
    `=name=${name}`,
    `=on-event=${onEvent}`,
    `=start-time=${startTime}`,
    `=comment=${comment}`
  ]);
  return { added: true };
}


async function ensureNetwatch(api, host, downScript, upScript, interval, timeout, comment) {
  const existing = await api.write('/tool/netwatch/print', { '?host': host });
  if (existing && existing.length > 0) return { added: false };
  await api.write('/tool/netwatch/add', [
    `=host=${host}`,
    `=interval=${interval}`,
    `=timeout=${timeout}`,
    `=down-script=${downScript}`,
    `=up-script=${upScript}`,
    `=comment=${comment}`
  ]);
  return { added: true };
}


exports.configureSystemScripts = asyncHandler(async (req, res, next) => {
  const api = await getApiConnection(req.params.siteId);
  const log = [];

  try {
    // Scripts
    const scripts = [
      {
        name: 'mark-down',
        source: ':log info "Internet down – flag set."',
        comment: 'Mark internet as down'
      },
      {
        name: 'restart-pppoe',
        source: ':log info "Internet restored – removing all active PPPoE sessions." ; /ppp active remove [find]',
        comment: 'Restart PPPoE on internet restoration'
      },
      {
        name: 'clear-pppoe-on-startup',
        source: ':delay 60s; /ppp active remove [find]; :log info "Startup: All active PPPoE sessions cleared 60 seconds after boot."',
        comment: 'Clear PPPoE sessions on startup'
      }
    ];

    for (const script of scripts) {
      const result = await ensureScript(api, script.name, script.source, script.comment);
      log.push({
        step: 'System Script',
        status: result.added ? 'success' : 'skipped',
        message: result.added ? `Created script: ${script.name}` : `Script exists: ${script.name}`
      });
    }

    // Scheduler
    const schedulerResult = await ensureScheduler(
      api,
      'startup-clear-sessions',
      'clear-pppoe-on-startup',
      'startup',
      'Clear PPPoE sessions 60 seconds after boot'
    );
    log.push({
      step: 'Scheduler',
      status: schedulerResult.added ? 'success' : 'skipped',
      message: schedulerResult.added ? 'Created startup scheduler' : 'Scheduler already exists'
    });

    // Netwatch
    const netwatchResult = await ensureNetwatch(
      api,
      '8.8.8.8',
      'mark-down',
      'restart-pppoe',
      '30s',
      '10s',
      'Internet uplink watchdog'
    );
    log.push({
      step: 'Netwatch',
      status: netwatchResult.added ? 'success' : 'skipped',
      message: netwatchResult.added ? 'Created internet watchdog (8.8.8.8)' : 'Netwatch already exists'
    });

    log.push({ step: 'Complete', status: 'success', message: 'System scripts and automation configured!' });
    res.json({ success: true, log });
  } catch (error) {
    log.push({ step: 'Error', status: 'error', message: error.message });
    return res.status(500).json({ success: false, error: error.message, log });
  } finally {
    await api.close();
  }
});

// ----------------------------------------------------------------------
// STATUS AND UTILITY FUNCTIONS
// ----------------------------------------------------------------------

exports.getConfigurationStatus = asyncHandler(async (req, res, next) => {
  const site = await Site.findById(req.params.siteId);
  if (!site) return next(new ErrorResponse('Site not found', 404));

  const api = await mikrotikService._getConnection(site);
  const status = {
    bridge: { configured: false, details: [] },
    ipPools: { configured: false, details: [] },
    pppoeServer: { configured: false, details: [] },
    radius: { configured: false, details: null },
    disabledRedirect: { configured: false, details: {} },
    systemScripts: { configured: false, details: [] },
    netwatch: { configured: false, details: null }
  };

  try {
    // Check bridges
    const bridges = await api.write('/interface/bridge/print');
    const pppoeBridge = bridges.find(b => b.name === 'bridge-pppoe' || b.comment?.includes('ISP Management'));
    if (pppoeBridge) {
      status.bridge.configured = true;
      status.bridge.details.push({ name: pppoeBridge.name, running: pppoeBridge.running === 'true' });
    }

    // Check IP pools
    const pools = await api.write('/ip/pool/print');
    const requiredPools = ['active-pool', 'expired-pool', 'credential-pool', 'non-existent', 'mac-difference'];
    const foundPools = pools.filter(p => requiredPools.includes(p.name));
    status.ipPools.configured = foundPools.length === requiredPools.length;
    status.ipPools.details = foundPools.map(p => ({ name: p.name, ranges: p.ranges }));

    // Check PPPoE server
    const servers = await api.write('/interface/pppoe-server/server/print');
    if (servers.length > 0) {
      status.pppoeServer.configured = true;
      status.pppoeServer.details = servers.map(s => ({ 
        interface: s.interface, 
        service: s['service-name'], 
        profile: s['default-profile'],
        authentication: s.authentication 
      }));
    }

    // Check RADIUS
    const radiusServers = await api.write('/radius/print');
    const aaa = await api.write('/ppp/aaa/print');
    const radiusIncoming = await api.write('/radius/incoming/print');
    const useRadius = aaa[0] && aaa[0]['use-radius'] === 'true';
    const interimUpdate = aaa[0] && aaa[0]['interim-update'];
    const incomingAccept = radiusIncoming[0] && radiusIncoming[0]['accept'] === 'true';
    
    status.radius.configured = useRadius && radiusServers.length > 0 && incomingAccept;
    status.radius.details = {
      enabled: useRadius,
      serverIp: radiusServers.length > 0 ? radiusServers[0].address : null,
      interimUpdate: interimUpdate || 'not set',
      incomingAccept: incomingAccept
    };

    // Check disabled redirect components
    const addressLists = await api.write('/ip/firewall/address-list/print');
    const filterRules = await api.write('/ip/firewall/filter/print');
    const natRules = await api.write('/ip/firewall/nat/print');
    const proxy = await api.write('/ip/proxy/print');
    const proxyAccess = await api.write('/ip/proxy/access/print');

    const hasAddressLists = addressLists.some(l => l.list === 'DISABLED_USERS');
    const hasFilterRules = filterRules.some(r => r.comment?.includes('OI_EXPIRED'));
    const hasNatRules = natRules.some(r => r.comment?.includes('OI_EXPIRED'));
    const proxyEnabled = proxy[0] && proxy[0].enabled === 'true';
    const hasProxyRedirect = proxyAccess.some(r => r.comment === 'OI_EXPIRED_REDIRECT');

    status.disabledRedirect.configured = hasAddressLists && hasFilterRules && hasNatRules && proxyEnabled && hasProxyRedirect;
    status.disabledRedirect.details = {
      addressLists: hasAddressLists,
      filterRules: hasFilterRules,
      natRules: hasNatRules,
      proxyEnabled: proxyEnabled,
      proxyRedirect: hasProxyRedirect
    };

    // Check system scripts
    const scripts = await api.write('/system/script/print');
    const requiredScripts = ['mark-down', 'restart-pppoe', 'clear-pppoe-on-startup'];
    const foundScripts = scripts.filter(s => requiredScripts.includes(s.name));
    status.systemScripts.configured = foundScripts.length === requiredScripts.length;
    status.systemScripts.details = foundScripts.map(s => ({ name: s.name, policy: s.policy }));

    // Check scheduler
    const schedulers = await api.write('/system/scheduler/print');
    const hasScheduler = schedulers.some(s => s.name === 'startup-clear-sessions');

    // Check netwatch
    const netwatches = await api.write('/tool/netwatch/print');
    const internetWatch = netwatches.find(n => n.host === '8.8.8.8');
    status.netwatch.configured = !!internetWatch;
    if (internetWatch) {
      status.netwatch.details = {
        host: internetWatch.host,
        interval: internetWatch.interval,
        upScript: internetWatch['up-script'],
        downScript: internetWatch['down-script']
      };
    }

    // Overall system configured
    status.systemScripts.configured = status.systemScripts.configured && hasScheduler;

  } catch (error) {
    console.error('Status check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    await api.close();
  }
  res.json({ success: true, data: status });
});

exports.getExistingConfig = asyncHandler(async (req, res, next) => {
  const site = await Site.findById(req.params.siteId).select('+router.password');
  if (!site) return next(new ErrorResponse('Site not found', 404));

  const api = await mikrotikService._getConnection(site);
  
  try {
    const bridges = await api.write('/interface/bridge/print');
    const pools = await api.write('/ip/pool/print');
    const profiles = await api.write('/ppp/profile/print');
    const servers = await api.write('/interface/pppoe-server/server/print');
    const scripts = await api.write('/system/script/print');
    const schedulers = await api.write('/system/scheduler/print');
    const netwatches = await api.write('/tool/netwatch/print');
    
    await api.close();

    res.json({
      success: true,
      data: {
        bridges: bridges.map(b => ({ name: b.name, running: b.running === 'true', disabled: b.disabled === 'true' })),
        pools: pools.map(p => ({ name: p.name, ranges: p.ranges })),
        profiles: profiles.map(p => ({ name: p.name, localAddress: p['local-address'], remoteAddress: p['remote-address'] })),
        servers: servers.map(s => ({ interface: s.interface, service: s['service-name'], authentication: s.authentication })),
        scripts: scripts.map(s => ({ name: s.name, owner: s.owner })),
        schedulers: schedulers.map(s => ({ name: s.name, onEvent: s['on-event'] })),
        netwatches: netwatches.map(n => ({ host: n.host, interval: n.interval }))
      },
    });
  } catch (error) {
    await api.close();
    return res.status(500).json({ success: false, error: error.message });
  }
});

exports.getRouterInterfaces = asyncHandler(async (req, res, next) => {
  const site = await Site.findById(req.params.siteId).select('+router.password');
  if (!site) return next(new ErrorResponse('Site not found', 404));

  const api = await mikrotikService._getConnection(site);
  let interfaces;
  try {
    interfaces = await api.write('/interface/print');
  } finally {
    await api.close();
  }

  const interfaceList = interfaces.map(iface => ({
    name: iface.name,
    type: iface.type,
    running: iface.running === 'true',
    disabled: iface.disabled === 'true',
    comment: iface.comment || ''
  }));

  res.json({ success: true, data: interfaceList });
});

module.exports = exports;
