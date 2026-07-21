// scripts/getVendorsFile.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '../data/mac-vendors.json');

// Try official IEEE CSV with proper headers
const CSV_URL = 'https://standards-oui.ieee.org/oui/oui.csv';
// Fallback to a community-maintained JSON mirror (faster, no parsing)
const JSON_FALLBACK_URL = 'https://raw.githubusercontent.com/RobThree/PHPMacAddressLookup/master/data/mac-vendors.json';

async function downloadFromCSV() {
    const response = await axios.get(CSV_URL, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
    });
    const lines = response.data.split('\n');
    const vendors = {};
    for (let line of lines) {
        if (line.startsWith('#') || line.trim() === '') continue;
        const parts = line.split(',');
        if (parts.length >= 3) {
            let oui = parts[1].trim().toUpperCase().replace(/-/g, ':');
            if (oui.length === 8 && oui[2] === ':' && oui[5] === ':') {
                // Already colon-separated
            } else {
                // Format as XX:XX:XX
                oui = oui.match(/.{1,2}/g).join(':');
            }
            let vendor = parts[2].trim().replace(/^"|"$/g, '');
            vendors[oui] = vendor;
        }
    }
    return vendors;
}

async function downloadFromJSON() {
    const response = await axios.get(JSON_FALLBACK_URL, { timeout: 10000 });
    return response.data; // already a JSON object { "00:00:00": "Vendor", ... }
}

async function main() {
    try {
        console.log('Downloading MAC vendor database...');
        let vendors;
        try {
            vendors = await downloadFromCSV();
            console.log(`✅ Using official IEEE CSV, found ${Object.keys(vendors).length} entries`);
        } catch (err) {
            console.warn('CSV download failed, falling back to JSON mirror...', err.message);
            vendors = await downloadFromJSON();
            console.log(`✅ Using community JSON, found ${Object.keys(vendors).length} entries`);
        }
        // Ensure directory exists
        const dir = path.dirname(OUTPUT_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(vendors, null, 2));
        console.log(`✅ Database saved to ${OUTPUT_PATH}`);
    } catch (error) {
        console.error('❌ Failed to download MAC vendor database:', error.message);
        process.exit(1);
    }
}

main();