// templatesInit.js
require('dotenv').config();
const mongoose = require('mongoose');

// Define the SmsTemplate schema inline (or import if you prefer, but this keeps it self-contained)
const smsTemplateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  subject: { type: String, default: '' },
  body: { type: String, required: true },
  placeholders: { type: [String], default: ['customerName'] },
  isActive: { type: Boolean, default: true },
  description: { type: String },
}, { timestamps: true });

const SmsTemplate = mongoose.model('SmsTemplate', smsTemplateSchema);

// Default templates data
const defaultTemplates = [
  {
    key: 'welcome',
    name: 'Welcome Message',
    subject: 'Welcome to Skylink Networks',
    body: 'Dear {customerName}, welcome to Skylink Networks Limited! Your account {accountId} is active. Thank you for choosing us.',
    placeholders: ['customerName', 'accountId'],
    description: 'Sent when a new customer is created.'
  },
  {
    key: 'payment_wallet',
    name: 'Wallet Top-Up',
    subject: 'Wallet Credit',
    body: 'Dear {customerName}, your payment of KES {amount} has been added to your wallet. New balance: KES {newBalance}. Thank you!',
    placeholders: ['customerName', 'amount', 'newBalance'],
    description: 'Sent after a successful payment that goes to wallet (active customer).'
  },
  {
    key: 'payment_renewal',
    name: 'Subscription Renewal',
    subject: 'Subscription Renewed',
    body: 'Dear {customerName}, your payment of KES {amount} has renewed your subscription until {expiryDate}. Thank you!',
    placeholders: ['customerName', 'amount', 'expiryDate'],
    description: 'Sent when an expired customer pays enough to renew.'
  },
  {
    key: 'expiry_warning',
    name: 'Expiry Warning',
    subject: 'Subscription Expiring Soon',
    body: 'Dear {customerName}, your internet subscription will expire on {expiryDate}. Please renew to continue enjoying our services.',
    placeholders: ['customerName', 'expiryDate'],
    description: 'Sent a few days before expiry (automated).'
  },
  {
    key: 'expiry_notice',
    name: 'Expiry Notice',
    subject: 'Subscription Expired',
    body: 'Dear {customerName}, your internet subscription has expired. Please make a payment to restore service.',
    placeholders: ['customerName'],
    description: 'Sent on the day of expiry (automated).'
  },
  {
    key: 'bulk_general',
    name: 'Bulk General',
    subject: '',
    body: 'Dear {customerName}, {message}',
    placeholders: ['customerName', 'message'],
    description: 'Template for general bulk messages (admin can override message).'
  }
];

async function initTemplates() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not defined in .env');
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    let inserted = 0;
    let skipped = 0;

    for (const template of defaultTemplates) {
      const exists = await SmsTemplate.findOne({ key: template.key });
      if (!exists) {
        await SmsTemplate.create(template);
        console.log(`➕ Inserted template: ${template.key}`);
        inserted++;
      } else {
        console.log(`⏭️ Skipped (already exists): ${template.key}`);
        skipped++;
      }
    }

    console.log(`\n🎉 Done. Inserted: ${inserted}, Skipped: ${skipped}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing templates:', error.message);
    process.exit(1);
  }
}

initTemplates();