const request = require('supertest');
const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const app = require('../../server');
const Admin = require('../../models/Admin');
const User = require('../../models/User');
const Role = require('../../models/Role');
const bcrypt = require('bcryptjs');
const { setupTestDB, clearTestDB, closeTestDB } = require('../setup');

describe('Authentication API', () => {
  let agent;

  beforeAll(async () => {
    await setupTestDB();
    agent = request.agent(app); // Maintains cookies across requests
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe('POST /api/auth/login', () => {
    it('should login admin successfully', async () => {
      // Create test admin
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);

      await Admin.create({
        username: 'testadmin',
        email: 'admin@test.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        phoneNumber: '254712345678',
        role: 'super_admin',
        allowedRegions: []
      });

      const res = await agent
        .post('/api/auth/login')
        .send({
          username: 'testadmin',
          password: 'password123'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('username', 'testadmin');
      expect(res.body.data).toHaveProperty('isAdmin', true);
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should login regular user successfully', async () => {
      // Create test role
      const role = await Role.create({
        roleName: 'Test Role',
        roleCode: 'TEST_ROLE',
        description: 'Test role',
        permissions: {
          dashboard: { view: true }
        },
        allowedRegions: ['TST']
      });

      // Create test user
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);

      await User.create({
        username: 'testuser',
        email: 'user@test.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        phoneNumber: '254723456789',
        roleId: role._id,
        department: 'sales',
        position: 'Sales Rep',
        allowedRegions: ['TST']
      });

      const res = await agent
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'password123',
          regionCode: 'TST'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('username', 'testuser');
      expect(res.body.data).toHaveProperty('isAdmin', false);
    });

    it('should reject invalid credentials', async () => {
      const res = await agent
        .post('/api/auth/login')
        .send({
          username: 'nonexistent',
          password: 'wrongpassword'
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Invalid credentials');
    });

    it('should reject missing credentials', async () => {
      const res = await agent
        .post('/api/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject inactive user', async () => {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);

      await Admin.create({
        username: 'inactiveadmin',
        email: 'inactive@test.com',
        password: hashedPassword,
        firstName: 'Inactive',
        lastName: 'Admin',
        phoneNumber: '254734567890',
        role: 'super_admin',
        isActive: false
      });

      const res = await agent
        .post('/api/auth/login')
        .send({
          username: 'inactiveadmin',
          password: 'password123'
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('inactive');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user if authenticated', async () => {
      // Login first
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);

      await Admin.create({
        username: 'testadmin',
        email: 'admin@test.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        phoneNumber: '254712345678',
        role: 'super_admin'
      });

      await agent
        .post('/api/auth/login')
        .send({
          username: 'testadmin',
          password: 'password123'
        });

      // Get current user
      const res = await agent.get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('username', 'testadmin');
    });

    it('should return 401 if not authenticated', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout successfully', async () => {
      // Login first
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);

      await Admin.create({
        username: 'testadmin',
        email: 'admin@test.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        phoneNumber: '254712345678',
        role: 'super_admin'
      });

      await agent
        .post('/api/auth/login')
        .send({
          username: 'testadmin',
          password: 'password123'
        });

      // Logout
      const res = await agent.post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify session is destroyed
      const meRes = await agent.get('/api/auth/me');
      expect(meRes.status).toBe(401);
    });
  });

  describe('PUT /api/auth/change-password', () => {
    it('should change password successfully', async () => {
      // Create and login user
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('oldpassword', salt);

      await Admin.create({
        username: 'testadmin',
        email: 'admin@test.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        phoneNumber: '254712345678',
        role: 'super_admin'
      });

      await agent
        .post('/api/auth/login')
        .send({
          username: 'testadmin',
          password: 'oldpassword'
        });

      // Change password
      const res = await agent
        .put('/api/auth/change-password')
        .send({
          currentPassword: 'oldpassword',
          newPassword: 'newpassword123',
          confirmPassword: 'newpassword123'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify old password doesn't work
      await agent.post('/api/auth/logout');
      
      const loginOld = await agent
        .post('/api/auth/login')
        .send({
          username: 'testadmin',
          password: 'oldpassword'
        });

      expect(loginOld.status).toBe(401);

      // Verify new password works
      const loginNew = await agent
        .post('/api/auth/login')
        .send({
          username: 'testadmin',
          password: 'newpassword123'
        });

      expect(loginNew.status).toBe(200);
    });

    it('should reject mismatched passwords', async () => {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);

      await Admin.create({
        username: 'testadmin',
        email: 'admin@test.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        phoneNumber: '254712345678',
        role: 'super_admin'
      });

      await agent
        .post('/api/auth/login')
        .send({
          username: 'testadmin',
          password: 'password123'
        });

      const res = await agent
        .put('/api/auth/change-password')
        .send({
          currentPassword: 'password123',
          newPassword: 'newpassword',
          confirmPassword: 'differentpassword'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('do not match');
    });
  });

  describe('POST /api/auth/switch-region', () => {
    it('should switch region successfully', async () => {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);

      await Admin.create({
        username: 'testadmin',
        email: 'admin@test.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        phoneNumber: '254712345678',
        role: 'super_admin',
        allowedRegions: ['TST1', 'TST2']
      });

      await agent
        .post('/api/auth/login')
        .send({
          username: 'testadmin',
          password: 'password123',
          regionCode: 'TST1'
        });

      const res = await agent
        .post('/api/auth/switch-region')
        .send({
          regionCode: 'TST2'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.selectedRegion).toBe('TST2');
    });

    it('should reject region without access', async () => {
      const role = await Role.create({
        roleName: 'Limited Role',
        roleCode: 'LIMITED',
        description: 'Limited access',
        permissions: { dashboard: { view: true } },
        allowedRegions: ['TST1']
      });

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);

      await User.create({
        username: 'limiteduser',
        email: 'limited@test.com',
        password: hashedPassword,
        firstName: 'Limited',
        lastName: 'User',
        phoneNumber: '254745678901',
        roleId: role._id,
        department: 'sales',
        allowedRegions: ['TST1']
      });

      await agent
        .post('/api/auth/login')
        .send({
          username: 'limiteduser',
          password: 'password123',
          regionCode: 'TST1'
        });

      const res = await agent
        .post('/api/auth/switch-region')
        .send({
          regionCode: 'TST2'
        });

      expect(res.status).toBe(403);
    });
  });
});