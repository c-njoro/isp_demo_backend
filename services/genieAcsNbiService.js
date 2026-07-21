/**
 * GenieACS NBI Service
 *
 * Reads live device state (online status, WiFi, connected hosts, WAN info)
 * directly from GenieACS's NBI API, container-to-container on the isp-network
 * Docker network. This replaces the old Telnet-based syncOnuStatus/bulkSyncOnus
 * approach for anything GenieACS already tracks live via periodic TR-069 Informs —
 * no need to open an OLT session just to check if a device is online.
 *
 * IMPORTANT: this only covers what GenieACS knows (device-side state). Business
 * context — which customer, which OLT/PON-port, region, billing — still lives in
 * your own ONU/Customer collections. This service does not replace that; it
 * enriches it.
 */

const GENIEACS_NBI_URL = process.env.GENIEACS_NBI_URL || 'http://genieacs:7557';

// NBI requires HTTP Basic Auth (see GENIEACS_NBI_AUTH_USERNAME/PASSWORD in
// docker-compose) — every request needs this header or GenieACS rejects it.
function authHeader() {
  const user = process.env.GENIEACS_NBI_AUTH_USERNAME;
  const pass = process.env.GENIEACS_NBI_AUTH_PASSWORD;
  if (!user || !pass) {
    console.warn('[genieacs] GENIEACS_NBI_AUTH_USERNAME/PASSWORD not set — NBI requests will likely be rejected');
    return {};
  }
  return { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') };
}

// How long after the last Inform a device is still considered "online".
// GenieACS devices in this fleet report PeriodicInformInterval=60s, so 3x that
// gives headroom for a missed/delayed cycle before flipping to offline.
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000;

/**
 * Your app stores the ONT serial number in raw hex (straight from the OLT —
 * e.g. "48575443610BEC10"), where the first 8 hex chars are the vendor OUI
 * ASCII-encoded (48 57 54 43 -> "HWTC"). GenieACS's _deviceId._SerialNumber
 * stores the ASCII-decoded form ("HWTC610BEC10") — standard TR-069 convention.
 * Confirmed against this exact device via the OLT's own autofind output:
 * "Ont SN: 48575443610BEC10 (HWTC-610BEC10)". Without this conversion, every
 * lookup silently fails to match and liveStatus always comes back not-found.
 */
function toGenieAcsSerialFormat(rawSerial) {
  if (!rawSerial || rawSerial.length <= 8) return rawSerial;
  const hexPrefix = rawSerial.slice(0, 8);
  const rest = rawSerial.slice(8);
  if (!/^[0-9A-Fa-f]{8}$/.test(hexPrefix)) return rawSerial; // doesn't look hex-prefixed, leave as-is
  let ascii = '';
  for (let i = 0; i < 8; i += 2) {
    ascii += String.fromCharCode(parseInt(hexPrefix.substr(i, 2), 16));
  }
  return ascii + rest;
}

// Only fetch the fields the dashboard actually needs — these device docs are
// large (hundreds of parameters); pulling the whole tree per request is wasteful.
const DASHBOARD_PROJECTION = [
  '_deviceId',
  '_lastInform',
  '_lastBoot',
  '_registered',
  'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
  'InternetGatewayDevice.DeviceInfo.UpTime',
  'InternetGatewayDevice.ManagementServer.ConnectionRequestURL',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection',
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration',
  'InternetGatewayDevice.LANDevice.1.Hosts'
].join(',');

async function nbiGet(path) {
  const res = await fetch(`${GENIEACS_NBI_URL}${path}`, { headers: authHeader() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GenieACS NBI request failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch a single device by its serial number.
 * Returns null if not found or if GenieACS is unreachable (callers should treat
 * that as "live status unknown" rather than failing the whole request).
 */
async function getDeviceBySerial(serialNumber) {
  try {
    const genieSerial = toGenieAcsSerialFormat(serialNumber);
    const query = encodeURIComponent(JSON.stringify({ '_deviceId._SerialNumber': genieSerial }));
    const projection = encodeURIComponent(DASHBOARD_PROJECTION);
    const devices = await nbiGet(`/devices/?query=${query}&projection=${projection}`);
    return devices[0] || null;
  } catch (err) {
    console.error(`[genieacs] getDeviceBySerial(${serialNumber}) failed: ${err.message}`);
    return null;
  }
}

/**
 * Batch-fetch devices for a list of (app-format) serial numbers in one NBI
 * call — used by the ONU list endpoint so it doesn't make one request per row.
 * Returns a Map keyed by the ORIGINAL serial you passed in, so callers can do
 * genieBySerial.get(onu.serialNumber) directly without re-deriving the GenieACS format.
 */
async function getDevicesBySerials(serialNumbers) {
  const result = new Map();
  if (!serialNumbers || serialNumbers.length === 0) return result;

  const conversionMap = new Map(); // genieSerial -> original app serial
  const genieSerials = serialNumbers.map(s => {
    const g = toGenieAcsSerialFormat(s);
    conversionMap.set(g, s);
    return g;
  });

  try {
    const query = encodeURIComponent(JSON.stringify({ '_deviceId._SerialNumber': { $in: genieSerials } }));
    const projection = encodeURIComponent(DASHBOARD_PROJECTION);
    const devices = await nbiGet(`/devices/?query=${query}&projection=${projection}`);
    for (const d of devices) {
      const genieSerial = d._deviceId?._SerialNumber;
      const originalSerial = conversionMap.get(genieSerial) || genieSerial;
      result.set(originalSerial, d);
    }
    return result;
  } catch (err) {
    console.error(`[genieacs] getDevicesBySerials failed: ${err.message}`);
    return result;
  }
}

/** Force a fresh parameter refresh via TR-069 Connection Request. */
async function refreshDevice(deviceId, objectName = 'InternetGatewayDevice') {
  const res = await fetch(`${GENIEACS_NBI_URL}/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ name: 'refreshObject', objectName })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GenieACS refresh failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/** Push parameter values via TR-069 setParameterValues (e.g. change SSID). */
async function setParameterValues(deviceId, parameterValues) {
  // parameterValues: array of [path, value, type] tuples, e.g.
  // [["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", "MyWifi", "xsd:string"]]
  const res = await fetch(`${GENIEACS_NBI_URL}/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ name: 'setParameterValues', parameterValues })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GenieACS setParameterValues failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/** Derive a simple online/offline + useful summary fields from a raw device doc. */
function summarizeDevice(device) {
  if (!device) {
    return { found: false, online: false, lastInform: null };
  }

  const lastInformRaw = device._lastInform?.$date || device._lastInform;
  const lastInform = lastInformRaw ? new Date(lastInformRaw) : null;
  const online = lastInform ? (Date.now() - lastInform.getTime()) < ONLINE_THRESHOLD_MS : false;

  const igd = device.InternetGatewayDevice || {};
  const wlanConfigs = igd.LANDevice?.['1']?.WLANConfiguration || {};
  const activeSsids = Object.values(wlanConfigs)
    .filter(w => w?.Status?._value === 'Up')
    .map(w => w?.SSID?._value)
    .filter(Boolean);

  const hosts = igd.LANDevice?.['1']?.Hosts?.Host || {};
  const connectedHosts = Object.values(hosts).filter(h => h?.Active?._value === true).length;

  const wanIp = igd.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANIPConnection?.['1']?.ExternalIPAddress?._value || null;
  const managementIp = wanIp; // on this fleet, the management VLAN IS the WANIPConnection

  return {
    found: true,
    online,
    lastInform,
    softwareVersion: igd.DeviceInfo?.SoftwareVersion?._value || null,
    managementIp,
    activeSsids,
    connectedHosts
  };
}

module.exports = {
  getDeviceBySerial,
  getDevicesBySerials,
  refreshDevice,
  setParameterValues,
  summarizeDevice
};