// scripts/testVoucherGeneration.js
// Run with: node scripts/testVoucherGeneration.js

require('dotenv').config(); // if you use dotenv
const mongoose = require('mongoose');
const { generateAndSendVouchers } = require('../services/voucherGenerationService');

// Hardcoded test parameters – CHANGE THESE TO VALID IDs FROM YOUR DB
const TEST_PARAMS = {
  // Either provide customerId (and we'll fetch phone from customer) OR provide phoneNumber directly
  customerId: '69fed9faac97e64ede7fbe84', // replace with a valid customer _id
  // phoneNumber: '+254712345678', // uncomment if using direct phone
  packageId: '6a30fe64f5ede21c291e893a', // replace with a valid package _id
  voucherAmount: 3, // number of vouchers to generate (1-50)
  createdBy: null, // can set to an admin user id if needed
  regionCode: 'NXT',
  rollbackOnSmsFailure: true, // set to false if you want to keep voucher even if SMS fails
};

async function runTest() {
  try {
    // 1. Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/yourdbname';
    console.log(`🔗 Connecting to MongoDB: ${mongoUri}`);
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // 2. Call the service
    console.log('🚀 Generating vouchers and sending SMS with parameters:', TEST_PARAMS);
    const result = await generateAndSendVouchers(TEST_PARAMS);

    // 3. Output the result
    console.log('\n✅ SUCCESS:');
    console.log('Voucher batch ID:', result.voucher._id);
    console.log('Voucher prefix:', result.voucher.prefix);
    console.log('Total codes generated:', result.voucher.codes.length);
    console.log('SMS sent to:', result.sms?.recipient || 'Not sent');
    console.log('SMS messageId:', result.sms?.messageId || 'N/A');
    if (result.warning) {
      console.warn('⚠️ Warning:', result.warning);
    }

    // 4. Disconnect
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR:');
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    // Ensure we disconnect even on error
    try {
      await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
  }
}

// Run the test
runTest();