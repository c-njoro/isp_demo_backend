const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

/**
 * Connect to in-memory database before all tests
 */
exports.setupTestDB = async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  console.log('Test database connected');
};

/**
 * Clear all test data after each test
 */
exports.clearTestDB = async () => {
  const collections = mongoose.connection.collections;

  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
};

/**
 * Close database connection and stop mongo server after all tests
 */
exports.closeTestDB = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
  console.log('Test database closed');
};

/**
 * Create mock customer data
 */
exports.mockCustomerData = {
  accountId: 'TEST001',
  regionCode: 'TST',
  siteId: new mongoose.Types.ObjectId(),
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@test.com',
  phoneNumber: '254712345678',
  location: {
    houseNumber: 'A1',
    street: 'Test Street',
    area: 'Test Area'
  },
  pppoe: {
    username: 'TEST001',
    password: 'testpass123',
    siteIp: '192.168.1.1'
  },
  cpe: {
    wifiName: 'TEST001',
    wifiPassword: 'wifipass123'
  },
  subscription: {
    packageId: new mongoose.Types.ObjectId(),
    status: 'active',
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  }
};

/**
 * Create mock user data
 */
exports.mockUserData = {
  username: 'testuser',
  email: 'testuser@test.com',
  firstName: 'Test',
  lastName: 'User',
  phoneNumber: '254723456789',
  department: 'sales',
  position: 'Sales Representative',
  roleId: new mongoose.Types.ObjectId(),
  allowedRegions: ['TST']
};

/**
 * Create mock admin data
 */
exports.mockAdminData = {
  username: 'testadmin',
  email: 'admin@test.com',
  firstName: 'Test',
  lastName: 'Admin',
  phoneNumber: '254734567890',
  role: 'super_admin',
  allowedRegions: []
};

/**
 * Create mock lead data
 */
exports.mockLeadData = {
  leadNumber: 'LEAD-TST-2024-0001',
  regionCode: 'TST',
  siteId: new mongoose.Types.ObjectId(),
  firstName: 'Jane',
  lastName: 'Smith',
  phoneNumber: '254745678901',
  email: 'jane@test.com',
  source: 'website',
  status: 'new',
  priority: 'medium',
  leadScore: 50
};

/**
 * Create mock ticket data
 */
exports.mockTicketData = {
  ticketNumber: 'TKT-TST-2024-0001',
  regionCode: 'TST',
  siteId: new mongoose.Types.ObjectId(),
  customerId: new mongoose.Types.ObjectId(),
  customerType: 'pppoe',
  customerName: 'John Doe',
  customerPhone: '254712345678',
  subject: 'Connection issue',
  description: 'Unable to connect to internet',
  category: 'technical',
  priority: 'high',
  status: 'open'
};

/**
 * Create mock package data
 */
exports.mockPackageData = {
  packageName: 'Test Package',
  packageType: 'ppp',
  regionCode: 'TST',
  siteId: new mongoose.Types.ObjectId(),
  speed: {
    download: 10,
    upload: 10
  },
  price: 2000,
  period: 30,
  periodUnit: 'd'
};

/**
 * Create mock site data
 */
exports.mockSiteData = {
  siteName: 'Test Site',
  regionCode: 'TST',
  location: {
    address: 'Test Address',
    county: 'Test County'
  },
  router: {
    ip: '192.168.1.1',
    username: 'admin',
    password: 'password123',
    apiType: 'api'
  }
};

/**
 * Create mock role data
 */
exports.mockRoleData = {
  roleName: 'Test Role',
  roleCode: 'TEST_ROLE',
  description: 'Test role for testing',
  permissions: {
    dashboard: { view: true },
    customers: { view: true, create: true }
  },
  allowedRegions: ['TST']
};