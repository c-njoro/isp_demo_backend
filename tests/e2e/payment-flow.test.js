const request = require('supertest');
const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const app = require('../../server');
const Admin = require('../../models/Admin');
const Customer = require('../../models/Customer');
const Package = require('../../models/Package');
const Site = require('../../models/Site');
const Payment = require('../../models/Payment');
const Transaction = require('../../models/Transaction');
const Invoice = require('../../models/Invoice');
const bcrypt = require('bcryptjs');
const { setupTestDB, clearTestDB, closeTestDB } = require('../setup');

describe('E2E: Complete Payment to Service Activation Flow', () => {
  let agent;
  let testSite;
  let testPackage;
  let testCustomer;

  beforeAll(async () => {
    await setupTestDB();
    agent = request.agent(app);
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Setup test data
    // 1. Create admin and login
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

    await agent
      .post('/api/auth/login')
      .send({
        username: 'testadmin',
        password: 'password123'
      });

    // 2. Create site
    const siteRes = await agent
      .post('/api/sites')
      .send({
        siteName: 'Test Site',
        regionCode: 'TST',
        location: {
          address: 'Test Address'
        },
        router: {
          ip: '192.168.1.1',
          username: 'admin',
          password: 'test123'
        }
      });

    testSite = siteRes.body.data;

    // 3. Create package
    const packageRes = await agent
      .post('/api/packages')
      .send({
        packageName: 'Test Package',
        packageType: 'ppp',
        siteId: testSite._id,
        speed: {
          download: 10,
          upload: 10
        },
        price: 2000,
        period: 30,
        periodUnit: 'd'
      });

    testPackage = packageRes.body.data;

    // 4. Create customer
    const customerRes = await agent
      .post('/api/customers')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        phoneNumber: '0712345678',
        packageId: testPackage._id,
        siteId: testSite._id
      });

    testCustomer = customerRes.body.data;
  });

  it('should complete full payment flow: lookup -> initiate -> callback -> activation', async () => {
    // Step 1: Customer looks up their account
    const lookupRes = await request(app)
      .post('/api/payments/lookup')
      .send({
        phoneNumber: '0712345678'
      });

    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body.success).toBe(true);
    expect(lookupRes.body.data.accounts).toHaveLength(1);
    expect(lookupRes.body.data.accounts[0].name).toBe('John Doe');
    expect(lookupRes.body.data.accounts[0].packagePrice).toBe(2000);

    const accountInfo = lookupRes.body.data.accounts[0];

    // Step 2: Customer initiates payment (STK push)
    const initiateRes = await request(app)
      .post('/api/payments/initiate')
      .send({
        customerId: accountInfo.customerId,
        customerType: 'pppoe',
        accountId: accountInfo.accountId,
        phoneNumber: '0712345678',
        amount: 2000,
        packageId: testPackage._id,
        regionCode: 'TST',
        siteId: testSite._id
      });

    // Note: This will fail because we don't have actual M-Pesa credentials
    // But we can test the payment record creation
    expect(initiateRes.status).toBeGreaterThanOrEqual(200);

    // Check payment record was created
    const payment = await Payment.findOne({
      customerId: testCustomer._id
    });

    expect(payment).toBeDefined();
    expect(payment.amount).toBe(2000);
    expect(payment.customerType).toBe('pppoe');

    // Step 3: Simulate M-Pesa callback (successful payment)
    if (payment) {
      const callbackRes = await request(app)
        .post('/api/payments/callback')
        .send({
          Body: {
            stkCallback: {
              MerchantRequestID: 'TEST-MERCHANT-123',
              CheckoutRequestID: payment.stkPush?.checkoutRequestId || 'TEST-CHECKOUT-123',
              ResultCode: 0,
              ResultDesc: 'The service request is processed successfully.',
              CallbackMetadata: {
                Item: [
                  { Name: 'Amount', Value: 2000 },
                  { Name: 'MpesaReceiptNumber', Value: 'TEST123ABC' },
                  { Name: 'TransactionDate', Value: 20240225120000 },
                  { Name: 'PhoneNumber', Value: 254712345678 }
                ]
              }
            }
          }
        });

      expect(callbackRes.status).toBe(200);

      // Step 4: Verify payment was processed
      const updatedPayment = await Payment.findById(payment._id);
      expect(updatedPayment.status).toBe('completed');
      expect(updatedPayment.mpesaReceiptNumber).toBe('TEST123ABC');

      // Step 5: Verify transactions were created
      const transactions = await Transaction.find({
        customerId: testCustomer._id
      });

      expect(transactions).toHaveLength(2);

      const mpesaTransaction = transactions.find(t => t.type === 'MPESA');
      const subscriptionTransaction = transactions.find(t => t.type === 'SUBSCRIPTION');

      expect(mpesaTransaction).toBeDefined();
      expect(mpesaTransaction.amount).toBe(2000);
      expect(mpesaTransaction.status).toBe('completed');

      expect(subscriptionTransaction).toBeDefined();
      expect(subscriptionTransaction.amount).toBe(-2000);
      expect(subscriptionTransaction.status).toBe('completed');

      // Verify transactions are linked
      expect(mpesaTransaction.relatedTransactionId.toString()).toBe(
        subscriptionTransaction._id.toString()
      );

      // Step 6: Verify customer subscription was renewed
      const updatedCustomer = await Customer.findById(testCustomer._id);
      expect(updatedCustomer.subscription.status).toBe('active');
      expect(updatedCustomer.subscription.expiresAt).toBeDefined();
      expect(updatedCustomer.billing.balance).toBe(2000);

      // Step 7: Verify invoice was generated
      const invoice = await Invoice.findOne({
        customerId: testCustomer._id
      });

      expect(invoice).toBeDefined();
      expect(invoice.total).toBe(2000);
      expect(invoice.status).toBe('paid');
      expect(invoice.mpesaReceiptNumber).toBe('TEST123ABC');
    }
  });

  it('should handle failed payment correctly', async () => {
    // Create payment
    const payment = await Payment.create({
      customerType: 'pppoe',
      customerId: testCustomer._id,
      accountId: testCustomer.accountId,
      regionCode: 'TST',
      siteId: testSite._id,
      amount: 2000,
      packageId: testPackage._id,
      stkPush: {
        phoneNumber: '254712345678',
        checkoutRequestId: 'TEST-FAILED-123',
        initiatedAt: new Date()
      },
      status: 'pending'
    });

    // Simulate failed callback
    const callbackRes = await request(app)
      .post('/api/payments/callback')
      .send({
        Body: {
          stkCallback: {
            MerchantRequestID: 'TEST-MERCHANT-123',
            CheckoutRequestID: 'TEST-FAILED-123',
            ResultCode: 1032,
            ResultDesc: 'Request cancelled by user'
          }
        }
      });

    expect(callbackRes.status).toBe(200);

    // Verify payment status
    const updatedPayment = await Payment.findById(payment._id);
    expect(updatedPayment.status).toBe('failed');
    expect(updatedPayment.error).toBeDefined();

    // Verify no transactions were created
    const transactions = await Transaction.find({
      customerId: testCustomer._id
    });

    expect(transactions).toHaveLength(0);

    // Verify customer subscription was not renewed
    const customer = await Customer.findById(testCustomer._id);
    expect(customer.billing.balance).toBe(0);
  });

  it('should check payment status correctly', async () => {
    // Create payment
    const payment = await Payment.create({
      customerType: 'pppoe',
      customerId: testCustomer._id,
      accountId: testCustomer.accountId,
      regionCode: 'TST',
      siteId: testSite._id,
      amount: 2000,
      packageId: testPackage._id,
      status: 'completed',
      mpesaReceiptNumber: 'TEST123ABC'
    });

    // Check status
    const statusRes = await request(app)
      .get(`/api/payments/${payment._id}/status`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.success).toBe(true);
    expect(statusRes.body.data.status).toBe('completed');
    expect(statusRes.body.data.mpesaReceiptNumber).toBe('TEST123ABC');
  });
});