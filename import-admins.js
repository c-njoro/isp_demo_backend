const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const Admin = require('./models/Admin'); // Adjust the path to your Admin model
const fs = require('fs');

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;
const JSON_FILE = './admins.json'; // path to the JSON file

async function importAdmins() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Read and parse JSON
    const adminsData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));

    let created = 0;
    let skipped = 0;

    for (const adminData of adminsData) {
      const { username, email, password, ...rest } = adminData;

      // Check if admin already exists (by username)
      const existing = await Admin.findOne({ username });
      if (existing) {
        console.log(`⚠️ Admin ${username} already exists – skipping`);
        skipped++;
        continue;
      }

      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Prepare the document (handle optional email)
      const doc = {
        username,
        password: hashedPassword,
        ...rest,
      };
      if (email) doc.email = email;

      const admin = new Admin(doc);
      await admin.save();
      console.log(`✅ Created admin: ${username}`);
      created++;
    }

    console.log(`\n🎉 Import completed: ${created} created, ${skipped} skipped.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error importing admins:', err);
    process.exit(1);
  }
}

importAdmins();