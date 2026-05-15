// Central export file for all models
// Usage: const { Customer, Payment, Transaction } = require('./models');

const Admin = require('./Admin');
const User = require('./User');
const Role = require('./Role');
const Site = require('./Site');
const Package = require('./Package');
const Customer = require('./Customer');
const HotspotUser = require('./HotspotUser');
const Lead = require('./Lead');
const Ticket = require('./Ticket');
const Transaction = require('./Transaction');
const Payment = require('./Payment');
const Invoice = require('./Invoice');
const SmsLog = require('./SmsLog');
const SystemLog = require('./SystemLog');

module.exports = {
  Admin,
  User,
  Role,
  Site,
  Package,
  Customer,
  HotspotUser,
  Lead,
  Ticket,
  Transaction,
  Payment,
  Invoice,
  SmsLog,
  SystemLog
};