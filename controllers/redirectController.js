const asyncHandler = require('../middleware/asyncHandler');
const radiusService = require('../services/radiusService');
const Customer = require('../models/Customer');
const Site = require('../models/Site');

/**
 * @desc    Serve redirect page for disabled IPs (expired or wrong password)
 * @route   GET /api/redirect/expired/:siteId
 * @access  Public (no auth, called by MikroTik proxy)
 */
exports.handleRedirect = asyncHandler(async (req, res) => {
    const { siteId } = req.params;
    // The original client IP is usually in req.headers['x-forwarded-for'] or req.ip
    // MikroTik proxy might not forward it, so we may need to extract from query param or use req.ip
    let clientIp = req.query.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Clean IPv6 loopback or multiple IPs
    if (clientIp && clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
    if (clientIp === '::1' || clientIp === '127.0.0.1') clientIp = null; // proxy internal

    let isWrongPassword = false;
    let username = null;

    if (clientIp) {
        const result = await radiusService.isWrongPasswordSession(clientIp);
        isWrongPassword = result.isWrongPassword;
        username = result.username;
    }

    // Fetch site details for display
    const site = await Site.findById(siteId);
    if (!site) {
        return res.status(404).send('Site not found');
    }

    // Fetch customer if username is known (for personalized page)
    let customer = null;
    if (username) {
        customer = await Customer.findOne({ 'pppoe.username': username });
    }

    const supportPhone = site.contactPhone || process.env.SUPPORT_PHONE || '0700-000-000';
    const supportEmail = site.contactEmail || process.env.SUPPORT_EMAIL || 'support@isp.com';

    if (isWrongPassword) {
        // Render wrong-password page
        res.status(200).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Router Configuration Error</title>
            <style>
                body { font-family: Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .container { background: white; padding: 40px; border-radius: 10px; max-width: 500px; text-align: center; }
                .icon { font-size: 60px; margin-bottom: 20px; }
                h1 { color: #e74c3c; }
                .message { margin: 30px 0; }
                .btn { background: #3498db; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; }
                .support-info { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
            </style>
            </head>
            <body>
            <div class="container">
                <div class="icon">🔒</div>
                <h1>Router Configuration Error</h1>
                <div class="message">
                    <p><strong>Your router is using an incorrect password.</strong></p>
                    <p>Account: <strong>${escapeHtml(username || 'Unknown')}</strong></p>
                    <p>Please contact support to fix your router settings.</p>
                </div>
                <a href="tel:${supportPhone}" class="btn">📞 Call Support</a>
                <div class="support-info">
                    <p>Support: ${supportPhone} | ${supportEmail}</p>
                </div>
            </div>
            </body>
            </html>
        `);
    } else {
        // Render expired / renewal page
        const renewUrl = `${process.env.FRONTEND_URL}/payment?site=${siteId}&account=${username || ''}`;
        res.status(200).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Subscription Expired</title>
            <style>
                body { font-family: Arial, sans-serif; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .container { background: white; padding: 40px; border-radius: 10px; max-width: 500px; text-align: center; }
                .icon { font-size: 60px; margin-bottom: 20px; }
                h1 { color: #e74c3c; }
                .message { margin: 30px 0; }
                .btn { background: #27ae60; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; }
            </style>
            </head>
            <body>
            <div class="container">
                <div class="icon">⏰</div>
                <h1>Subscription Expired</h1>
                <div class="message">
                    <p>Your internet subscription has expired.</p>
                    <p>Account: <strong>${escapeHtml(username || 'Unknown')}</strong></p>
                    <p>Please renew to restore internet access.</p>
                </div>
                <a href="${renewUrl}" class="btn">💳 Renew Now</a>
            </div>
            </body>
            </html>
        `);
    }
});

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}