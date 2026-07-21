const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin'); // adjust path if needed
const dotenv = require('dotenv')
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;

async function createSuperAdmin() {
  try {
    await mongoose.connect(MONGO_URI);

    console.log('✅ Connected to MongoDB');

    const username = 'charles';
    const password = 'charles123';

    // Check if exists
    const existing = await Admin.findOne({ username });

    if (existing) {
      console.log('⚠️ Super admin already exists');
      process.exit(0);
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const admin = new Admin({
      username,
      email: 'mwanikic314@gmail.com',
      password: hashedPassword,
      firstName: 'System',
      lastName: 'Administrator',
      phoneNumber: '+254720128694',
      allowedRegions: ['*'],
      role: 'super_admin',
      isActive: true,
      mustChangePassword: true
    });

    await admin.save();

    console.log('🎉 Super admin created successfully');
    console.log('Username:', username);
    console.log('Password:', password);

    process.exit(0);

  } catch (err) {
    console.error('❌ Error creating super admin:', err);
    process.exit(1);
  }
}

createSuperAdmin();