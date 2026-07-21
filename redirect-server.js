/**
 * ============================================
 * ISP REDIRECT SERVER
 * ============================================
 * 
 * Handles captive portal redirects for:
 * - PPPoE customers (expired, wrong password, MAC mismatch, suspended)
 * - Hotspot customers (existing and new users)
 * 
 * Routes based on IP ranges from MikroTik:
 * - 10.254.254.0/24 → Expired PPPoE
 * - 20.20.0.0/16 → Wrong password PPPoE
 * - 30.30.0.0/16 → Non-existent user
 * - 40.40.0.0/16 → MAC mismatch PPPoE
 * - 10.20.2.0/24 → Hotspot expired
 * - 10.20.3.0/24 → Hotspot wrong password
 * - 10.20.4.0/24 → Hotspot MAC mismatch
 * - 10.20.5.0/24 → Hotspot non-existent (new users)
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { calculatePeriodEnd } = require("./utils/invoiceHelpers");
const radiusService = require('./services/radiusService');
const mikroticService = require('./services/mikroticService');
// At the top, after other requires
const mpesaService = require('./services/mpesaService');

require('dotenv').config();

const mysql = require('mysql2/promise');

const logoPath = path.join(__dirname, 'public', 'SKYLINKPNGWITHLOGO.png');
let logoBase64 = '';
try {
  const logoBuffer = fs.readFileSync(logoPath);
  logoBase64 = logoBuffer.toString('base64');
  console.log('✅ Logo loaded, base64 length:', logoBase64.length);
} catch (err) {
  console.warn('⚠️ Logo not found at', logoPath, '– using text fallback');
}

const brandStyles = `
  /* ===== BRANDED STYLES – SKYLINK NETWORKS (DEEP BLUE THEME) ===== */
  :root {
    --skylink-blue: #0ea5e9;
    --skylink-blue-dark: #0284c7;
    --skylink-blue-glow: rgba(14, 165, 233, 0.3);
    --bg-deep: #0b1e3a;
    --bg-card: rgba(255, 255, 255, 0.06);
    --text-white: #f8fafc;
    --text-muted: #cbd5e1;
    --text-dim: #94a3b8;
    --border-light: rgba(255, 255, 255, 0.08);
    --border-glow: rgba(14, 165, 233, 0.25);
    --radius: 8px;
    --shadow-card: 0 4px 24px rgba(0, 0, 0, 0.3);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg-deep);
    color: var(--text-white);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    line-height: 1.5;
  }

  .portal-container {
    max-width: 1120px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .brand-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-bottom: 1rem;      /* Reduced from 1.5rem */
    border-bottom: 1px solid rgba(255,255,255,0.06);
    margin-bottom: 1rem;        /* Reduced from 2.5rem */
  }
  .brand-logo-wrapper {
  background: #ffffff;
  padding: 4px 14px;
  border-radius: 4px;
  transform: skewX(-4deg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15); /* optional subtle shadow */
}
.brand-logo-wrapper img {
  transform: skewX(4deg);
  height: 40px;
  width: auto;
  display: block;
  filter: brightness(1) contrast(1); /* ensure no fading */
}
  .brand-name {
    font-weight: 700;
    font-size: 1.2rem;
    letter-spacing: 0.02em;
    color: var(--text-white);
    margin-left: 0.25rem;
  }
  .brand-name span {
    color: var(--skylink-blue);
  }

  .glass-card {
    background: var(--bg-card);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid var(--border-light);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    padding: 2rem;
  }

  .two-col {
    display: grid;
    grid-template-columns: 1fr 1.2fr;
    gap: 2.5rem;
    align-items: start;
  }

  @media (max-width: 820px) {
    .two-col { grid-template-columns: 1fr; gap: 2rem; }
  }

  .heading-lg {
    font-size: 1.8rem;          /* Reduced from 2.2rem */
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.2;
    color: var(--text-white);
  }
  .heading-lg .highlight {
    color: var(--skylink-blue);
  }
  .subheading {
    color: var(--text-muted);
    font-size: 1rem;
    max-width: 400px;
    line-height: 1.6;
    margin-top: 0.5rem;
  }

  .detail-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .detail-row {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .detail-label {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .detail-value {
    font-weight: 600;
    font-family: 'SF Mono', monospace;
    font-size: 0.9rem;
    color: var(--text-white);
  }

  .price-box {
    background: rgba(14,165,233,0.12);
    border: 1px solid rgba(14,165,233,0.2);
    border-radius: var(--radius);
    padding: 1rem 1.5rem;
    text-align: center;
    margin: 1rem 0 1.5rem;
  }
  .price-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .price-amount {
    font-size: 2.4rem;
    font-weight: 700;
    color: var(--skylink-blue);
    font-family: 'SF Mono', monospace;
  }

  .form-group {
    margin-bottom: 1.25rem;
  }
  .form-label {
    display: block;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 0.4rem;
    letter-spacing: 0.02em;
  }
  .tech-input {
    width: 100%;
    padding: 0.75rem 1rem;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    color: var(--text-white);
    font-size: 1rem;
    transition: border-color 0.2s;
  }
  .tech-input:focus {
    outline: none;
    border-color: var(--skylink-blue);
    box-shadow: 0 0 0 3px rgba(14,165,233,0.15);
  }
  .tech-input::placeholder { color: var(--text-dim); }

  .btn-primary {
    width: 100%;
    padding: 0.85rem;
    background: var(--skylink-blue);
    border: none;
    border-radius: 6px;
    color: white;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.02em;
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--skylink-blue-dark);
    box-shadow: 0 0 20px rgba(14,165,233,0.4);
    transform: translateY(-1px);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }
  .btn-secondary {
    padding: 0.6rem 1.2rem;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-secondary:hover {
    background: rgba(255,255,255,0.08);
    color: var(--text-white);
  }

  .message-box {
    padding: 0.85rem 1.2rem;
    border-radius: 6px;
    font-size: 0.9rem;
    display: none;
    margin-top: 1rem;
    border-left: 3px solid;
  }
  .message-box.success {
    background: rgba(16,185,129,0.12);
    color: #34d399;
    border-color: #34d399;
  }
  .message-box.error {
    background: rgba(239,68,68,0.12);
    color: #f87171;
    border-color: #f87171;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: var(--skylink-blue);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 0.5rem;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .brand-footer {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(255,255,255,0.05);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.8rem;
    color: var(--text-dim);
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .brand-footer a {
    color: var(--skylink-blue);
    text-decoration: none;
    margin-left: 1.25rem;
    font-weight: 500;
    transition: color 0.2s;
  }
  .brand-footer a:hover { color: #7dd3fc; }

  .plan-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.25rem;
    margin-top: 1rem;
  }
  .plan-card {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: var(--radius);
    padding: 1.5rem;
    transition: all 0.25s;
    cursor: default;
  }
  .plan-card:hover {
    border-color: var(--skylink-blue);
    box-shadow: 0 8px 24px -8px rgba(14,165,233,0.15);
    transform: translateY(-2px);
  }
  .plan-name {
    font-weight: 600;
    font-size: 1.05rem;
    color: var(--text-white);
    margin-bottom: 0.25rem;
  }
  .plan-price {
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--skylink-blue);
    font-family: 'SF Mono', monospace;
    margin: 0.5rem 0 1rem;
  }
  .plan-btn {
    width: 100%;
    padding: 0.6rem;
    border: 1px solid var(--skylink-blue);
    border-radius: 6px;
    background: transparent;
    color: var(--skylink-blue);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .plan-btn:hover {
    background: var(--skylink-blue);
    color: white;
  }

  .voucher-toggle {
    text-align: right;
    margin-bottom: 1.5rem;
  }
  .voucher-toggle button {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.1);
    color: var(--skylink-blue);
    padding: 0.4rem 1rem;
    border-radius: 20px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  .voucher-toggle button:hover {
    background: rgba(14,165,233,0.08);
    border-color: var(--skylink-blue);
  }

  .error-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    justify-content: center;
    flex: 1;
    padding: 2rem;
  }
  .error-icon {
    font-size: 4rem;
    margin-bottom: 0.5rem;
  }
  .error-title {
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--text-white);
    margin-bottom: 0.5rem;
  }
  .error-message {
    color: var(--text-muted);
    max-width: 480px;
    line-height: 1.6;
    margin-bottom: 2rem;
  }
`;

const radiusPool = mysql.createPool({
  host: process.env.RADIUS_DB_HOST,
  port: process.env.RADIUS_DB_PORT,
  user: process.env.RADIUS_DB_USER,
  password: process.env.RADIUS_DB_PASSWORD,
  database: process.env.RADIUS_DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

async function getRadiusConnection() {
  return radiusPool.getConnection();
}

const app = express();
const PORT = process.env.REDIRECT_PORT || 8081;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected (Redirect Server)');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

// Import models
const Customer = require('./models/Customer');
const HotspotUser = require('./models/HotspotUser');
const Site = require('./models/Site');
const Router = require('./models/Router');
const Package = require('./models/Package');
const Payment = require('./models/Payment');
const SystemLog = require('./models/SystemLog')
const Voucher = require('./models/Voucher')


// Import services
const kopokopoService = require('./services/kopokopoService');

// ============================================
// HELPER FUNCTIONS
// ============================================


/**
 * Determine customer type and issue from IP address
 * Returns: { type: 'pppoe'|'hotspot', issue: 'expired'|'wrong_password'|'mac_mismatch'|'non_existent'|'unknown' }
 */



/**
 * Query RADIUS database for active session by IP (MySQL)
 */
/**
 * Query RADIUS database for active session by IP and NAS IP (MySQL)
 * Filters by both framedipaddress and nasipaddress to ensure we get the session
 * from the correct MikroTik router in multi-site deployments.
 */
/**
 * Get NAS (MikroTik) IP from request headers
 * Priority: x-real-ip → last IP in x-forwarded-for
 */
function getNasIp(req) {


  if (req.body?.['nas-ip']) {
    console.log(`📡 NAS IP from body (VPN tunnel IP): ${req.body['nas-ip']}`);
    return req.body['nas-ip'];
  }


   // 1. Query param from hotspot redirect (most reliable)
   if (req.query?.['nas-ip']) {
    console.log(`📡 NAS IP from query param: ${req.query['nas-ip']}`);
    return req.query['nas-ip'];
  }


  // 1. x-real-ip is typically the proxy/MikroTik IP
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    console.log(`📡 NAS IP from X-Real-IP: ${realIp}`);
    return realIp;
  }
  
  // 2. x-forwarded-for: client, proxy1, proxy2... 
  //    The last IP is the one closest to the server (the MikroTik/proxy)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map(ip => ip.trim());
    const nasIp = ips[ips.length - 1];
    console.log(`📡 NAS IP from X-Forwarded-For (last): ${nasIp}`);
    return nasIp;
  }
  
  console.log('❌ No NAS IP detected in headers');
  return null;
}

// function getNasIp(req) {
//   // 1. Query param from hotspot redirect (most reliable)
//   if (req.query?.['nas-ip']) {
//     console.log(`📡 NAS IP from query param: ${req.query['nas-ip']}`);
//     return req.query['nas-ip'];
//   }
//   // 2. x-real-ip header
//   const realIp = req.headers['x-real-ip'];
//   if (realIp) return realIp;
//   // 3. x-forwarded-for (last hop)
//   const forwarded = req.headers['x-forwarded-for'];
//   if (forwarded) {
//     const ips = forwarded.split(',').map(ip => ip.trim());
//     return ips[ips.length - 1];
//   }
//   return null;
// }

/**
 * Query RADIUS database for active session by IP and NAS IP (MySQL)
 */
async function getRadiusSession(ip, nasIp) {
  let connection;
  try {
    connection = await getRadiusConnection();
    
    const [rows] = await connection.query(
      `SELECT * FROM radacct 
       WHERE framedipaddress = ? 
         AND nasipaddress = ? 
         AND acctstoptime IS NULL
       ORDER BY acctstarttime DESC
       LIMIT 1`,
      [ip, nasIp]
    );
    
    if (rows.length > 0) {
      console.log(`✅ RADIUS session found: username=${rows[0].username}, nasipaddress=${rows[0].nasipaddress}`);
    } else {
      console.log(`❌ No RADIUS session found for framedipaddress=${ip}, nasipaddress=${nasIp}`);
    }
    
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('❌ RADIUS query error (getRadiusSession):', error.message);
    return null;
  } finally {
    if (connection) connection.release();
  }
}


/**
 * Query RADIUS auth log for authentication failure details (MySQL)
 */
async function getRadiusAuthLog(username) {
  let connection;
  try {
    connection = await getRadiusConnection();
    
    const [rows] = await connection.query(
      `SELECT * FROM radius_auth_log
       WHERE username = ?
       ORDER BY auth_timestamp DESC
       LIMIT 1`,
      [username]
    );
    
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('❌ RADIUS auth log query error:', error.message);
    return null;
  } finally {
    if (connection) connection.release();
  }
}
/**
 * Format phone number to 254XXXXXXXXX
 */
function formatPhoneNumber(phone) {
  if (!phone) return null;
  
  phone = phone.replace(/\D/g, '');
  
  if (phone.startsWith('0')) {
    return '254' + phone.slice(1);
  }
  
  if (phone.startsWith('+254')) {
    return phone.slice(1);
  }
  
  if (phone.startsWith('254')) {
    return phone;
  }
  
  return phone;
}

/**
 * Get client IP from request
 */
function getClientIp(req) {
  // 1. First check query param (for hotspot redirects that include ?ip=)
  if (req.query?.ip) {
    let ip = req.query.ip.replace('::ffff:', '');
    console.log(`📍 CLIENT IP from Query Param: ${ip}`);
    return ip;
  }
  
  // 2. Check X-Forwarded-For header (from MikroTik proxy)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For can be a comma-separated list; take the first one
    let ip = forwarded.split(',')[0].trim().replace('::ffff:', '');
    console.log(`📍 CLIENT IP from X-Forwarded-For: ${ip}`);
    return ip;
  }
  
  // 3. Fallback to direct connection IP
  let ip = req.ip?.replace('::ffff:', '') || req.connection?.remoteAddress?.replace('::ffff:', '');
  if (ip) {
    console.log(`📍 CLIENT IP from Connection: ${ip}`);
    return ip;
  }
  
  console.log('❌ No client IP found');
  return null;
}

function getClientMac(req) { 
  const mac = req.query?.mac; 
  if (mac) console.log(`📱 CLIENT MAC from Hotspot: ${mac}`);
  return mac?.toUpperCase() || null; 
}




const rateLimit = require('express-rate-limit');
const portalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 5,                    // max 5 requests per minute per client
  keyGenerator: (req) => `${req.headers['x-real-ip'] || req.ip}_${req.headers['user-agent']}`,
  handler: (req, res) => res.status(429).send('Too many requests – please wait.'),
});
app.use('/portal', portalLimiter);


// ============================================
// MAIN REDIRECT HANDLER
// ============================================


app.get('/', (req, res) => {
  // Block root access – only valid clients should use /portal or /expo-experience
  res.status(403).end();
});



/**
 * Main entry point: /portal
 * MikroTik redirects here with IP as query parameter
 */
async function portalHandler (req, res)  {
  try {
    const ua = req.headers['user-agent'] || '';

    if (/libhttp|PlayStation|NintendoSwitch|Xbox.*Live|Valve\/Steam/i.test(ua)) {
      console.log(`🎮 Non-browser blocked: ${ua.substring(0, 60)}`);
      return res.status(204).end(); // No body = no retry loop
    }

    console.log('\n🚪 === NEW REDIRECT REQUEST ===');
    console.log('Query params:', req.query);
    console.log('Headers:', req.headers);

    const clientIp = getClientIp(req);
    const clientMac = getClientMac(req);

    if (!clientIp) {
      console.log('❌ No client IP detected');
      return res.status(400).send(renderError('Unable to detect your IP address. Please contact support.'));
    }

    const nasIp = getNasIp(req);
    if (!nasIp) {
      console.log('❌ No NAS IP detected in request headers');
      return res.status(400).send(renderError('Unable to identify router. Please reconnect and try again.'));
    }

    // ── Step 1: Fetch RADIUS session first ──────────────────────────────────
    // This is the source of truth. Username tells us everything.
    const session = await getRadiusSession(clientIp, nasIp);
    if (!session) {
      console.log('❌ No RADIUS session found for this IP');
      return res.status(400).send(renderError('No active session found. Press retry below, if error persists, call our office to be assisted.', clientIp, nasIp));
    }

    const username = session.username;
    console.log(`👤 Session username: ${username}`);

    // ── Step 2: Determine connection type from username ──────────────────────
    // hs_ prefix = hotspot, anything else = pppoe
    const isHotspot = username.startsWith('hs_');
    console.log(`📊 Connection type: ${isHotspot ? 'HOTSPOT' : 'PPPOE'} (from username: ${username})`);

    // ============================================
    // HOTSPOT USER FLOW
    // ============================================
    if (isHotspot) {
      console.log('\n🌐 === HOTSPOT USER DETECTED ===');

      // Derive MAC from username: hs_1E0D64C69EC9 → 1E:0D:64:C6:9E:C9
      const macFromUsername = username
        .replace('hs_', '')
        .match(/.{2}/g)
        ?.join(':')
        .toUpperCase();

      const mac = clientMac || macFromUsername;
      console.log(`   MAC: ${mac}`);

      if (!mac) {
        console.log('❌ No MAC address detected');
        return res.status(400).send(renderError('MAC address could not be determined. Please contact support.'));
      }

      const router = await Router.findOne({ ip: nasIp });
      if (!router) {
        console.log('❌ No router found');
        return res.status(400).send(renderError('Could not determine where you are connecting from. Please disconnect and connect again.'));
      }

      const packageQuery = {
        _id: { $in: router.hotspotPackages },
        isActive: true,
        packageType: 'hotspot',
      };

      const packages = await Package.find(packageQuery).sort({ price: 1 });

      if (packages.length === 0) {
        return res.status(500).send(renderError('No packages available for your location. Please contact support.'));
      }

      let site = await Site.findById(router.site);
      if (!site) {
        site = await Site.findOne({ isActive: true, hasHotspot: true }).sort({ createdAt: 1 });
      }
      if (!site) {
        return res.status(500).send(renderError('Region not determined, please disconnect and re-connect again.'));
      }

      // Look up existing HotspotUser by MAC
      let hotspotUser = await HotspotUser.findOne({ macAddress: mac });
      console.log(`🔍 Hotspot user lookup: ${hotspotUser ? 'FOUND' : 'NEW USER'}`);

      if (hotspotUser) {
        const now = new Date();
        const isExpired = hotspotUser.activeSession?.expiresAt &&
                          new Date(hotspotUser.activeSession.expiresAt) < now;
        const isActive = hotspotUser.activeSession?.isActive === true && !isExpired;

        console.log(`   Session active: ${hotspotUser.activeSession?.isActive}`);
        console.log(`   Expires: ${hotspotUser.activeSession?.expiresAt}`);
        console.log(`   Is Active: ${isActive}`);

        if (isActive) {
          const radiusStatus = await radiusService.checkHotspotUserStatus(mac, nasIp);

          if(!radiusStatus){
            await mikroticService.kickHotspotUser({router}, mac);
            return setTimeout(() => window.location.href = 'https://skylinknetworks.co.ke', 2000);
          }

          if(radiusStatus.status === 'active'){
            hotspotUser.activeSession.expiresAt = radiusStatus.expiryDate;
            hotspotUser.activeSession.isActive = true;
            await hotspotUser.save();
            const mikroticService = require("./services/mikroticService");
            await mikroticService.kickHotspotUser({router}, mac);
            return setTimeout(() => window.location.href = 'https://skylinknetworks.co.ke', 2000);
          }else{
          return res.send(renderHotspotPage({ packages, site, macAddress: mac, isRenewal: true, nasIp: nasIp, reason:radiusStatus.message }));
          }
          
          
        }

        const packageSite = hotspotUser.siteId
          ? await Site.findById(hotspotUser.siteId)
          : site;

        console.log('⏰ User expired/inactive — showing renewal portal');


        console.log(`📦 Found ${packages.length} packages for site ${packageSite.siteName}`);
        return res.send(renderHotspotPage({ packages, site: packageSite, macAddress: mac, isRenewal: false, nasIp: nasIp }));

      } else {
        console.log('🆕 New hotspot user — showing registration portal');

        console.log(`📦 Found ${packages.length} packages for new user at site ${site.siteName}`);
        return res.send(renderHotspotPage({ packages, site, macAddress: mac, isRenewal: true, nasIp: nasIp }));
      }
    }

    // ============================================
    // PPPOE USER FLOW
    // ============================================
    console.log('\n🔌 === PPPOE USER DETECTED ===');
    console.log(`   Username: ${username}`);

    // Fetch the latest authentication log for this username
    const authLog = await getRadiusAuthLog(username);
    if (!authLog) {
      console.log('⚠️ No authentication log found – cannot determine issue');
      return res.status(400).send(renderError('Unable to determine the issue with your account. Please contact support.'));
    }

    const authResult = authLog.auth_result;
    console.log(`   Latest auth result: ${authResult} at ${authLog.auth_timestamp}`);

    if (authResult !== 'correct' && authResult !== 'disabled') {
      try {
        const decoded = Buffer.from(authLog.password, 'base64').toString('utf8');
        console.log(`   Attempted password (base64 decoded): ${decoded}`);
      } catch (e) {}
    }

    const customer = await Customer.findOne({ 'pppoe.username': username })
      .populate('subscription.packageId')
      .populate('siteId');

    if (!customer) {
      console.log('❌ Customer not found in MongoDB');
      return res.status(404).send(renderError('Customer account not found. Please contact support.'));
    }

    console.log(`✅ Customer: ${customer.accountId} (${customer.firstName} ${customer.lastName})`);
    console.log(`   Subscription status: ${customer.subscription?.status}`);
    console.log(`   Expires at: ${customer.subscription?.expiresAt}`);

    const site = customer.siteId;
    if (!site) {
      return res.status(500).send(renderError('Site configuration not found. Please contact support.'));
    }

    const packageDoc = customer.subscription?.packageId;
    if (!packageDoc) {
      return res.status(500).send(renderError('No package assigned to your account. Please contact support.'));
    }

    const supportPhone = '0111053184';
    const supportEmail = 'support@skylinknetworks.co.ke';
    const siteName = site.siteName || site.name;

    const now = new Date();
    const isExpired = customer.subscription?.expiresAt && new Date(customer.subscription.expiresAt) < now;
    const isActiveSubscription = customer.subscription?.status === 'active' && !isExpired;

    if (authResult === 'correct' && isActiveSubscription) {
      console.log('✅ Customer active and last auth correct – redirecting to Google');
      return res.redirect('https://skylinknetworks.co.ke');
    }

    if (customer.subscription?.status === 'suspended') {
      console.log('⛔ Account is suspended by admin');
      return res.send(renderSuspended(customer, siteName, supportPhone, supportEmail));
    }

    switch (authResult) {
      case 'disabled':
        console.log('⏰ Account disabled (expired) – show renewal portal');
        return res.send(renderPppoeRenewal({ customer, package: packageDoc, site, issue: 'expired' }));

      case 'wrong_password':
        console.log('🔑 Wrong password used');
        return res.send(renderWrongPassword(customer.pppoe.username, siteName, supportPhone, supportEmail));

      case 'mac_mismatch':
        console.log('🖧 MAC address mismatch');
        return res.send(renderMacMismatch(customer.pppoe.username, siteName, supportPhone, supportEmail));

      case 'no_user':
        console.log('❓ User does not exist in RADIUS');
        return res.send(renderNonExistent(customer.pppoe.username, siteName, supportPhone, supportEmail));

      case 'correct':
        console.log('⚠️ Auth correct but customer not active – show renewal portal');
        return res.send(renderPppoeRenewal({ customer, package: packageDoc, site, issue: 'expired' }));

      default:
        console.log(`⚠️ Unknown auth result: ${authResult}`);
        return res.send(renderError('Unable to determine the issue with your account. Please contact support.'));
    }

  } catch (error) {
    console.error('❌ Portal error:', error);
    return res.status(500).send(renderError('An error occurred. Please try again or contact support.'));
  }
}

app.get('/portal', portalHandler);

app.get('/portal/:nasIp', (req, res) => {
  req.body = { 'nas-ip': req.params.nasIp };
  console.log("Request came with nas: ", req.params.nasIp)
  portalHandler(req, res);
});



function renderExpoPage(macAddress, nasIp) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Expo Experience – Skylink Networks</title>
  <style>${brandStyles}</style>
  <style>
    /* ── Expo specific styles ── */
    .expo-container { width: 100%; margin: 0 auto; }
    .expo-form .form-group { margin-bottom: 1.25rem; }
    .expo-form .form-label { display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.4rem; }
    .expo-form .tech-input { width: 100%; }
    .expo-form .btn-primary { margin-top: 0.5rem; }
    .expo-success { display: none; text-align: center; padding: 2rem; }
    .expo-success .icon { font-size: 4rem; margin-bottom: 1rem; }
    .expo-success h2 { font-size: 1.5rem; margin-bottom: 0.5rem; }

    /* ── Mobile full‑width improvements ── */
    @media (max-width: 640px) {
      .portal-container {
        padding: 1rem 0.75rem;
      }
      .expo-container {
        padding: 0;
      }
      .glass-card {
        padding: 1.5rem 1rem;
        border-radius: 6px;
      }
      .heading-lg {
        font-size: 1.4rem;
        text-align: center;
      }
      .subheading {
        font-size: 0.9rem;
        text-align: center;
        max-width: 100%;
      }
      .brand-logo-wrapper img {
        height: 32px;
      }
      .brand-header {
        margin-bottom: 0.5rem;
        padding-bottom: 0.5rem;
      }
    }
  </style>
</head>
<body>
<div class="portal-container">
  <header class="brand-header">
    <div class="brand-logo-wrapper">
      <img src="data:image/png;base64,${logoBase64}" alt="Skylink Networks">
    </div>
  </header>

  <main class="expo-container">
    <h1 class="heading-lg" style="text-align:center;">Welcome to the Expo</h1>
    <p class="subheading" style="text-align:center; max-width:100%;">Enter your details to get connected for free.</p>

    <div class="glass-card" style="margin-top:2rem; width:100%;">
      <form id="expoForm" class="expo-form">
        <div class="form-group">
          <label class="form-label" for="firstName">First Name</label>
          <input type="text" id="firstName" class="tech-input" placeholder="e.g. John" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="lastName">Last Name</label>
          <input type="text" id="lastName" class="tech-input" placeholder="e.g. Doe" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="phone">Phone Number</label>
          <input type="tel" id="phone" class="tech-input" placeholder="0712345678" required>
        </div>
        <button type="submit" class="btn-primary" id="activateBtn">Get Connected</button>
      </form>

      <div id="loadingMessage" style="display:none; text-align:center; margin-top:1.5rem;">
        <div class="spinner"></div>
        <p style="color:var(--text-muted); font-size:0.85rem;">Activating your connection…</p>
      </div>
      <div class="expo-success" id="successMessage">
        <div class="icon">🎉</div>
        <h2>You're Connected!</h2>
        <p style="color:var(--text-muted);">You now have free internet access for the expo. Enjoy!</p>
        <button class="btn-primary" style="margin-top:1rem; width:auto; padding:0.6rem 2rem;" onclick="window.location.href='https://skylinknetworks.co.ke'">Start Browsing</button>
      </div>
      <div class="message-box error" id="errorMessage"></div>
    </div>
  </main>

  <footer class="brand-footer">
    <span>© 2026 Skylink Networks</span>
    <div>
      <a href="tel:0111053184">Call Support</a>
      <a href="mailto:support@skylinknetworks.co.ke">Email</a>
    </div>
  </footer>
</div>

<script>
  const macAddress = '${macAddress}';
  const nasIp = '${nasIp}';

  document.getElementById('expoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const phone = document.getElementById('phone').value.trim();
    if (!firstName || !lastName || !phone) {
      showError('Please fill in all fields.');
      return;
    }

    const form = document.getElementById('expoForm');
    const loader = document.getElementById('loadingMessage');
    const successDiv = document.getElementById('successMessage');
    const errorDiv = document.getElementById('errorMessage');

    form.style.display = 'none';
    loader.style.display = 'block';
    errorDiv.style.display = 'none';

    try {
      const res = await fetch('/expo-experience/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ macAddress, nasIp, firstName, lastName, phone })
      });
      const data = await res.json();
      loader.style.display = 'none';
      if (data.success) {
        successDiv.style.display = 'block';
      } else {
        showError(data.error || 'Activation failed. Please try again.');
        form.style.display = 'block';
      }
    } catch (err) {
      loader.style.display = 'none';
      showError('Network error. Please try again.');
      form.style.display = 'block';
    }
  });

  function showError(msg) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
  }
</script>
</body>
</html>`;
}


app.post('/expo-experience/activate', async (req, res) => {
  try {
    const { macAddress, nasIp, firstName, lastName, phone } = req.body;
    if (!macAddress || !nasIp || !firstName || !lastName || !phone) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }

    const EXPO_PACKAGE_ID = '6a50aaf836e7383bfa8ad8d2';
    if (!EXPO_PACKAGE_ID) {
      console.error('EXPO_PACKAGE_ID not set');
      return res.status(500).json({ success: false, error: 'Service configuration error.' });
    }

    const packageDoc = await Package.findById(EXPO_PACKAGE_ID);
    if (!packageDoc) {
      return res.status(500).json({ success: false, error: 'Package not found.' });
    }

    const normalizedMac = macAddress.toUpperCase().replace(/[:-]/g, '').replace(/(..)/g, '$1:').slice(0, 17);
    const now = new Date();
    const expiry = calculatePeriodEnd(now, packageDoc.period, packageDoc.periodUnit);
    const username = `hs_${normalizedMac.replace(/:/g, '').toUpperCase()}`;
    const groupName = packageDoc.packageName.replace(/\s+/g, '_').toUpperCase();

    // Clean up RADIUS records
    try {
      const conn = await radiusService.getConnection();
      await conn.query('DELETE FROM radcheck WHERE username = ?', [username]);
      await conn.query('DELETE FROM radusergroup WHERE username = ?', [username]);
      await conn.query('DELETE FROM radreply WHERE username = ?', [username]);
      await conn.query('DELETE FROM user_billing_cycle WHERE username = ?', [username]);
      await conn.query('DELETE FROM radacct WHERE username = ? AND acctstoptime IS NOT NULL', [username]);
      conn.release();
    } catch (err) {
      console.error('RADIUS cleanup error:', err.message);
    }

    const dataLimitMB = packageDoc.dataLimit || (packageDoc.fup?.enabled ? packageDoc.fup.dataThresholdGB * 1024 : null);
    const radResult = await radiusService.createHotspotAccount(normalizedMac, groupName, dataLimitMB, expiry);

    if (!radResult.success) {
      return res.status(500).json({ success: false, error: 'Failed to create network session.' });
    }

    // Update or create HotspotUser with first/last name
    let hotspotUser = await HotspotUser.findOne({ macAddress: normalizedMac });
    if (!hotspotUser) {
      const site = await Site.findOne({ isActive: true, hasHotspot: true }).sort({ createdAt: 1 });
      hotspotUser = new HotspotUser({
        macAddress: normalizedMac,
        regionCode: site?.regionCode || 'EXPO',
        siteId: site?._id || null,
        firstName,
        lastName,
        phoneNumber: phone,
        activeSession: { isActive: false }
      });
    } else {
      hotspotUser.firstName = firstName;
      hotspotUser.lastName = lastName;
      hotspotUser.phoneNumber = phone;
    }

    hotspotUser.kickedAt = null;
    hotspotUser.activeSession = {
      packageId: packageDoc._id,
      startedAt: now,
      expiresAt: expiry,
      isActive: true,
      dataLimit: dataLimitMB || null,
      dataUsed: 0
    };
    if (!hotspotUser.purchaseHistory) hotspotUser.purchaseHistory = [];
    hotspotUser.purchaseHistory.push({
      packageId: packageDoc._id,
      purchasedAt: now,
      amount: 0,
      transactionId: `EXPO-${normalizedMac.replace(/:/g, '')}`
    });
    if (hotspotUser.purchaseHistory.length > 20) {
      hotspotUser.purchaseHistory = hotspotUser.purchaseHistory.slice(-20);
    }
    hotspotUser.paymentCounter = (hotspotUser.paymentCounter || 0) + 1;
    await hotspotUser.save();

    // Set billing cycle start
    await radiusService.setBillingCycleStart(username, new Date());
    if (packageDoc.fup?.enabled) {
      const quotaBytes = packageDoc.fup.dataThresholdGB * 1024 * 1024 * 1024;
      await radiusService.enableFUPForCustomer(username, quotaBytes);
    }

    // Kick the user so they re-auth with new credentials
    const router = await Router.findOne({ ip: nasIp });
    if (router) {
      setImmediate(async () => {
        try {
          await mikroticService.kickHotspotUser({ router }, normalizedMac);
        } catch (coaErr) {
          console.warn('CoA failed:', coaErr.message);
        }
      });
    }

    res.json({ success: true, message: 'Activation successful. You will be connected shortly.' });
  } catch (error) {
    console.error('Expo activation error:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});


// ============================================
// EXPO EXPERIENCE – ROUTE WITH NAS IP PARAM
// ============================================

// ============================================
// EXPO EXPERIENCE – ROUTE WITH NAS IP PARAM
// ============================================

app.get('/expo-experience/:nasIp?', async (req, res) => {
  console.log('\n🎪 === EXPO REDIRECT REQUEST ===');
  console.log('Params:', req.params);
  console.log('Query:', req.query);
  console.log('Headers:', req.headers);

  // 1. Get client IP (same as portal handler)
  const clientIp = getClientIp(req);
  if (!clientIp) {
    console.log('❌ No client IP detected');
    return res.status(400).send(renderError('Unable to detect your IP address. Please reconnect.'));
  }

  // 2. Get NAS IP – priority: URL param → query param → headers
  let nasIp = req.params.nasIp || req.query['nas-ip'] || getNasIp(req);
  if (!nasIp) {
    console.log('❌ No NAS IP detected');
    return res.status(400).send(renderError('Unable to identify router. Please reconnect.'));
  }

  // 3. Try to get RADIUS session (like portal handler)
  let mac = null;
  const session = await getRadiusSession(clientIp, nasIp);
  if (session) {
    const username = session.username;
    console.log(`👤 Session username: ${username}`);
    // Derive MAC if hotspot user (hs_ prefix)
    if (username.startsWith('hs_')) {
      // Convert hs_1E0D64C69EC9 → 1E:0D:64:C6:9E:C9
      const macFromUsername = username
        .replace('hs_', '')
        .match(/.{2}/g)
        ?.join(':')
        .toUpperCase();
      if (macFromUsername) {
        mac = macFromUsername;
        console.log(`✅ MAC derived from RADIUS session: ${mac}`);
      }
    } else {
      // If it's a PPPoE user, we probably shouldn't be in expo – but we can still try query MAC
      console.warn('⚠️ Session username does not start with hs_ – falling back to query MAC');
    }
  }

  // 4. Fallback to query MAC if no session or no MAC derived
  if (!mac) {
    mac = getClientMac(req); // reads req.query.mac
    if (mac) {
      console.log(`✅ MAC from query param: ${mac}`);
    }
  }

  // 5. If still no MAC, error
  if (!mac) {
    console.log('❌ No MAC address found – cannot proceed');
    return res.status(400).send(renderError('MAC address could not be determined. Please reconnect.'));
  }

  // Normalize MAC format (uppercase, colon-separated)
  mac = mac.toUpperCase().replace(/[:-]/g, '').replace(/(..)/g, '$1:').slice(0, 17);
  if (mac.endsWith(':')) mac = mac.slice(0, -1);

  console.log(`✅ Final MAC: ${mac}, NAS IP: ${nasIp}`);

  // Render the Expo page
  res.send(renderExpoPage(mac, nasIp));
});


// ============================================
// FORCE RE-AUTHENTICATION ENDPOINT
// ============================================

/**
 * @desc    Force re-authentication for a client IP
 * @route   POST /force-reauth
 * @access  Public (called from portal error page)
 * Body: { ip, nasIp }
 */
app.post('/force-reauth', express.json(), async (req, res) => {
  try {
    const { ip, nasIp } = req.body;

    if (!ip || !nasIp) {
      return res.status(400).json({ success: false, error: 'IP and NAS IP are required' });
    }

    // Find router by NAS IP
    const router = await Router.findOne({ ip: nasIp });
    if (!router) {
      return res.status(404).json({ success: false, error: 'Router not found for this NAS IP' });
    }

    // Build site object for forceReauthentication
    const site = {
      ip: router.ip,
      port: router.apiPort || 8728,
      username: router.username,
      password: router.password,
    };

    const result = await mikroticService.forceReauthentication(site, ip);

    if (result.success) {
      return res.json({ success: true, message: `Session terminated for ${ip}` });
    } else {
      return res.status(500).json({ success: false, error: result.error || 'Failed to terminate session' });
    }
  } catch (error) {
    console.error('Force re-auth error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// PAYMENT ENDPOINTS
// ============================================

/**
 * Initiate payment for PPPoE customer
 */
app.post('/payment/pppoe/initiate', async (req, res) => {
  try {
    console.log('\n💳 === PPPoE PAYMENT INITIATION ===');
    const { customerId, phoneNumber } = req.body;

    if (!customerId || !phoneNumber) {
      return res.status(400).json({ success: false, message: 'Customer ID and phone number required' });
    }

    const customer = await Customer.findById(customerId)
      .populate('subscription.packageId')
      .populate('siteId');

    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const packageDoc = customer.subscription.packageId;
    const site = customer.siteId;

    if (!packageDoc) return res.status(400).json({ success: false, message: 'No package assigned' });

    const preferredGateway = site?.preferredPaymentGateway || 'kopokopo';
    const amount = packageDoc.price;
    const formattedPhone = formatPhoneNumber(phoneNumber);

    let paymentResult;
    let paymentData;

    if (preferredGateway === 'daraja') {
      // ─── Daraja (M‑Pesa) ──────────────────────────────────────
      const mpesaConfig = site?.payment?.mpesa;
      if (!mpesaConfig || !mpesaConfig.consumerKey || !mpesaConfig.consumerSecret || !mpesaConfig.passkey || !mpesaConfig.shortcode) {
        return res.status(400).json({ success: false, message: 'M‑Pesa credentials not configured for this site' });
      }

      // Inject credentials
      mpesaService.consumerKey = mpesaConfig.consumerKey;
      mpesaService.consumerSecret = mpesaConfig.consumerSecret;
      mpesaService.passkey = mpesaConfig.passkey;
      mpesaService.shortcode = mpesaConfig.shortcode;
      mpesaService.environment = mpesaConfig.environment || 'sandbox';

      const callbackUrl = `${process.env.BASE_URL}/api/payments/mpesa/webhook`;
      const mpesaResult = await mpesaService.initiateSTKPush({
        phoneNumber: formattedPhone,
        amount,
        accountReference: customer.accountId,
        callbackUrl,
        transactionDesc: `${packageDoc.packageName} subscription`
      });

      if (!mpesaResult.success) {
        console.error('❌ M‑Pesa STK push failed:', mpesaResult.error);
        return res.status(500).json({ success: false, message: mpesaResult.error || 'M‑Pesa STK push failed' });
      }

      paymentResult = {
        success: true,
        checkoutRequestId: mpesaResult.checkoutRequestId,
        merchantRequestId: mpesaResult.merchantRequestId,
      };

      paymentData = {
        customerId: customer._id,
        accountId: customer.accountId,
        customerType: 'pppoe',
        regionCode: customer.regionCode,
        siteId: site._id,
        source: 'stk',
        amount,
        paymentMethod: 'mpesa',
        status: 'pending',
        packageId: packageDoc._id,
        paymentChannel: 'mpesa',
        stkID: mpesaResult.checkoutRequestId,
        checkoutRequestId: mpesaResult.checkoutRequestId,
        stkPush: {
          phoneNumber: formattedPhone,
          checkoutRequestId: mpesaResult.checkoutRequestId,
          merchantRequestId: mpesaResult.merchantRequestId || null,
          initiatedAt: new Date()
        },
        metadata: {
          packageId: packageDoc._id,
          packageName: packageDoc.packageName,
          phoneNumber: formattedPhone,
          initiatedAt: new Date(),
          gateway: 'daraja',
          rawInitResponse: {
            checkoutRequestId: mpesaResult.checkoutRequestId,
            merchantRequestId: mpesaResult.merchantRequestId,
            responseCode: mpesaResult.responseCode,
            responseDescription: mpesaResult.responseDescription,
            customerMessage: mpesaResult.customerMessage,
          }
        }
      };

    } else {
      // ─── Kopokopo (existing) ──────────────────────────────────
      const siteConfig = site?.payment?.kopokopo;
      if (!siteConfig || !siteConfig.clientId) {
        return res.status(400).json({ success: false, message: 'Payment system not configured' });
      }

      const channel = kopokopoService.detectChannel(formattedPhone);
      const callbackUrl = `${process.env.BASE_URL}/api/payments/kopokopo/webhook`;

      const kopokopoResult = await kopokopoService.initiatePaymentRequest({
        phoneNumber: formattedPhone,
        amount,
        reference: customer.accountId,
        description: `${packageDoc.packageName} subscription`,
        callbackUrl,
        channel,
        credentials: {
          clientId: siteConfig.clientId,
          clientSecret: siteConfig.clientSecret,
          apiKey: siteConfig.apiKey,
          tillNumber: siteConfig.tillNumber,
          environment: siteConfig.environment || 'sandbox'
        },
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        metadata: {
          customerId: customer._id.toString(),
          packageId: packageDoc._id.toString(),
          customerType: 'pppoe'
        }
      });

      if (!kopokopoResult.success) {
        console.error('❌ KopoKopo error:', kopokopoResult.error);
        return res.status(500).json({ success: false, message: kopokopoResult.error || 'Payment initiation failed' });
      }

      paymentResult = kopokopoResult;

      paymentData = {
        customerId: customer._id,
        accountId: customer.accountId,
        customerType: 'pppoe',
        regionCode: customer.regionCode,
        siteId: site._id,
        source: 'stk',
        amount,
        paymentMethod: channel,
        status: 'pending',
        kopokopoPaymentId: kopokopoResult.paymentRequestId,
        checkoutRequestId: kopokopoResult.paymentRequestId,
        stkID: kopokopoResult.paymentRequestId,
        kopokopoLocation: kopokopoResult.location,
        stkPush: { phoneNumber: formattedPhone },
        packageId: packageDoc._id,
        paymentChannel: channel,
        metadata: {
          packageId: packageDoc._id,
          packageName: packageDoc.packageName,
          phoneNumber: formattedPhone,
          initiatedAt: new Date(),
          paymentUrl: kopokopoResult.paymentUrl
        }
      };
    }

    // Create payment record
    const payment = await Payment.create(paymentData);

    await SystemLog.create({
      eventType: 'payment_initiated',
      severity: 'info',
      regionCode: customer.regionCode,
      entityType: 'payment',
      entityId: payment._id,
      accountId: customer.accountId,
      message: `${paymentData.paymentMethod.toUpperCase()} payment of KES ${amount} initiated for ${customer.accountId} via ${preferredGateway}`,
      details: {
        amount,
        channel: paymentData.paymentMethod,
        paymentId: payment._id,
        gateway: preferredGateway,
        ...(preferredGateway === 'daraja' ? { checkoutRequestId: paymentData.stkID } : { kopokopoPaymentId: paymentData.kopokopoPaymentId })
      },
      success: true
    });

    // Response
    const responseData = {
      paymentId: payment._id,
      amount,
      channel: paymentData.paymentMethod,
      status: 'pending',
    };

    let message;
    if (preferredGateway === 'daraja') {
      message = 'M‑Pesa STK push sent. Please check your phone.';
      responseData.checkoutRequestId = paymentData.stkID;
    } else {
      message = `${paymentData.paymentMethod.toUpperCase()} payment request sent. Please check your phone.`;
      responseData.kopokopoPaymentId = paymentData.kopokopoPaymentId;
      if (paymentData.metadata.paymentUrl) responseData.paymentUrl = paymentData.metadata.paymentUrl;
    }

    res.status(200).json({
      success: true,
      message,
      data: responseData
    });

  } catch (error) {
    console.error('❌ Payment initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment initiation failed',
      error: error.message
    });
  }
});
/**
 * Initiate payment for Hotspot user
 */
app.post('/payment/hotspot/initiate', async (req, res) => {
  try {
    const { packageId, phoneNumber, macAddress, siteId, nasIp } = req.body;
    
    console.log('\n💰 === HOTSPOT PAYMENT INITIATION ===');
    console.log(`   Package ID: ${packageId}`);
    console.log(`   Phone: ${phoneNumber}`);
    console.log(`   MAC: ${macAddress}`);
    console.log(`   Site ID: ${siteId}`);
    
    if (!packageId || !phoneNumber || !macAddress || !siteId) {
      return res.status(400).json({
        success: false,
        message: 'Package ID, phone number, MAC address, and site ID are required'
      });
    }
    
    const packageDoc = await Package.findById(packageId);
    if (!packageDoc) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }
    
    const site = await Site.findById(siteId);
    if (!site) {
      return res.status(500).json({ success: false, message: 'Site not found' });
    }

    const preferredGateway = site?.preferredPaymentGateway || 'kopokopo';
    const amount = packageDoc.price;
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const normalizedMac = macAddress.toUpperCase();
    
    // Check if hotspot user exists
    let hotspotUser = await HotspotUser.findOne({ macAddress: normalizedMac });
    
    let paymentResult;
    let paymentData;

    if (preferredGateway === 'daraja') {
      // ─── Daraja (M‑Pesa) ──────────────────────────────────────
      const mpesaConfig = site?.payment?.mpesa;
      if (!mpesaConfig || !mpesaConfig.consumerKey || !mpesaConfig.consumerSecret || !mpesaConfig.passkey || !mpesaConfig.shortcode) {
        return res.status(400).json({ success: false, message: 'M‑Pesa credentials not configured for this site' });
      }

      mpesaService.consumerKey = mpesaConfig.consumerKey;
      mpesaService.consumerSecret = mpesaConfig.consumerSecret;
      mpesaService.passkey = mpesaConfig.passkey;
      mpesaService.shortcode = mpesaConfig.shortcode;
      mpesaService.environment = mpesaConfig.environment || 'sandbox';

      const callbackUrl = `${process.env.BASE_URL}/api/payments/mpesa/webhook`;
      const mpesaResult = await mpesaService.initiateSTKPush({
        phoneNumber: formattedPhone,
        amount,
        accountReference: normalizedMac,
        callbackUrl,
        transactionDesc: `${packageDoc.packageName} - Hotspot`
      });

      if (!mpesaResult.success) {
        console.error('❌ M‑Pesa STK push failed:', mpesaResult.error);
        return res.status(500).json({ success: false, message: mpesaResult.error || 'M‑Pesa STK push failed' });
      }

      paymentResult = {
        success: true,
        checkoutRequestId: mpesaResult.checkoutRequestId,
        merchantRequestId: mpesaResult.merchantRequestId,
      };

      paymentData = {
        customerId: hotspotUser?._id || null,
        accountId: hotspotUser?.accountId || `HOTSPOT-${normalizedMac.replace(/:/g, '')}`,
        customerType: 'hotspot',
        regionCode: site.regionCode,
        siteId: site._id,
        source: 'stk',
        amount,
        paymentMethod: 'mpesa',
        status: 'pending',
        packageId: packageDoc._id,
        paymentChannel: 'mpesa',
        stkID: mpesaResult.checkoutRequestId,
        checkoutRequestId: mpesaResult.checkoutRequestId,
        stkPush: {
          phoneNumber: formattedPhone,
          checkoutRequestId: mpesaResult.checkoutRequestId,
          merchantRequestId: mpesaResult.merchantRequestId || null,
          initiatedAt: new Date()
        },
        metadata: {
          packageId: packageDoc._id,
          packageName: packageDoc.packageName,
          phoneNumber: formattedPhone,
          initiatedAt: new Date(),
          gateway: 'daraja',
          macAddress: normalizedMac,
          nasIp: nasIp,
          rawInitResponse: {
            checkoutRequestId: mpesaResult.checkoutRequestId,
            merchantRequestId: mpesaResult.merchantRequestId,
            responseCode: mpesaResult.responseCode,
            responseDescription: mpesaResult.responseDescription,
            customerMessage: mpesaResult.customerMessage,
          }
        }
      };

    } else {
      // ─── Kopokopo ──────────────────────────────────────────────
      const siteConfig = site.payment?.kopokopo;
      if (!siteConfig || !siteConfig.clientId) {
        return res.status(500).json({ success: false, message: 'Payment configuration not found for site' });
      }

      const channel = kopokopoService.detectChannel(formattedPhone);
      console.log(`   Channel: ${channel.toUpperCase()}`);
      console.log(`   Amount: KES ${amount}`);
      
      const callbackUrl = `${process.env.BASE_URL}/api/payments/kopokopo/webhook`;
      const reference = hotspotUser?.accountId || `HOTSPOT-${normalizedMac.replace(/:/g, '')}`;

      const kopokopoResult = await kopokopoService.initiatePaymentRequest({
        phoneNumber: formattedPhone,
        amount,
        reference,
        description: `${packageDoc.packageName} - Hotspot`,
        callbackUrl,
        channel,
        credentials: {
          clientId: siteConfig.clientId,
          clientSecret: siteConfig.clientSecret,
          apiKey: siteConfig.apiKey,
          tillNumber: siteConfig.tillNumber,
          environment: siteConfig.environment || 'sandbox'
        },
        firstName: 'Hotspot',
        lastName: 'User',
        metadata: {
          macAddress: normalizedMac,
          packageId: packageDoc._id.toString(),
          siteId: site._id.toString(),
          hotspotUserId: hotspotUser?._id?.toString()
        }
      });

      if (!kopokopoResult.success) {
        console.error('❌ KopoKopo initiation failed:', kopokopoResult.error);
        return res.status(500).json({ success: false, message: 'Payment initiation failed', error: kopokopoResult.error });
      }

      paymentResult = kopokopoResult;

      paymentData = {
        customerId: hotspotUser?._id || null,
        accountId: hotspotUser?.accountId || reference,
        customerType: 'hotspot',
        regionCode: site.regionCode,
        siteId: site._id,
        stkID: kopokopoResult.paymentRequestId,
        checkoutRequestId: kopokopoResult.paymentRequestId,
        kopokopoPaymentId: kopokopoResult.paymentRequestId,
        kopokopoLocation: kopokopoResult.location,
        packageId: packageDoc._id,
        amount,
        phoneNumber: formattedPhone,
        paymentMethod: channel === 'mpesa' ? 'mpesa' : 'airtel',
        status: 'pending',
        source: 'stk',
        paymentChannel: channel,
        metadata: {
          channel,
          location: kopokopoResult.location,
          macAddress: normalizedMac,
          initiatedFrom: 'hotspot_redirect',
          paymentRequestId: kopokopoResult.paymentRequestId,
          packageId: packageDoc._id,
          nasIp
        }
      };
    }

    // Create payment record
    const payment = await Payment.create(paymentData);
    
    console.log(`✅ Payment record created: ${payment._id}`);
    
    // System log
    await SystemLog.create({
      eventType: 'payment_initiated',
      severity: 'info',
      regionCode: site.regionCode,
      entityType: 'payment',
      entityId: payment._id,
      message: `Hotspot payment of KES ${amount} initiated for MAC ${normalizedMac} via ${preferredGateway}`,
      details: {
        amount,
        channel: paymentData.paymentMethod,
        paymentId: payment._id,
        gateway: preferredGateway,
        macAddress: normalizedMac,
        ...(preferredGateway === 'daraja' ? { checkoutRequestId: paymentData.stkID } : { kopokopoPaymentId: paymentData.kopokopoPaymentId })
      },
      success: true
    });

    // Response
    const responseData = {
      paymentId: payment._id,
      paymentRequestId: preferredGateway === 'daraja' ? paymentData.stkID : paymentData.kopokopoPaymentId,
      channel: paymentData.paymentMethod,
      amount
    };

    if (preferredGateway === 'daraja') {
      responseData.checkoutRequestId = paymentData.stkID;
    }

    return res.status(200).json({
      success: true,
      message: 'Successfully initiated, wait and enter PIN from your phone...',
      data: responseData
    });
    
  } catch (error) {
    console.error('❌ Hotspot payment initiation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Payment initiation failed',
      error: error.message
    });
  }
});

// ============================================
// VOUCHER REDEMPTION ENDPOINT (with cleanup)
// ============================================
// ============================================
// VOUCHER REDEMPTION ENDPOINT
// POST /voucher/redeem
// Body: { code, macAddress, nasIp }
// ============================================
app.post('/voucher/redeem', async (req, res) => {
  try {
    const { code, macAddress, nasIp } = req.body;
    if (!code || !macAddress || !nasIp) {
      return res.status(400).json({ success: false, error: 'code, macAddress and nasIp are required' });
    }

    const normalizedCode = code.toUpperCase().trim();
    const normalizedMac  = macAddress.toUpperCase();
    const now            = new Date();

    // ── 1. Atomically mark the individual code as used ──────────────────────
    const voucher = await Voucher.findOneAndUpdate(
      {
        'codes': { $elemMatch: { code: normalizedCode, used: false } },
      },
      {
        $set: {
          'codes.$[slot].used':       true,
          'codes.$[slot].usedAt':     now,
          'codes.$[slot].usedByMac':  normalizedMac,
        },
      },
      {
        arrayFilters: [{ 'slot.code': normalizedCode, 'slot.used': false }],
        new: true,
      }
    ).populate('packageId');

    if (!voucher) {
      // Tell the user whether code was invalid or already redeemed
      const exists = await Voucher.findOne({ 'codes.code': normalizedCode });
      if (!exists) {
        return res.status(404).json({ success: false, error: 'Invalid voucher code' });
      }
      return res.status(400).json({ success: false, error: 'This voucher code has already been used' });
    }

    const pkg = voucher.packageId;
    if (!pkg) {
      // Roll back
      await Voucher.findOneAndUpdate( 
        { 'codes.code': normalizedCode },
        { $set: { 'codes.$[slot].used': false, 'codes.$[slot].usedAt': null, 'codes.$[slot].usedByMac': null } },
        { arrayFilters: [{ 'slot.code': normalizedCode }] }
      );
      return res.status(500).json({ success: false, error: 'Voucher has no valid package linked' });
    }

    // ── 2. Build expiry from package period ─────────────────────────────────
    let expiry;

    if(voucher.enjoyUntil){
      expiry = voucher.enjoyUntil;
    }else{
      expiry = calculatePeriodEnd(now, pkg.period, pkg.periodUnit);
    }

    if(expiry < now){
      return res.status(400).json({
        success: false,
        error: 'This voucher has expired. It was valid until ' + expiry.toLocaleString('en-GB', {
          timeZone: 'Africa/Nairobi',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
      });
    }




    const username  = `hs_${normalizedMac.replace(/:/g, '').toUpperCase()}`;
    const groupName = pkg.packageName.replace(/\s+/g, '_').toUpperCase();

    // ── 3. Clean up existing RADIUS records ─────────────────────────────────
    const radiusService = require('./services/radiusService');
    try {
      const conn = await radiusService.getConnection();
      await conn.query('DELETE FROM radcheck          WHERE username = ?', [username]);
      await conn.query('DELETE FROM radusergroup      WHERE username = ?', [username]);
      await conn.query('DELETE FROM radreply          WHERE username = ?', [username]);
      await conn.query('DELETE FROM user_billing_cycle WHERE username = ?', [username]);
      await conn.query('DELETE FROM radacct           WHERE username = ? AND acctstoptime IS NOT NULL', [username]);
      conn.release();
      console.log(`🧹 Cleaned RADIUS records for ${username}`);
    } catch (err) {
      console.error('⚠️ RADIUS deletion error:', err.message);
    }

    // ── 4. Create fresh RADIUS account ──────────────────────────────────────
    const dataLimitMB = pkg.dataLimit || (pkg.fup?.enabled ? pkg.fup.dataThresholdGB * 1024 : null);
    const radiusResult = await radiusService.createHotspotAccount(normalizedMac, groupName, dataLimitMB, expiry);

    if (!radiusResult.success) {
      // Roll back
      await Voucher.findOneAndUpdate(
        { 'codes.code': normalizedCode },
        { $set: { 'codes.$[slot].used': false, 'codes.$[slot].usedAt': null, 'codes.$[slot].usedByMac': null } },
        { arrayFilters: [{ 'slot.code': normalizedCode }] }
      );
      return res.status(500).json({ success: false, error: 'Failed to create network session. Please contact support.' });
    }

    // ── 5. Billing cycle + FUP ───────────────────────────────────────────────
    await radiusService.setBillingCycleStart(username, new Date());
    if (pkg.fup?.enabled) {
      const quotaBytes = pkg.fup.dataThresholdGB * 1024 * 1024 * 1024;
      await radiusService.enableFUPForCustomer(username, quotaBytes);
    }

    // ── 6. Kick hotspot user (force re-auth) ─────────────────────────────────
   

    // ── 7. Update / create HotspotUser in MongoDB ────────────────────────────
    let hotspotUser = await HotspotUser.findOne({ macAddress: normalizedMac });
    if (!hotspotUser) {
      const router = await Router.findOne({ ip: nasIp });
      const site   = router ? await Site.findById(router.site) : null;
      hotspotUser  = new HotspotUser({
        macAddress: normalizedMac,
        regionCode: site?.regionCode,
        siteId:     site?._id,
        activeSession: { isActive: false },
      });
    }

    hotspotUser.kickedAt      = null;
    hotspotUser.activeSession = {
      packageId: pkg._id,
      startedAt: now,
      expiresAt: expiry,
      isActive:  true,
      dataLimit: pkg.dataLimit || null,
      dataUsed:  0,
    };
    if (!hotspotUser.purchaseHistory) hotspotUser.purchaseHistory = [];
    hotspotUser.purchaseHistory.push({
      packageId:     pkg._id,
      purchasedAt:   now,
      amount:        0,
      transactionId: `VOUCHER-${normalizedCode}`,
      voucherCode:   normalizedCode,
    });
    if (hotspotUser.purchaseHistory.length > 20) {
      hotspotUser.purchaseHistory = hotspotUser.purchaseHistory.slice(-20);
    }
    hotspotUser.paymentCounter = (hotspotUser.paymentCounter || 0) + 1;
    await hotspotUser.save();

    // ── 8. System log ────────────────────────────────────────────────────────
    await SystemLog.create({
      eventType: 'voucher_redeemed',
      severity:  'info',
      entityType: 'voucher',
      entityId:   voucher._id,
      message:    `Voucher ${normalizedCode} redeemed by MAC ${normalizedMac} → ${pkg.packageName} until ${expiry.toISOString()}`,
      success: true,
    });

// ── Send success response immediately ──
res.json({
  success: true,
  message: 'Voucher redeemed successfully. You are now being connected....',
  data: {
    voucherCode: normalizedCode,
    expiresAt: expiry,
    packageName: pkg.packageName,
  },
});

// ── Then, asynchronously kick the user (disconnect) ──
setImmediate(async () => {
  try {
    const router = await Router.findOne({ ip: nasIp });
    if (router) {
      const mikroticService = require('./services/mikroticService');
      await mikroticService.kickHotspotUser({ router }, normalizedMac);
    }
  } catch (coaErr) {
    console.warn(`CoA failed for MAC ${normalizedMac}:`, coaErr.message);
  }
});

return; // end the function (response already sent)

  } catch (error) {
    console.error('Voucher redemption error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


/**
 * Check payment status
 */
app.get('/payment/status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const payment = await Payment.findById(paymentId);
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: {
        paymentId: payment._id,
        status: payment.status,
        amount: payment.amount,
        completedAt: payment.completedAt
      }
    });
    
  } catch (error) {
    console.error('❌ Payment status check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check payment status'
    });
  }
});



function renderErrorPage(title, message, supportPhone = '0111053184', supportEmail = 'support@skylinknetworks.co.ke', retryUrl = null) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${title} – Skylink Networks</title>
  <style>${brandStyles}</style>
</head>
<body>
<div class="portal-container" style="justify-content:center;">
  <header class="brand-header">
   <div class="brand-logo-wrapper">
    <img src="data:image/png;base64,${logoBase64}" alt="Skylink Networks">
  </div>
  </header>
  <main class="error-center">
    <div class="error-icon">⛔</div>
    <h2 class="error-title">${title}</h2>
    <p class="error-message">${message}</p>
    <div style="display:flex; gap:1rem; flex-wrap:wrap; justify-content:center;">
      ${retryUrl ? `<button id="retryBtn" class="btn-primary" style="width:auto; padding:0.6rem 1.8rem; text-decoration:none; background:var(--skylink-blue);">Retry Connection</button>` : ''}
      <a href="tel:${supportPhone}" class="btn-primary" style="width:auto; padding:0.6rem 1.8rem; text-decoration:none;">Call Support</a>
      <a href="https://wa.me/${supportPhone.replace(/\D/g, '')}" target="_blank" class="btn-secondary" style="text-decoration:none;">WhatsApp</a>
    </div>
  </main>
  <footer class="brand-footer" style="margin-top:auto;">
    <span>© 2026 Skylink Networks</span>
    <div>
      <a href="tel:${supportPhone}">Call Support</a>
      <a href="mailto:${supportEmail}">Email</a>
      <a href="https://wa.me/${supportPhone.replace(/\D/g, '')}" target="_blank">WhatsApp</a>
    </div>
  </footer>
</div>

${retryUrl ? `
<script>
  document.getElementById('retryBtn').addEventListener('click', async function() {
    this.textContent = 'Trying...';
    this.disabled = true;
    try {
      const response = await fetch('${retryUrl}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: '${retryUrl.split('ip=')[1].split('&')[0]}', nasIp: '${retryUrl.split('nas=')[1]}' })
      });
      const data = await response.json();
      if (data.success) {
        window.location.reload();
      } else {
        alert(data.error || 'Failed to reconnect. Please contact support.');
        this.textContent = 'Retry Connection';
        this.disabled = false;
      }
    } catch (err) {
      alert('Network error. Please try again.');
      this.textContent = 'Retry Connection';
      this.disabled = false;
    }
  });
</script>
` : ''}
</body>
</html>`;
}


// ==========================================
// INDIVIDUAL ROUTERS USING THE PORTAL ENGINE
// ==========================================

function renderWrongPassword(username, siteName, supportPhone, supportEmail) {
  return renderErrorPage(
    'Wrong Credentials',
    `Account ${username} – incorrect credentials. Please contact support.`,
    supportPhone,
    supportEmail
  );
}

function renderMacMismatch(username, siteName, supportPhone, supportEmail) {
  return renderErrorPage(
    'Wrong Credentials ',
    `Account ${username} – the connected device-mac is not authorised. Please contact support.`,
    supportPhone,
    supportEmail
  );
}

function renderNonExistent(username, siteName, supportPhone, supportEmail) {
  return renderErrorPage(
    'Account Not Found',
    `No account found for '${username}'. Please register or contact support.`,
    supportPhone,
    supportEmail
  );
}

function renderSuspended(customer, siteName, supportPhone, supportEmail) {
  return renderErrorPage(
    'Subscription Paused',
    `Your subscription (${customer.accountId}) is currently paused. Please contact support.`,
    supportPhone,
    supportEmail
  );
}

function renderError(message, ipAddress = null, nasIp = null) {
  let retryUrl = null;
  // Only show retry button if both IPs are provided (used for "no session" scenario)
  if (ipAddress && nasIp) {
    retryUrl = `/force-reauth?ip=${encodeURIComponent(ipAddress)}&nas=${encodeURIComponent(nasIp)}`;
  }

  return renderErrorPage(
    'Something Went Wrong',
    message || 'An unexpected error occurred. Please try again later.',
    '0111053184',
    'support@skylinknetworks.co.ke',
    retryUrl
  );
}


// ============================================
// PPPOE RENEWAL - FUTURISTIC
// ============================================

function renderPppoeRenewal({ customer, package: packageDoc, site, issue }) {
  const supportPhone = site.supportContact?.phone || '0111053184';
  const supportEmail = site.supportContact?.email || 'support@skylinknetworks.co.ke';
  const accountId = customer.accountId;
  const customerName = `${customer.firstName} ${customer.lastName}`;
  const packageName = packageDoc.packageName;
  const packagePrice = packageDoc.price.toLocaleString();
  const expiresAt = customer.subscription?.expiresAt 
    ? new Date(customer.subscription.expiresAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Unknown';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Renew Subscription – Skylink Networks</title>
  <style>${brandStyles}</style>
</head>
<body>
<div class="portal-container">
  <header class="brand-header">
    <div class="brand-logo-wrapper">
    <img src="data:image/png;base64,${logoBase64}" alt="Skylink Networks">
  </div>
    
  </header>

  <main>
    <div class="two-col">
      <div>
        <h1 class="heading-lg">Subscription Expired</h1>
        <p class="subheading">Your subscription has expired. Renew now to restore full connectivity.</p>
        <div class="glass-card" style="margin-top: 1.5rem;">
          <div class="detail-grid">
            <div class="detail-row"><span class="detail-label">Account</span><span class="detail-value">${accountId}</span></div>
            <div class="detail-row"><span class="detail-label">Customer</span><span class="detail-value">${customerName}</span></div>
            <div class="detail-row"><span class="detail-label">Package</span><span class="detail-value">${packageName}</span></div>
            <div class="detail-row"><span class="detail-label">Expired</span><span class="detail-value" style="color:#f87171;">${expiresAt}</span></div>
          </div>
        </div>
      </div>

      <div class="glass-card">
        <div class="price-box">
          <div class="price-label">Renewal Amount</div>
          <div class="price-amount">KES ${packagePrice}</div>
        </div>

        <form id="paymentForm" onsubmit="initiatePayment(event)">
          <div class="form-group">
            <label class="form-label" for="phoneNumber">M-Pesa Phone Number</label>
            <input type="tel" id="phoneNumber" class="tech-input" placeholder="e.g 0712345678 or 254712345678" required>
          </div>
          <button type="submit" class="btn-primary" id="payBtn">Pay Now</button>
        </form>

        <div id="loadingMessage" style="display:none; text-align:center; margin-top:1.5rem;">
          <div class="spinner"></div>
          <p style="color:var(--text-muted); font-size:0.85rem;">Processing your payment…</p>
        </div>
        <div class="message-box success" id="successMessage"></div>
        <div class="message-box error" id="errorMessage"></div>
      </div>
    </div>
  </main>

  <footer class="brand-footer">
    <span>© 2026 Skylink Networks</span>
    <div>
      <a href="tel:${supportPhone}">Call Support</a>
      <a href="mailto:${supportEmail}">Email</a>
      <a href="https://wa.me/${supportPhone.replace(/\D/g, '')}" target="_blank">WhatsApp</a>
    </div>
  </footer>
</div>

<script>
  async function initiatePayment(e) {
    e.preventDefault();
    const phone = document.getElementById('phoneNumber').value;
    const payBtn = document.getElementById('payBtn');
    const loader = document.getElementById('loadingMessage');
    const successDiv = document.getElementById('successMessage');
    const errorDiv = document.getElementById('errorMessage');

    successDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    payBtn.disabled = true;
    loader.style.display = 'block';

    try {
      const res = await fetch('/payment/pppoe/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: '${customer._id}', phoneNumber: phone })
      });
      const data = await res.json();
      loader.style.display = 'none';
      if (data.success) {
        successDiv.style.display = 'block';
        successDiv.textContent = 'Payment request sent. Authorise on your M-Pesa.';
        document.getElementById('paymentForm').style.display = 'none';
        pollPaymentStatus(data.data.paymentId);
      } else {
        errorDiv.style.display = 'block';
        errorDiv.textContent = data.message || 'Payment initiation failed';
        payBtn.disabled = false;
      }
    } catch (err) {
      loader.style.display = 'none';
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Network error. Please try again.';
      payBtn.disabled = false;
    }
  }

  function pollPaymentStatus(paymentId) {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 60) { clearInterval(interval); return; }
      try {
        const res = await fetch('/payment/status/' + paymentId);
        const data = await res.json();
        if (data.success && data.data.status === 'completed') {
          clearInterval(interval);
          const successDiv = document.getElementById('successMessage');
          successDiv.textContent = 'Payment verified. Restoring access…';
          setTimeout(() => window.location.href = 'https://skylinknetworks.co.ke', 2000);
        } else if (data.data.status === 'failed') {
          clearInterval(interval);
          document.getElementById('errorMessage').style.display = 'block';
          document.getElementById('errorMessage').textContent = 'Payment failed. Please try again.';
          document.getElementById('payBtn').disabled = false;
          document.getElementById('paymentForm').style.display = 'block';
        }
      } catch (err) {}
    }, 2000);
  }
</script>
</body>
</html>`;
  return html;
}
// ============================================
// HOTSPOT PAGE - FUTURISTIC
// ============================================

function renderHotspotPage({ packages, site, macAddress, isRenewal = false, nasIp, reason = "" }) {
  const supportPhone = '0111053184';
  const supportEmail = 'support@skylinknetworks.co.ke';
  const heading = isRenewal ? 'Renew Hotspot' : 'Get Connected';
  const subText = isRenewal 
    ? 'Choose a package to renew your hotspot access.' 
    : 'Select a package and get online instantly.';

  const packagesHtml = packages.map((pkg) => `
    <div class="plan-card">
      <div class="plan-name">${pkg.packageName}</div>
      <div class="plan-price">KES ${pkg.price.toLocaleString()}</div>
      <button class="plan-btn" onclick="selectPackage('${pkg._id}', ${pkg.price}, '${pkg.packageName}')">Buy Now</button>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${heading} – Skylink Networks</title>
  <style>${brandStyles}</style>
  <style>
    .hotspot-layout {
      display: grid;
      grid-template-columns: 1fr 1.4fr;
      gap: 2rem;
    }
    @media (max-width: 820px) { .hotspot-layout { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<div class="portal-container">
  <header class="brand-header">
    <div class="brand-logo-wrapper">
    <img src="data:image/png;base64,${logoBase64}" alt="Skylink Networks">
  </div>
    
  </header>

  <main>
    <div class="hotspot-layout">
      <div>
        <h1 class="heading-lg">${heading}</h1>
        <p class="subheading">${reason || subText}</p>
      </div>
      <div>
        <div class="voucher-toggle">
          <button id="showVoucherBtn">Have a voucher? Redeem here →</button>
        </div>
        <div class="plan-grid">
          ${packagesHtml}
        </div>
      </div>
    </div>
  </main>

  <footer class="brand-footer">
    <span>© 2026 Skylink Networks</span>
    <div>
      <a href="tel:${supportPhone}">Call Support</a>
      <a href="mailto:${supportEmail}">Email</a>
      <a href="https://wa.me/${supportPhone.replace(/\D/g, '')}" target="_blank">WhatsApp</a>
    </div>
  </footer>
</div>

<div id="paymentModal" style="display:none; position:fixed; inset:0; background:rgba(11,17,32,0.85); backdrop-filter:blur(8px); align-items:center; justify-content:center; z-index:999; padding:1rem;">
  <div style="max-width:440px; width:100%; background:var(--bg-deep); border:1px solid var(--border-glow); border-radius:var(--radius); padding:2rem; box-shadow:0 25px 50px -12px rgba(0,0,0,0.7);">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
      <h3 style="font-weight:600;" id="modalPackageName">Package</h3>
      <span style="font-size:1.4rem; font-weight:700; color:var(--skylink-blue);" id="modalPrice">KES 0</span>
    </div>
    <div class="form-group">
      <label class="form-label" for="modalPhone">M-Pesa Phone Number</label>
      <input type="tel" id="modalPhone" class="tech-input" placeholder="0712345678" required>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="modalPayBtn" onclick="initiatePayment()">Pay</button>
    </div>
    <div id="modalLoader" style="display:none; text-align:center; margin-top:1.5rem;">
      <div class="spinner"></div>
      <p style="color:var(--text-muted); font-size:0.85rem;">Processing…</p>
    </div>
    <div class="message-box success" id="modalSuccess"></div>
    <div class="message-box error" id="modalError"></div>
  </div>
</div>

<div id="voucherModal" style="display:none; position:fixed; inset:0; background:rgba(11,17,32,0.85); backdrop-filter:blur(8px); align-items:center; justify-content:center; z-index:999; padding:1rem;">
  <div style="max-width:440px; width:100%; background:var(--bg-deep); border:1px solid var(--border-glow); border-radius:var(--radius); padding:2rem; box-shadow:0 25px 50px -12px rgba(0,0,0,0.7);">
    <h3 style="font-weight:600; margin-bottom:1.5rem;">Redeem Voucher</h3>
    <div class="form-group">
      <label class="form-label" for="voucherCode">Voucher Code</label>
      <input type="text" id="voucherCode" class="tech-input" placeholder="Enter your code" required>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
      <button class="btn-secondary" onclick="closeVoucherModal()">Cancel</button>
      <button class="btn-primary" id="voucherRedeemBtn">Redeem</button>
    </div>
    <div id="voucherLoader" style="display:none; text-align:center; margin-top:1.5rem;">
      <div class="spinner"></div>
      <p style="color:var(--text-muted); font-size:0.85rem;">Checking voucher…</p>
    </div>
    <div class="message-box success" id="voucherSuccess"></div>
    <div class="message-box error" id="voucherError"></div>
  </div>
</div>

<script>
  let selected = { id: null, price: 0, name: '' };
  const macAddress = '${macAddress}';
  const nasIp = '${nasIp}';
  const siteId = '${site._id}';

  function selectPackage(id, price, name) {
    selected = { id, price, name };
    document.getElementById('modalPackageName').textContent = name;
    document.getElementById('modalPrice').textContent = 'KES ' + price.toLocaleString();
    document.getElementById('paymentModal').style.display = 'flex';
    resetModalMessages();
  }
  function closeModal() {
    document.getElementById('paymentModal').style.display = 'none';
    document.getElementById('modalPhone').value = '';
    resetModalMessages();
  }
  function resetModalMessages() {
    document.getElementById('modalSuccess').style.display = 'none';
    document.getElementById('modalError').style.display = 'none';
    document.getElementById('modalLoader').style.display = 'none';
    document.getElementById('modalPayBtn').disabled = false;
  }
  async function initiatePayment() {
    const phone = document.getElementById('modalPhone').value;
    if (!phone) { showModalError('Phone number is required'); return; }
    const payBtn = document.getElementById('modalPayBtn');
    const loader = document.getElementById('modalLoader');
    const successDiv = document.getElementById('modalSuccess');
    const errorDiv = document.getElementById('modalError');
    successDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    payBtn.disabled = true;
    loader.style.display = 'block';

    try {
      const res = await fetch('/payment/hotspot/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: selected.id, phoneNumber: phone, macAddress, siteId, nasIp })
      });
      const data = await res.json();
      loader.style.display = 'none';
      if (data.success) {
        successDiv.textContent = 'Payment request sent. Check your phone to complete.';
        successDiv.style.display = 'block';
        document.querySelectorAll('#paymentModal .form-group, #paymentModal .btn-secondary, #paymentModal .btn-primary').forEach(el => el.style.display = 'none');
        pollPaymentStatus(data.data.paymentId);
      } else {
        errorDiv.textContent = data.message || 'Payment failed';
        errorDiv.style.display = 'block';
        payBtn.disabled = false;
      }
    } catch (err) {
      loader.style.display = 'none';
      errorDiv.textContent = 'Network error. Please try again.';
      errorDiv.style.display = 'block';
      payBtn.disabled = false;
    }
  }
  function showModalError(msg) {
    const errorDiv = document.getElementById('modalError');
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
  }
  function pollPaymentStatus(paymentId) {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 60) { clearInterval(interval); return; }
      try {
        const res = await fetch('/payment/status/' + paymentId);
        const data = await res.json();
        if (data.success && data.data.status === 'completed') {
          clearInterval(interval);
          document.getElementById('modalSuccess').textContent = 'Payment confirmed. Connecting you…';
          document.getElementById('modalSuccess').style.display = 'block';
          setTimeout(() => window.location.href = 'https://skylinknetworks.co.ke', 2000);
        } else if (data.data.status === 'failed') {
          clearInterval(interval);
          document.getElementById('modalError').textContent = 'Payment failed. Please try again.';
          document.getElementById('modalError').style.display = 'block';
          document.getElementById('modalPayBtn').disabled = false;
        }
      } catch (err) {}
    }, 2000);
  }

  document.getElementById('showVoucherBtn').addEventListener('click', () => {
    document.getElementById('voucherModal').style.display = 'flex';
  });
  function closeVoucherModal() {
    document.getElementById('voucherModal').style.display = 'none';
    document.getElementById('voucherCode').value = '';
    document.getElementById('voucherSuccess').style.display = 'none';
    document.getElementById('voucherError').style.display = 'none';
    document.getElementById('voucherLoader').style.display = 'none';
    document.getElementById('voucherRedeemBtn').disabled = false;
  }
  document.getElementById('voucherRedeemBtn').addEventListener('click', async () => {
    const code = document.getElementById('voucherCode').value.trim();
    if (!code) {
      document.getElementById('voucherError').textContent = 'Please enter a code.';
      document.getElementById('voucherError').style.display = 'block';
      return;
    }
    const redeemBtn = document.getElementById('voucherRedeemBtn');
    const loader = document.getElementById('voucherLoader');
    const successDiv = document.getElementById('voucherSuccess');
    const errorDiv = document.getElementById('voucherError');
    successDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    redeemBtn.disabled = true;
    loader.style.display = 'block';

    try {
      const response = await fetch('/voucher/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, macAddress, nasIp })
      });
      const data = await response.json();
      loader.style.display = 'none';
      if (data.success) {
        successDiv.textContent = data.message || 'Voucher redeemed! Connecting…';
        successDiv.style.display = 'block';
        setTimeout(() => window.location.href = 'https://skylinknetworks.co.ke', 2000);
      } else {
        errorDiv.textContent = data.error || 'Invalid voucher.';
        errorDiv.style.display = 'block';
        redeemBtn.disabled = false;
      }
    } catch (err) {
      loader.style.display = 'none';
      errorDiv.textContent = 'Network error. Please try again.';
      errorDiv.style.display = 'block';
      redeemBtn.disabled = false;
    }
  });
</script>
</body>
</html>`;
}









app.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true, 
    message: 'Redirect server is running',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// SERVER STARTUP
// ============================================

const startServer = async () => {

  // ========== GLOBAL HANDLERS ==========
const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function logToFile(message, type = 'error') {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
  const logFile = path.join(logDir, `${type === 'error' ? 'errors' : 'uncaught'}.log`);
  fs.appendFileSync(logFile, logLine);
  console.error(logLine);
}

process.on('uncaughtException', (err) => {
  logToFile(`Uncaught Exception: ${err.stack || err.message}`, 'uncaught');
});

process.on('unhandledRejection', (err, promise) => {
  logToFile(`Unhandled Rejection: ${err.stack || err.message}`, 'uncaught');
  console.error('Unhandled Rejection (server will continue):', err);
});
// ========== END OF GLOBAL HANDLERS ==========


  await connectDB();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║   🚀 ISP REDIRECT SERVER RUNNING       ║`);
    console.log(`║   Port: ${PORT.toString().padEnd(30)}║`);
    console.log(`║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(24)}║`);
    console.log(`║   Time: ${new Date().toLocaleString().padEnd(27)}║`);
    console.log(`╚════════════════════════════════════════╝\n`);
    console.log('📍 Redirect endpoint: http://YOUR_IP:' + PORT + '/portal?ip=CLIENT_IP');
    console.log('💳 PPPoE payment: POST /payment/pppoe/initiate');
    console.log('🌐 Hotspot payment: POST /payment/hotspot/initiate');
    console.log('🔍 Payment status: GET /payment/status/:paymentId\n');
  });
};

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer().catch(err => {
  console.error('❌ Failed to start redirect server:', err);
  process.exit(1);
});