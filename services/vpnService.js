const { exec }      = require('child_process');
const { promisify } = require('util');
const fs            = require('fs').promises;
const path          = require('path');
const Router        = require('../models/Router');

const execAsync = promisify(exec);

const EASYRSA_DIR = '/home/charles/openvpn-ca';
const CCD_DIR     = '/etc/openvpn/ccd';
const CA_CRT      = '/etc/openvpn/server/ca.crt';

const BASE       = '10.8.0';
const START_HOST = 6;
const STEP       = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeName(routerName) {
  const clean = routerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!clean) throw new Error('Invalid router name');
  return `client-${clean}`;
}

function validateClientName(name) {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`Invalid client name: ${name}`);
  }
}

async function getNextTunnelIp() {
  const routers = await Router.find({ tunnelIp: { $ne: null } }, 'tunnelIp');
  const used    = new Set(routers.map(r => r.tunnelIp));

  let host = START_HOST;
  while (host < 252) {
    const candidate = `${BASE}.${host}`;
    if (!used.has(candidate)) {
      return {
        clientIp: `${BASE}.${host}`,
        peerIp:   `${BASE}.${host - 1}`,
      };
    }
    host += STEP;
  }
  throw new Error('VPN IP pool exhausted — all 10.8.0.x addresses are assigned');
}

async function certExists(clientName) {
  try {
    await fs.access(`${EASYRSA_DIR}/pki/issued/${clientName}.crt`);
    return true;
  } catch {
    return false;
  }
}

// ─── Generate VPN config for a router ────────────────────────────────────────

async function generateRouterVpnConfig(router) {
  const clientName = sanitizeName(router.name);
  validateClientName(clientName);
  console.log(`[VPN] Generating config for: ${clientName}`);

  // 1. Assign tunnel IP
  let tunnelIp = router.tunnelIp;
  let peerIp;

  if (!tunnelIp) {
    const next = await getNextTunnelIp();
    tunnelIp = next.clientIp;
    peerIp   = next.peerIp;
  } else {
    const parts = tunnelIp.split('.');
    peerIp = `${BASE}.${parseInt(parts[3]) - 1}`;
  }

  // 2. Generate certificate if it doesn't already exist
  if (!(await certExists(clientName))) {
    console.log(`[VPN] Generating certificate: ${clientName}`);
    await execAsync(
      `cd ${EASYRSA_DIR} && ./easyrsa-real --batch gen-req ${clientName} nopass`,
      { env: { ...process.env, EASYRSA_REQ_CN: clientName } }
    );
    await execAsync(
      `cd ${EASYRSA_DIR} && ./easyrsa-real --batch sign-req client ${clientName}`
    );
    console.log(`[VPN] Certificate generated: ${clientName}`);
  } else {
    console.log(`[VPN] Certificate already exists, reusing: ${clientName}`);
  }

  // 3. Write CCD file — direct fs write, no sudo needed
  const ccdPath = path.join(CCD_DIR, clientName);
  await fs.writeFile(ccdPath, `ifconfig-push ${tunnelIp} ${peerIp}\n`);
  console.log(`[VPN] CCD written: ${ccdPath} → ${tunnelIp}`);

  // 4. Read certificate files
  const [caCrt, clientCrt, clientKey] = await Promise.all([
    fs.readFile(CA_CRT),
    fs.readFile(`${EASYRSA_DIR}/pki/issued/${clientName}.crt`),
    fs.readFile(`${EASYRSA_DIR}/pki/private/${clientName}.key`),
  ]);

  // 5. Update NAS table in RADIUS
  try {
    const radiusService = require('./radiusService');
    const conn = await radiusService.getConnection();

    const [existing] = await conn.query(
      'SELECT id FROM nas WHERE nasname = ?',
      [router.ip]
    );

    if (existing.length > 0) {
      await conn.query(
        'UPDATE nas SET nasname = ?, shortname = ? WHERE nasname = ?',
        [tunnelIp, `${router.name}-VPN`, router.ip]
      );
      console.log(`[VPN] NAS updated: ${router.ip} → ${tunnelIp}`);
    } else {
      // Check if tunnel IP entry already exists
      const [tunnelExists] = await conn.query(
        'SELECT id FROM nas WHERE nasname = ?',
        [tunnelIp]
      );
      if (!tunnelExists.length) {
        await conn.query(
          `INSERT INTO nas (nasname, shortname, type, secret) VALUES (?, ?, 'other', ?)`,
          [tunnelIp, `${router.name}-VPN`, process.env.RADIUS_SECRET]
        );
        console.log(`[VPN] NAS entry created: ${tunnelIp}`);
      }
    }
    conn.release();
  } catch (e) {
    console.error('[VPN] NAS update failed (non-fatal):', e.message);
  }

  // 6. Save tunnel IP and client name to MongoDB
  await Router.findByIdAndUpdate(router._id, {
    tunnelIp,
    vpnClientName: clientName,
  });
  console.log(`[VPN] Router updated: ${router.name} → ${tunnelIp}`);

  return {
    success:    true,
    clientName,
    tunnelIp,
    peerIp,
    files: {
      'ca.crt':              caCrt,
      [`${clientName}.crt`]: clientCrt,
      [`${clientName}.key`]: clientKey,
    },
  };
}

// ─── Revoke VPN config for a router ──────────────────────────────────────────

async function revokeRouterVpnConfig(router) {
  if (!router.vpnClientName) {
    return { success: false, error: 'No VPN config found for this router' };
  }

  const clientName = router.vpnClientName;
  validateClientName(clientName);

  // Revoke certificate
  try {
    await execAsync(`cd ${EASYRSA_DIR} && ./easyrsa-real --batch revoke ${clientName}`);
await execAsync(`cd ${EASYRSA_DIR} && ./easyrsa-real gen-crl`);
    console.log(`[VPN] Certificate revoked: ${clientName}`);
  } catch (e) {
    console.warn(`[VPN] Revoke warning (continuing): ${e.message}`);
  }

  // Remove CCD file
  try {
    await fs.unlink(path.join(CCD_DIR, clientName));
    console.log(`[VPN] CCD file removed: ${clientName}`);
  } catch (e) {
    console.warn(`[VPN] CCD remove warning: ${e.message}`);
  }

  // Clear router fields in MongoDB
  await Router.findByIdAndUpdate(router._id, {
    tunnelIp:      null,
    vpnClientName: null,
    vpnConnected:  false,
    vpnLastSeen:   null,
  });

  console.log(`[VPN] Router VPN config cleared: ${router.name}`);
  return { success: true };
}

module.exports = { generateRouterVpnConfig, revokeRouterVpnConfig };