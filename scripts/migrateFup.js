const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Package = require('../models/Package');
const radiusService = require('../services/radiusService');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const packages = await Package.find({});
  for (const pkg of packages) {
    // Enable FUP for this package (optional – change as needed)
    pkg.fup.enabled = true;
    await pkg.save();
    await radiusService.ensurePackageGroups(pkg);
    console.log(`Processed ${pkg.packageName}`);
  }
  console.log('Done');
  process.exit(0);
}
run();