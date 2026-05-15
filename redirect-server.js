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
require('dotenv').config();

const mysql = require('mysql2/promise');

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
const Package = require('./models/Package');
const Payment = require('./models/Payment');

// Import services
const kopokopoService = require('./services/kopokopoService');

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get client IP from request
 */
function getClientIp(req) {
  // Priority: query param > headers > socket
  let ip = req.query.ip || 
           req.query.portalip ||
           req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress ||
           req.socket.remoteAddress;
  
  if (ip && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  
  if (ip === '::1' || ip === '127.0.0.1') {
    ip = null;
  }
  
  console.log(`📍 Extracted IP: ${ip}`);
  return ip;
}

/**
 * Determine customer type and issue from IP address
 * Returns: { type: 'pppoe'|'hotspot', issue: 'expired'|'wrong_password'|'mac_mismatch'|'non_existent'|'unknown' }
 */
function analyzeIpAddress(ip) {
  if (!ip) return { type: 'unknown', issue: 'unknown' };
  
  const parts = ip.split('.');
  if (parts.length !== 4) return { type: 'unknown', issue: 'unknown' };
  
  const [oct1, oct2, oct3] = parts.map(Number);
  
  // PPPoE ranges
  if (oct1 === 10 && oct2 === 254 && oct3 === 254) {
    return { type: 'pppoe', issue: 'expired' };
  }
  if (oct1 === 20 && oct2 === 20) {
    return { type: 'pppoe', issue: 'wrong_password' };
  }
  if (oct1 === 30 && oct2 === 30) {
    return { type: 'pppoe', issue: 'non_existent' };
  }
  if (oct1 === 40 && oct2 === 40) {
    return { type: 'pppoe', issue: 'mac_mismatch' };
  }
  
  // Hotspot ranges
  if (oct1 === 10 && oct2 === 50 && oct3 === 10) {
    return { type: 'hotspot', issue: 'unpaid' }; // All hotspot users start as unpaid
}
  
  return { type: 'unknown', issue: 'unknown' };
}


/**
 * Query RADIUS database for active session by IP (MySQL)
 */
async function getRadiusSession(ip) {
  let connection;
  try {
    connection = await getRadiusConnection(); // get a MySQL connection from your pool
    
    const [rows] = await connection.query(
      `SELECT * FROM radacct 
       WHERE framedipaddress = ? AND acctstoptime IS NULL
       ORDER BY acctstarttime DESC
       LIMIT 1`,
      [ip]
    );
    
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

// ============================================
// MAIN REDIRECT HANDLER
// ============================================

/**
 * Main entry point: /portal
 * MikroTik redirects here with IP as query parameter
 */
app.get('/portal', async (req, res) => {
  try {
    console.log('\n🚪 === NEW REDIRECT REQUEST ===');
    console.log('Query params:', req.query);
    
    const clientIp = getClientIp(req);
    
    if (!clientIp) {
      return res.status(400).send(renderError('No IP address detected. Please try again.'));
    }
    
    const analysis = analyzeIpAddress(clientIp);
    console.log(`📊 IP Analysis: Type=${analysis.type}, Issue=${analysis.issue}`);
    
    // Get RADIUS session info
    const session = await getRadiusSession(clientIp);
    console.log(`🔍 RADIUS Session:`, session ? 'Found' : 'Not found');
    
    if (analysis.type === 'pppoe') {
      return await handlePppoeRedirect(req, res, clientIp, analysis, session);
    } else if (analysis.type === 'hotspot') {
      return await handleHotspotRedirect(req, res, clientIp, analysis, session);
    } else {
      return res.send(renderError('Unable to identify your connection type. Please contact support.'));
    }
    
  } catch (error) {
    console.error('❌ Redirect handler error:', error);
    return res.status(500).send(renderError('An error occurred. Please try again later.'));
  }
});

// ============================================
// PPPoE REDIRECT HANDLER
// ============================================

async function handlePppoeRedirect(req, res, clientIp, analysis, session) {
  console.log('🔵 Handling PPPoE redirect...');
  
  let username = session?.username;
  let customer = null;
  
  // Try to find customer by username
  if (username) {
    customer = await Customer.findOne({ 'pppoe.username': username })
      .populate('subscription.packageId')
      .populate('siteId');
    
    if (customer) {
      console.log(`✅ Found customer: ${customer.accountId}`);
    }
  }
  
  // Get auth log to understand the issue better
  let authLog = null;
  if (username) {
    authLog = await getRadiusAuthLog(username);
    console.log(`🔍 Auth log:`, authLog ? authLog.result : 'Not found');
  }
  
  // Determine the actual issue
  let issue = analysis.issue;
  if (authLog) {
    if (authLog.result === 'wrong_password') {
      issue = 'wrong_password';
    } else if (authLog.result === 'mac_mismatch') {
      issue = 'mac_mismatch';
    } else if (authLog.result === 'no_user') {
      issue = 'non_existent';
    }
  }
  
  const site = customer?.siteId;
  const supportPhone = site?.contactPerson?.phone || process.env.SUPPORT_PHONE || '+254700000000';
  const supportEmail = site?.contactPerson?.email || process.env.SUPPORT_EMAIL || 'support@skylinknetworks.co.ke';
  const siteName = site?.name || 'Skylink Networks';
  
  // Handle different issues
  switch (issue) {
    case 'expired':
      // Customer account expired - show payment option
      if (!customer) {
        return res.send(renderError('Account not found. Please contact support.'));
      }
      
      // Check if account is suspended vs expired
      if (customer.subscription.status === 'suspended') {
        return res.send(renderSuspended(customer, siteName, supportPhone, supportEmail));
      }
      
      // Account is expired - show payment form
      return res.send(renderExpiredPayment(customer, siteName, supportPhone, supportEmail));
    
    case 'wrong_password':
      // Wrong PPPoE password configured in router
      return res.send(renderWrongPassword(username, siteName, supportPhone, supportEmail));
    
    case 'mac_mismatch':
      // MAC address doesn't match registered device
      return res.send(renderMacMismatch(username, siteName, supportPhone, supportEmail));
    
    case 'non_existent':
      // Account doesn't exist
      return res.send(renderNonExistent(username, siteName, supportPhone, supportEmail));
    
    default:
      return res.send(renderError('Unable to determine account status. Please contact support.'));
  }
}

// ============================================
// HOTSPOT REDIRECT HANDLER
// ============================================

async function handleHotspotRedirect(req, res, clientIp, analysis, session) {
  console.log('🟢 Handling Hotspot redirect...');
  
  const macAddress = session?.callingstationid?.toUpperCase() || null;
  console.log(`📱 MAC Address: ${macAddress}`);
  
  let hotspotUser = null;
  let site = null;
  
  // Try to find existing hotspot user by MAC
  if (macAddress) {
    hotspotUser = await HotspotUser.findOne({ macAddress })
      .populate('activeSession.packageId')
      .populate('siteId');
    
    if (hotspotUser) {
      console.log(`✅ Found hotspot user: ${hotspotUser.macAddress}`);
      site = hotspotUser.siteId;
    }
  }
  
  // If no hotspot user found, try to determine site from session
  if (!site && session?.nasipaddress) {
    // Find site by NAS IP (assumes site has this info)
    const Router = mongoose.model('Router');
    const router = await Router.findOne({ ipAddress: session.nasipaddress }).populate('site');
    if (router) {
      site = router.site;
    }
  }
  
  // Fallback: use first active site
  if (!site) {
    site = await Site.findOne({ isActive: true });
  }
  
  const supportPhone = site?.contactPerson?.phone || process.env.SUPPORT_PHONE || '+254700000000';
  const supportEmail = site?.contactPerson?.email || process.env.SUPPORT_EMAIL || 'support@skylinknetworks.co.ke';
  const siteName = site?.name || 'Skylink Networks';
  
  // Get available hotspot packages
  const packages = await Package.find({
    siteId: site?._id,
    packageType: 'hotspot',
    isActive: true
  }).sort({ price: 1 });
  
  console.log(`📦 Found ${packages.length} hotspot packages`);
  
  // Always show package selection for hotspot users
  // They can be existing users who want to buy more, or new users
  return res.send(renderHotspotPackages(
    site,
    packages,
    hotspotUser,
    macAddress,
    clientIp,
    siteName,
    supportPhone,
    supportEmail
  ));
}

// ============================================
// PAYMENT INITIATION ENDPOINTS
// ============================================

/**
 * Initiate PPPoE payment (renewal)
 */
app.post('/payment/pppoe/initiate', async (req, res) => {
  try {
    console.log('\n💳 === PPPoE PAYMENT INITIATION ===');
    const { customerId, phoneNumber } = req.body;
    
    if (!customerId || !phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Customer ID and phone number are required' 
      });
    }
    
    const customer = await Customer.findById(customerId)
      .populate('subscription.packageId')
      .populate('siteId');
    
    if (!customer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Customer not found' 
      });
    }
    
    const packageDoc = customer.subscription.packageId;
    const site = customer.siteId;
    
    if (!packageDoc) {
      return res.status(400).json({ 
        success: false, 
        message: 'No package assigned to this account' 
      });
    }
    
    // Get site payment config
    const siteConfig = site?.payment?.kopokopo;
    if (!siteConfig || !siteConfig.clientId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment system not configured for this site' 
      });
    }
    
    // Detect payment channel
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const channel = kopokopoService.detectChannel(formattedPhone);
    
    console.log(`📞 Phone: ${formattedPhone}`);
    console.log(`💰 Amount: ${packageDoc.price}`);
    console.log(`📡 Channel: ${channel}`);
    
    // Create pending payment record
    const payment = await Payment.create({
      customerType: 'pppoe',
      customerId: customer._id,
      accountId: customer.accountId,
      packageId: packageDoc._id,
      amount: packageDoc.price,
      phoneNumber: formattedPhone,
      channel,
      status: 'pending',
      regionCode: customer.regionCode,
      siteId: site._id,
      metadata: {
        source: 'redirect_portal',
        ipAddress: req.ip
      }
    });
    
    console.log(`✅ Created payment record: ${payment._id}`);
    
    // Initiate Kopo Kopo STK push
    const callbackUrl = `${process.env.BASE_URL}/api/payments/kopokopo/webhook`;;
    console.log(callbackUrl)
    
    const stkResult = await kopokopoService.initiatePaymentRequest({
      phoneNumber: formattedPhone,
      amount: packageDoc.price,
      reference: payment._id.toString(),
      description: `Renewal: ${packageDoc.packageName} - ${customer.accountId}`,
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
        paymentId: payment._id.toString(),
        customerId: customer._id.toString(),
        accountId: customer.accountId,
        packageId: packageDoc._id.toString()
      }
    });
    
    if (!stkResult.success) {
      payment.status = 'failed';
      payment.errorMessage = stkResult.error || 'STK push failed';
      await payment.save();
      
      return res.status(400).json({
        success: false,
        message: stkResult.error || 'Failed to initiate payment'
      });
    }
    
    // Update payment with provider reference
    payment.providerReference = stkResult.paymentRequestId || stkResult.resourceId;
    payment.providerResponse = stkResult;
    payment.kopokopoPaymentId = stkResult.paymentRequestId;
payment.kopokopoLocation = stkResult.location;
payment.providerReference = stkResult.paymentRequestId;
payment.providerResponse = stkResult;
    await payment.save();
    
    console.log(`✅ STK push initiated: ${payment.providerReference}`);
    
    res.json({
      success: true,
      message: 'Payment request sent. Please check your phone.',
      data: {
        paymentId: payment._id,
        amount: packageDoc.price,
        phoneNumber: formattedPhone,
        reference: payment.providerReference
      }
    });
    
  } catch (error) {
    console.error('❌ PPPoE payment initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment initiation failed',
      error: error.message
    });
  }
});

/**
 * Initiate Hotspot payment (new or renewal)
 */
app.post('/payment/hotspot/initiate', async (req, res) => {
  try {
    console.log('\n💳 === HOTSPOT PAYMENT INITIATION ===');
    const { packageId, phoneNumber, macAddress, siteId } = req.body;
    
    if (!packageId || !phoneNumber || !siteId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Package ID, phone number, and site ID are required' 
      });
    }
    
    const packageDoc = await Package.findById(packageId);
    const site = await Site.findById(siteId);
    
    if (!packageDoc) {
      return res.status(404).json({ 
        success: false, 
        message: 'Package not found' 
      });
    }
    
    if (!site) {
      return res.status(404).json({ 
        success: false, 
        message: 'Site not found' 
      });
    }
    
    // Get site payment config
    const siteConfig = site?.payment?.kopokopo;
    if (!siteConfig || !siteConfig.clientId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment system not configured for this site' 
      });
    }
    
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const channel = kopokopoService.detectChannel(formattedPhone);
    
    // Check if hotspot user exists
    let hotspotUser = null;
    if (macAddress) {
      hotspotUser = await HotspotUser.findOne({ 
        macAddress: macAddress.toUpperCase() 
      });
    }
    
    // Create hotspot user if doesn't exist
    if (!hotspotUser && macAddress) {
      hotspotUser = await HotspotUser.create({
        macAddress: macAddress.toUpperCase(),
        phoneNumber: formattedPhone,
        regionCode: site.regionCode,
        siteId: site._id,
        activeSession: {
          isActive: false
        }
      });
      console.log(`✅ Created new hotspot user: ${hotspotUser.macAddress}`);
    }
    
// Create a unique stkID for hotspot payment
const uniqueStkId = `HS_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

// Create pending payment
const payment = await Payment.create({
  customerType: 'hotspot',
  customerId: hotspotUser?._id,
  accountId: hotspotUser?.macAddress || `HS_${macAddress || uniqueStkId}`,
  packageId: packageDoc._id,
  amount: packageDoc.price,
  status: 'pending',
  regionCode: site.regionCode,
  siteId: site._id,
  stkID: uniqueStkId,                       // ✅ unique required field
  checkoutRequestId: uniqueStkId,           // ✅ also unique, use same
  stkPush: {
    phoneNumber: formattedPhone,
    initiatedAt: new Date()
  },
  metadata: {
    source: 'redirect_portal',
    macAddress: macAddress?.toUpperCase(),
    ipAddress: req.ip,
    isNewUser: !hotspotUser
  }
});
    
    console.log(`✅ Created payment record: ${payment._id}`);
    
    // Initiate STK push
    const callbackUrl = `${process.env.BASE_URL}/api/payments/kopokopo/webhook`;
    console.log(callbackUrl)
    
    const stkResult = await kopokopoService.initiatePaymentRequest({
      phoneNumber: formattedPhone,
      amount: packageDoc.price,
      reference: payment._id.toString(),
      description: `Hotspot: ${packageDoc.packageName}`,
      callbackUrl,
      channel,
      credentials: {
        clientId: siteConfig.clientId,
        clientSecret: siteConfig.clientSecret,
        apiKey: siteConfig.apiKey,
        tillNumber: siteConfig.tillNumber,
        environment: siteConfig.environment || 'sandbox'
      },
      firstName: 'Guest',
      lastName: 'User',
      metadata: {
        paymentId: payment._id.toString(),
        hotspotUserId: hotspotUser?._id.toString(),
        packageId: packageDoc._id.toString(),
        macAddress: macAddress?.toUpperCase()
      }
    });
    
    if (!stkResult.success) {
      payment.status = 'failed';
      payment.errorMessage = stkResult.error || 'STK push failed';
      await payment.save();
      
      return res.status(400).json({
        success: false,
        message: stkResult.error || 'Failed to initiate payment'
      });
    }
    
    // Update payment with provider reference
    payment.providerReference = stkResult.paymentRequestId || stkResult.resourceId;
    payment.providerResponse = stkResult;
    payment.kopokopoPaymentId = stkResult.paymentRequestId;
payment.kopokopoLocation = stkResult.location;
payment.providerReference = stkResult.paymentRequestId;
payment.providerResponse = stkResult;
    await payment.save();
    
    console.log(`✅ STK push initiated: ${payment.providerReference}`);
    
    res.json({
      success: true,
      message: 'Payment request sent. Please check your phone.',
      data: {
        paymentId: payment._id,
        amount: packageDoc.price,
        phoneNumber: formattedPhone,
        reference: payment.providerReference,
        macAddress: macAddress?.toUpperCase()
      }
    });
    
  } catch (error) {
    console.error('❌ Hotspot payment initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment initiation failed',
      error: error.message
    });
  }
});

/**
 * Check payment status
 */
app.get('/payment/status/:paymentId', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId);
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        status: payment.status,
        amount: payment.amount,
        createdAt: payment.createdAt
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching payment status'
    });
  }
});

// ============================================
// RENDER FUNCTIONS
// ============================================

function renderExpiredPayment(customer, siteName, supportPhone, supportEmail) {
  const packageName = customer.subscription.packageId?.packageName || 'Your Package';
  const packagePrice = customer.subscription.packageId?.price || 0;
  const accountId = customer.accountId;
  const customerName = `${customer.firstName} ${customer.lastName}`;
  const expiryDate = customer.subscription.expiresAt ? 
    new Date(customer.subscription.expiresAt).toLocaleDateString() : 'N/A';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Subscription Expired - ${siteName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .icon {
      font-size: 80px;
      text-align: center;
      margin-bottom: 20px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }
    h1 {
      color: #e74c3c;
      text-align: center;
      margin-bottom: 10px;
      font-size: 28px;
    }
    .subtitle {
      text-align: center;
      color: #7f8c8d;
      margin-bottom: 30px;
      font-size: 16px;
    }
    .info-box {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin: 12px 0;
      padding: 10px 0;
      border-bottom: 1px solid #e9ecef;
    }
    .info-row:last-child {
      border-bottom: none;
    }
    .info-label {
      color: #6c757d;
      font-size: 14px;
      font-weight: 500;
    }
    .info-value {
      font-weight: 600;
      color: #2c3e50;
      font-size: 14px;
    }
    .price-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
      margin: 20px 0;
    }
    .price-label {
      font-size: 14px;
      opacity: 0.9;
      margin-bottom: 5px;
    }
    .price-amount {
      font-size: 36px;
      font-weight: bold;
    }
    .form-group {
      margin: 20px 0;
    }
    .form-group label {
      display: block;
      margin-bottom: 8px;
      color: #2c3e50;
      font-weight: 500;
      font-size: 14px;
    }
    .form-group input {
      width: 100%;
      padding: 14px;
      border: 2px solid #e9ecef;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.3s;
    }
    .form-group input:focus {
      outline: none;
      border-color: #667eea;
    }
    .btn {
      width: 100%;
      background: linear-gradient(135deg, #27ae60, #2ecc71);
      color: white;
      padding: 16px;
      border: none;
      border-radius: 8px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(46,204,113,0.4);
    }
    .btn:disabled {
      background: #95a5a6;
      cursor: not-allowed;
      transform: none;
    }
    .support-info {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #ecf0f1;
      text-align: center;
    }
    .support-info h3 {
      font-size: 16px;
      margin-bottom: 12px;
      color: #2c3e50;
    }
    .support-contact {
      display: flex;
      justify-content: center;
      gap: 20px;
      flex-wrap: wrap;
    }
    .contact-item {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
    }
    .contact-item:hover {
      text-decoration: underline;
    }
    .message {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      font-size: 14px;
      color: #856404;
    }
    .loading {
      display: none;
      text-align: center;
      margin-top: 15px;
      color: #667eea;
      font-size: 14px;
    }
    .spinner {
      border: 3px solid #f3f3f3;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      width: 30px;
      height: 30px;
      animation: spin 1s linear infinite;
      margin: 10px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .success-message {
      display: none;
      background: #d4edda;
      border-left: 4px solid #28a745;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      color: #155724;
    }
    .error-message {
      display: none;
      background: #f8d7da;
      border-left: 4px solid #dc3545;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      color: #721c24;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">⏰</div>
    <h1>Subscription Expired</h1>
    <div class="subtitle">${siteName}</div>
    
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Account</span>
        <span class="info-value">${accountId}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Name</span>
        <span class="info-value">${customerName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Package</span>
        <span class="info-value">${packageName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Expired On</span>
        <span class="info-value">${expiryDate}</span>
      </div>
    </div>
    
    <div class="message">
      <strong>⚠️ Your internet subscription has expired.</strong>
      <p style="margin-top: 8px;">Please renew now to restore your internet access.</p>
    </div>
    
    <div class="price-box">
      <div class="price-label">Amount to Pay</div>
      <div class="price-amount">KES ${packagePrice.toLocaleString()}</div>
    </div>
    
    <form id="paymentForm" onsubmit="initiatePayment(event)">
      <div class="form-group">
        <label for="phoneNumber">M-Pesa Phone Number</label>
        <input 
          type="tel" 
          id="phoneNumber" 
          name="phoneNumber" 
          placeholder="07XX XXX XXX or 254XXX XXX XXX" 
          required
          pattern="[0-9+]+"
        >
      </div>
      
      <button type="submit" class="btn" id="payBtn">
        💳 Pay Now via M-Pesa
      </button>
    </form>
    
    <div class="loading" id="loadingMessage">
      <div class="spinner"></div>
      <p>Sending payment request...</p>
      <p style="font-size: 12px; margin-top: 5px;">Please check your phone for M-Pesa prompt</p>
    </div>
    
    <div class="success-message" id="successMessage">
      ✅ Payment request sent! Please check your phone and enter your M-Pesa PIN.
    </div>
    
    <div class="error-message" id="errorMessage">
      ❌ <span id="errorText"></span>
    </div>
    
    <div class="support-info">
      <h3>Need Help?</h3>
      <div class="support-contact">
        <a href="tel:${supportPhone}" class="contact-item">📞 ${supportPhone}</a>
        <a href="mailto:${supportEmail}" class="contact-item">📧 ${supportEmail}</a>
      </div>
    </div>
  </div>
  
  <script>
    async function initiatePayment(event) {
      event.preventDefault();
      
      const form = document.getElementById('paymentForm');
      const phoneNumber = document.getElementById('phoneNumber').value;
      const payBtn = document.getElementById('payBtn');
      const loadingMessage = document.getElementById('loadingMessage');
      const successMessage = document.getElementById('successMessage');
      const errorMessage = document.getElementById('errorMessage');
      const errorText = document.getElementById('errorText');
      
      // Reset messages
      successMessage.style.display = 'none';
      errorMessage.style.display = 'none';
      
      // Show loading
      payBtn.disabled = true;
      loadingMessage.style.display = 'block';
      
      try {
        const response = await fetch('/payment/pppoe/initiate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            customerId: '${customer._id}',
            phoneNumber: phoneNumber
          })
        });
        
        const data = await response.json();
        
        loadingMessage.style.display = 'none';
        
        if (data.success) {
          successMessage.style.display = 'block';
          form.style.display = 'none';
          
          // Poll payment status
          pollPaymentStatus(data.data.paymentId);
        } else {
          errorText.textContent = data.message || 'Payment initiation failed';
          errorMessage.style.display = 'block';
          payBtn.disabled = false;
        }
      } catch (error) {
        loadingMessage.style.display = 'none';
        errorText.textContent = 'Network error. Please try again.';
        errorMessage.style.display = 'block';
        payBtn.disabled = false;
      }
    }
    
    function pollPaymentStatus(paymentId) {
      let attempts = 0;
      const maxAttempts = 60; // Poll for 2 minutes (60 * 2 seconds)
      
      const interval = setInterval(async () => {
        attempts++;
        
        if (attempts > maxAttempts) {
          clearInterval(interval);
          document.getElementById('successMessage').innerHTML = 
            '⏳ Payment is taking longer than expected. Your internet will be activated once payment is confirmed.';
          return;
        }
        
        try {
          const response = await fetch('/payment/status/' + paymentId);
          const data = await response.json();
          
          if (data.success && data.data.status === 'completed') {
            clearInterval(interval);
            document.getElementById('successMessage').innerHTML = 
              '✅ Payment successful! Your internet will be activated shortly. You may close this page.';
          } else if (data.data.status === 'failed') {
            clearInterval(interval);
            document.getElementById('successMessage').style.display = 'none';
            document.getElementById('errorText').textContent = 'Payment failed. Please try again.';
            document.getElementById('errorMessage').style.display = 'block';
            document.getElementById('payBtn').disabled = false;
            document.getElementById('paymentForm').style.display = 'block';
          }
        } catch (error) {
          // Continue polling
        }
      }, 2000);
    }
  </script>
</body>
</html>`;
}

function renderSuspended(customer, siteName, supportPhone, supportEmail) {
  const accountId = customer.accountId;
  const customerName = `${customer.firstName} ${customer.lastName}`;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Suspended - ${siteName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #f5af19 0%, #f12711 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    .icon {
      font-size: 80px;
      margin-bottom: 20px;
    }
    h1 {
      color: #c0392b;
      margin-bottom: 20px;
      font-size: 28px;
    }
    .info-box {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      text-align: left;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin: 12px 0;
      padding: 10px 0;
      border-bottom: 1px solid #e9ecef;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #6c757d; font-size: 14px; font-weight: 500; }
    .info-value { font-weight: 600; color: #2c3e50; font-size: 14px; }
    .alert {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      text-align: left;
    }
    .alert strong { color: #856404; display: block; margin-bottom: 8px; }
    .alert p { color: #856404; margin: 8px 0; font-size: 14px; }
    .btn {
      display: inline-block;
      background: #c0392b;
      color: white;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 8px;
      margin: 10px;
      font-weight: 600;
      transition: transform 0.2s;
    }
    .btn:hover { transform: translateY(-2px); }
    .support-info {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #ecf0f1;
    }
    .support-info h3 { font-size: 16px; margin-bottom: 12px; color: #2c3e50; }
    .contact-item {
      color: #c0392b;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
      margin: 0 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🚫</div>
    <h1>Account Suspended</h1>
    
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Account</span>
        <span class="info-value">${accountId}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Name</span>
        <span class="info-value">${customerName}</span>
      </div>
    </div>
    
    <div class="alert">
      <strong>⚠️ Your account has been temporarily suspended</strong>
      <p>This suspension was initiated by the company. Your internet service has been paused.</p>
      <p>If you believe this is an error or would like more information, please contact our support team.</p>
    </div>
    
    <div style="margin: 20px 0;">
      <a href="tel:${supportPhone}" class="btn">📞 Call Support</a>
      <a href="mailto:${supportEmail}" class="btn">📧 Email Support</a>
    </div>
    
    <div class="support-info">
      <h3>Contact Information</h3>
      <p>
        <a href="tel:${supportPhone}" class="contact-item">📞 ${supportPhone}</a>
        <a href="mailto:${supportEmail}" class="contact-item">📧 ${supportEmail}</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function renderWrongPassword(username, siteName, supportPhone, supportEmail) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuration Error - ${siteName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    .icon { font-size: 80px; margin-bottom: 20px; }
    h1 { color: #e74c3c; margin-bottom: 20px; font-size: 28px; }
    .alert {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      text-align: left;
    }
    .alert strong { color: #856404; display: block; margin-bottom: 12px; font-size: 16px; }
    .alert p { color: #856404; margin: 8px 0; font-size: 14px; line-height: 1.6; }
    .username {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      font-family: monospace;
      font-size: 18px;
      font-weight: bold;
      color: #2c3e50;
    }
    .btn {
      display: inline-block;
      background: #e74c3c;
      color: white;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 8px;
      margin: 10px;
      font-weight: 600;
      transition: transform 0.2s;
    }
    .btn:hover { transform: translateY(-2px); }
    .steps {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      text-align: left;
    }
    .steps h3 { color: #2c3e50; margin-bottom: 15px; font-size: 16px; }
    .steps ol { margin-left: 20px; }
    .steps li { margin: 10px 0; color: #495057; font-size: 14px; line-height: 1.6; }
    .support-info {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #ecf0f1;
    }
    .support-info h3 { font-size: 16px; margin-bottom: 12px; color: #2c3e50; }
    .contact-item {
      color: #e74c3c;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
      margin: 0 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🔒</div>
    <h1>Router Configuration Error</h1>
    
    <div class="alert">
      <strong>⚠️ Incorrect Password Configured</strong>
      <p>Your router is trying to connect with the wrong password for your account.</p>
    </div>
    
    <div class="username">
      Username: ${username || 'Unknown'}
    </div>
    
    <div class="steps">
      <h3>To Fix This Issue:</h3>
      <ol>
        <li>Contact our support team</li>
        <li>Verify your correct PPPoE password</li>
        <li>Update your router's configuration with the correct password</li>
        <li>Reconnect to the internet</li>
      </ol>
    </div>
    
    <div style="margin: 20px 0;">
      <a href="tel:${supportPhone}" class="btn">📞 Call Support Now</a>
    </div>
    
    <div class="support-info">
      <h3>Contact Our Support Team</h3>
      <p>
        <a href="tel:${supportPhone}" class="contact-item">📞 ${supportPhone}</a>
        <a href="mailto:${supportEmail}" class="contact-item">📧 ${supportEmail}</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function renderMacMismatch(username, siteName, supportPhone, supportEmail) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Device Not Authorized - ${siteName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    .icon { font-size: 80px; margin-bottom: 20px; }
    h1 { color: #c0392b; margin-bottom: 20px; font-size: 28px; }
    .alert {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      text-align: left;
    }
    .alert strong { color: #856404; display: block; margin-bottom: 12px; font-size: 16px; }
    .alert p { color: #856404; margin: 8px 0; font-size: 14px; line-height: 1.6; }
    .username {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      font-family: monospace;
      font-size: 18px;
      font-weight: bold;
      color: #2c3e50;
    }
    .btn {
      display: inline-block;
      background: #c0392b;
      color: white;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 8px;
      margin: 10px;
      font-weight: 600;
      transition: transform 0.2s;
    }
    .btn:hover { transform: translateY(-2px); }
    .info-box {
      background: #e8f4f8;
      border-left: 4px solid #3498db;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      text-align: left;
    }
    .info-box h3 { color: #2c3e50; margin-bottom: 10px; font-size: 16px; }
    .info-box p { color: #34495e; font-size: 14px; line-height: 1.6; margin: 8px 0; }
    .support-info {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #ecf0f1;
    }
    .support-info h3 { font-size: 16px; margin-bottom: 12px; color: #2c3e50; }
    .contact-item {
      color: #c0392b;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
      margin: 0 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🚫</div>
    <h1>Device Not Authorized</h1>
    
    <div class="alert">
      <strong>⚠️ MAC Address Mismatch</strong>
      <p>The device you're using is not registered for this account.</p>
    </div>
    
    <div class="username">
      Account: ${username || 'Unknown'}
    </div>
    
    <div class="info-box">
      <h3>What does this mean?</h3>
      <p>Your account is configured to only work with specific devices (identified by their MAC address).</p>
      <p>The device you're currently using is not registered for this account.</p>
    </div>
    
    <div class="info-box">
      <h3>How to fix this:</h3>
      <p>Contact our support team to update your registered device or add this new device to your account.</p>
    </div>
    
    <div style="margin: 20px 0;">
      <a href="tel:${supportPhone}" class="btn">📞 Contact Support</a>
    </div>
    
    <div class="support-info">
      <h3>Get Help</h3>
      <p>
        <a href="tel:${supportPhone}" class="contact-item">📞 ${supportPhone}</a>
        <a href="mailto:${supportEmail}" class="contact-item">📧 ${supportEmail}</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function renderNonExistent(username, siteName, supportPhone, supportEmail) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Not Found - ${siteName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    .icon { font-size: 80px; margin-bottom: 20px; }
    h1 { color: #e74c3c; margin-bottom: 20px; font-size: 28px; }
    .alert {
      background: #f8d7da;
      border-left: 4px solid #dc3545;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      text-align: left;
    }
    .alert strong { color: #721c24; display: block; margin-bottom: 12px; font-size: 16px; }
    .alert p { color: #721c24; margin: 8px 0; font-size: 14px; line-height: 1.6; }
    .username {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      font-family: monospace;
      font-size: 18px;
      font-weight: bold;
      color: #2c3e50;
    }
    .btn {
      display: inline-block;
      background: #e74c3c;
      color: white;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 8px;
      margin: 10px;
      font-weight: 600;
      transition: transform 0.2s;
    }
    .btn:hover { transform: translateY(-2px); }
    .support-info {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #ecf0f1;
    }
    .support-info h3 { font-size: 16px; margin-bottom: 12px; color: #2c3e50; }
    .contact-item {
      color: #e74c3c;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
      margin: 0 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">❓</div>
    <h1>Account Not Found</h1>
    
    <div class="alert">
      <strong>❌ This account does not exist in our system</strong>
      <p>The username you're trying to connect with is not registered.</p>
    </div>
    
    ${username ? `<div class="username">Username: ${username}</div>` : ''}
    
    <div style="margin: 20px 0;">
      <p style="color: #495057; font-size: 14px; margin-bottom: 15px;">
        This could mean:
      </p>
      <ul style="text-align: left; color: #495057; font-size: 14px; line-height: 1.8; margin-left: 40px;">
        <li>The username is incorrect</li>
        <li>Your account hasn't been created yet</li>
        <li>Your account may have been deleted</li>
      </ul>
    </div>
    
    <div style="margin: 30px 0;">
      <a href="tel:${supportPhone}" class="btn">📞 Contact Support</a>
    </div>
    
    <div class="support-info">
      <h3>Need Help?</h3>
      <p>
        <a href="tel:${supportPhone}" class="contact-item">📞 ${supportPhone}</a>
        <a href="mailto:${supportEmail}" class="contact-item">📧 ${supportEmail}</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function renderHotspotPackages(site, packages, hotspotUser, macAddress, clientIp, siteName, supportPhone, supportEmail) {
  const isExistingUser = !!hotspotUser;
  const greeting = isExistingUser ? 
    `Welcome back! Select a package to continue browsing.` : 
    `Welcome to ${siteName}! Choose a package to get started.`;
  
  const packagesHtml = packages.map(pkg => {
    const duration = pkg.periodUnit === 'h' ? `${pkg.period} Hours` : 
                     pkg.periodUnit === 'd' ? `${pkg.period} Days` : 
                     `${Math.round(pkg.period / 60)} Hours`;
    const dataLimit = pkg.dataLimit > 0 ? 
      `${(pkg.dataLimit / 1024).toFixed(0)} GB` : 
      'Unlimited';
    
    return `
      <div class="package-card" onclick="selectPackage('${pkg._id}', ${pkg.price}, '${pkg.packageName}')">
        <div class="package-header">
          <h3>${pkg.packageName}</h3>
        </div>
        <div class="package-price">
          <span class="currency">KES</span>
          <span class="amount">${pkg.price.toLocaleString()}</span>
        </div>
        <div class="package-details">
          <div class="detail-item">
            <span class="icon">⚡</span>
            <span class="text">${pkg.speed.download}/${pkg.speed.upload} Mbps</span>
          </div>
          <div class="detail-item">
            <span class="icon">⏱️</span>
            <span class="text">${duration}</span>
          </div>
          <div class="detail-item">
            <span class="icon">📊</span>
            <span class="text">${dataLimit}</span>
          </div>
        </div>
        <button class="select-btn">Select Package</button>
      </div>
    `;
  }).join('');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Choose Your Plan - ${siteName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .header {
      text-align: center;
      color: white;
      margin-bottom: 30px;
      padding: 20px;
    }
    .header h1 {
      font-size: 32px;
      margin-bottom: 10px;
    }
    .header p {
      font-size: 16px;
      opacity: 0.95;
    }
    .packages-container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .packages-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 24px;
      margin-bottom: 30px;
    }
    .package-card {
      background: white;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      transition: transform 0.3s, box-shadow 0.3s;
      cursor: pointer;
    }
    .package-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 15px 40px rgba(0,0,0,0.3);
    }
    .package-header h3 {
      font-size: 24px;
      color: #2c3e50;
      margin-bottom: 15px;
    }
    .package-price {
      text-align: center;
      margin: 20px 0;
    }
    .package-price .currency {
      font-size: 18px;
      color: #7f8c8d;
      vertical-align: top;
    }
    .package-price .amount {
      font-size: 48px;
      font-weight: bold;
      color: #27ae60;
    }
    .package-details {
      margin: 20px 0;
    }
    .detail-item {
      display: flex;
      align-items: center;
      margin: 12px 0;
      color: #2c3e50;
    }
    .detail-item .icon {
      font-size: 20px;
      margin-right: 12px;
    }
    .detail-item .text {
      font-size: 15px;
    }
    .select-btn {
      width: 100%;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      border: none;
      padding: 14px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .select-btn:hover {
      transform: scale(1.02);
    }
    .payment-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.7);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .payment-modal.show {
      display: flex;
    }
    .modal-content {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
    }
    .modal-header {
      text-align: center;
      margin-bottom: 20px;
    }
    .modal-header h2 {
      color: #2c3e50;
      font-size: 24px;
      margin-bottom: 10px;
    }
    .selected-package {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      text-align: center;
    }
    .selected-package h3 {
      color: #667eea;
      margin-bottom: 10px;
    }
    .selected-package .price {
      font-size: 36px;
      font-weight: bold;
      color: #27ae60;
    }
    .form-group {
      margin: 20px 0;
    }
    .form-group label {
      display: block;
      margin-bottom: 8px;
      color: #2c3e50;
      font-weight: 500;
      font-size: 14px;
    }
    .form-group input {
      width: 100%;
      padding: 14px;
      border: 2px solid #e9ecef;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.3s;
    }
    .form-group input:focus {
      outline: none;
      border-color: #667eea;
    }
    .btn-primary {
      width: 100%;
      background: linear-gradient(135deg, #27ae60, #2ecc71);
      color: white;
      padding: 16px;
      border: none;
      border-radius: 8px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .btn-primary:hover {
      transform: translateY(-2px);
    }
    .btn-primary:disabled {
      background: #95a5a6;
      cursor: not-allowed;
      transform: none;
    }
    .btn-secondary {
      width: 100%;
      background: white;
      color: #667eea;
      padding: 12px;
      border: 2px solid #667eea;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 10px;
    }
    .loading {
      display: none;
      text-align: center;
      margin-top: 15px;
      color: #667eea;
      font-size: 14px;
    }
    .spinner {
      border: 3px solid #f3f3f3;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      width: 30px;
      height: 30px;
      animation: spin 1s linear infinite;
      margin: 10px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .message {
      padding: 15px;
      border-radius: 8px;
      margin: 15px 0;
      display: none;
    }
    .message.success {
      background: #d4edda;
      border-left: 4px solid #28a745;
      color: #155724;
    }
    .message.error {
      background: #f8d7da;
      border-left: 4px solid #dc3545;
      color: #721c24;
    }
    .support {
      text-align: center;
      color: white;
      margin-top: 30px;
      padding: 20px;
    }
    .support a {
      color: white;
      text-decoration: none;
      font-weight: 500;
      margin: 0 10px;
    }
    .support a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${siteName}</h1>
    <p>${greeting}</p>
  </div>
  
  <div class="packages-container">
    <div class="packages-grid">
      ${packagesHtml || '<p style="color: white; text-align: center;">No packages available at the moment.</p>'}
    </div>
  </div>
  
  <div class="payment-modal" id="paymentModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Complete Your Purchase</h2>
      </div>
      
      <div class="selected-package">
        <h3 id="selectedPackageName">Package Name</h3>
        <div class="price">
          <span style="font-size: 18px; color: #7f8c8d;">KES</span>
          <span id="selectedPackagePrice">0</span>
        </div>
      </div>
      
      <form id="paymentForm" onsubmit="initiatePayment(event)">
        <div class="form-group">
          <label for="phoneNumber">M-Pesa Phone Number</label>
          <input 
            type="tel" 
            id="phoneNumber" 
            name="phoneNumber" 
            placeholder="07XX XXX XXX or 254XXX XXX XXX" 
            required
            pattern="[0-9+]+"
          >
        </div>
        
        <button type="submit" class="btn-primary" id="payBtn">
          💳 Pay Now via M-Pesa
        </button>
        
        <button type="button" class="btn-secondary" onclick="closeModal()">
          Cancel
        </button>
      </form>
      
      <div class="loading" id="loadingMessage">
        <div class="spinner"></div>
        <p>Sending payment request...</p>
        <p style="font-size: 12px; margin-top: 5px;">Please check your phone for M-Pesa prompt</p>
      </div>
      
      <div class="message success" id="successMessage"></div>
      <div class="message error" id="errorMessage"></div>
    </div>
  </div>
  
  <div class="support">
    <p>Need help? Contact us:</p>
    <p>
      <a href="tel:${supportPhone}">📞 ${supportPhone}</a>
      <a href="mailto:${supportEmail}">📧 ${supportEmail}</a>
    </p>
  </div>
  
  <script>
    let selectedPackageId = null;
    
    function selectPackage(packageId, price, name) {
      selectedPackageId = packageId;
      document.getElementById('selectedPackageName').textContent = name;
      document.getElementById('selectedPackagePrice').textContent = price.toLocaleString();
      document.getElementById('paymentModal').classList.add('show');
    }
    
    function closeModal() {
      document.getElementById('paymentModal').classList.remove('show');
      resetForm();
    }
    
    function resetForm() {
      document.getElementById('paymentForm').reset();
      document.getElementById('loadingMessage').style.display = 'none';
      document.getElementById('successMessage').style.display = 'none';
      document.getElementById('errorMessage').style.display = 'none';
      document.getElementById('payBtn').disabled = false;
    }
    
    async function initiatePayment(event) {
      event.preventDefault();
      
      const phoneNumber = document.getElementById('phoneNumber').value;
      const payBtn = document.getElementById('payBtn');
      const loadingMessage = document.getElementById('loadingMessage');
      const successMessage = document.getElementById('successMessage');
      const errorMessage = document.getElementById('errorMessage');
      
      // Reset messages
      successMessage.style.display = 'none';
      errorMessage.style.display = 'none';
      
      // Show loading
      payBtn.disabled = true;
      loadingMessage.style.display = 'block';
      
      try {
        const response = await fetch('/payment/hotspot/initiate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            packageId: selectedPackageId,
            phoneNumber: phoneNumber,
            macAddress: '${macAddress || ''}',
            siteId: '${site?._id || ''}'
          })
        });
        
        const data = await response.json();
        
        loadingMessage.style.display = 'none';
        
        if (data.success) {
          successMessage.textContent = '✅ Payment request sent! Check your phone and enter your M-Pesa PIN. Your internet will be activated once payment is confirmed.';
          successMessage.style.display = 'block';
          document.getElementById('paymentForm').style.display = 'none';
          
          // Poll payment status
          pollPaymentStatus(data.data.paymentId);
        } else {
          errorMessage.textContent = '❌ ' + (data.message || 'Payment initiation failed');
          errorMessage.style.display = 'block';
          payBtn.disabled = false;
        }
      } catch (error) {
        loadingMessage.style.display = 'none';
        errorMessage.textContent = '❌ Network error. Please try again.';
        errorMessage.style.display = 'block';
        payBtn.disabled = false;
      }
    }
    
    function pollPaymentStatus(paymentId) {
      let attempts = 0;
      const maxAttempts = 60;
      
      const interval = setInterval(async () => {
        attempts++;
        
        if (attempts > maxAttempts) {
          clearInterval(interval);
          document.getElementById('successMessage').textContent = 
            '⏳ Payment is taking longer than expected. Your internet will be activated once payment is confirmed. You may close this page.';
          return;
        }
        
        try {
          const response = await fetch('/payment/status/' + paymentId);
          const data = await response.json();
          
          if (data.success && data.data.status === 'completed') {
            clearInterval(interval);
            document.getElementById('successMessage').textContent = 
              '✅ Payment successful! Your internet is now active. You may close this page and start browsing.';
            
            // Close modal after 3 seconds
            setTimeout(() => {
              closeModal();
              // Try to redirect or refresh
              window.location.href = 'http://google.com';
            }, 3000);
          } else if (data.data.status === 'failed') {
            clearInterval(interval);
            document.getElementById('successMessage').style.display = 'none';
            document.getElementById('errorMessage').textContent = '❌ Payment failed. Please try again.';
            document.getElementById('errorMessage').style.display = 'block';
            document.getElementById('payBtn').disabled = false;
            document.getElementById('paymentForm').style.display = 'block';
          }
        } catch (error) {
          // Continue polling
        }
      }, 2000);
    }
  </script>
</body>
</html>`;
}

function renderError(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #c0392b 0%, #8e44ad 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    .icon { font-size: 80px; margin-bottom: 20px; }
    h1 { color: #c0392b; margin-bottom: 20px; font-size: 28px; }
    p { color: #2c3e50; font-size: 16px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">⚠️</div>
    <h1>Oops!</h1>
    <p>${message}</p>
  </div>
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