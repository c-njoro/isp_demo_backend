const { describe, it, expect } = require('@jest/globals');
const {
  generateAccountId,
  generatePPPoEPassword,
  generateWiFiPassword,
  isValidMacAddress,
  normalizeMacAddress
} = require('../../utils/accountHelpers');

const {
  generateInvoiceNumber,
  calculatePeriodEnd,
  formatCurrency
} = require('../../utils/invoiceHelpers');

const {
  isValidKenyanPhone,
  formatPhoneNumber,
  formatPhoneDisplay,
  getNetworkOperator
} = require('../../utils/phoneHelpers');

describe('Account Helpers', () => {
  describe('generatePPPoEPassword', () => {
    it('should generate 8 character password', () => {
      const password = generatePPPoEPassword();
      expect(password).toHaveLength(8);
    });

    it('should contain alphanumeric and special characters', () => {
      const password = generatePPPoEPassword();
      expect(password).toMatch(/[A-Za-z]/); // Has letters
      expect(password).toMatch(/[0-9]/);     // Has numbers
    });

    it('should generate unique passwords', () => {
      const password1 = generatePPPoEPassword();
      const password2 = generatePPPoEPassword();
      expect(password1).not.toBe(password2);
    });
  });

  describe('generateWiFiPassword', () => {
    it('should generate 8 character password', () => {
      const password = generateWiFiPassword();
      expect(password).toHaveLength(8);
    });

    it('should only contain alphanumeric characters', () => {
      const password = generateWiFiPassword();
      expect(password).toMatch(/^[A-Za-z0-9]+$/);
    });
  });

  describe('isValidMacAddress', () => {
    it('should validate correct MAC address formats', () => {
      expect(isValidMacAddress('AA:BB:CC:DD:EE:FF')).toBe(true);
      expect(isValidMacAddress('aa:bb:cc:dd:ee:ff')).toBe(true);
      expect(isValidMacAddress('AA-BB-CC-DD-EE-FF')).toBe(true);
      expect(isValidMacAddress('AABBCCDDEEFF')).toBe(true);
    });

    it('should reject invalid MAC addresses', () => {
      expect(isValidMacAddress('invalid')).toBe(false);
      expect(isValidMacAddress('AA:BB:CC:DD:EE')).toBe(false);
      expect(isValidMacAddress('GG:HH:II:JJ:KK:LL')).toBe(false);
    });
  });

  describe('normalizeMacAddress', () => {
    it('should normalize MAC address to uppercase with colons', () => {
      expect(normalizeMacAddress('aa:bb:cc:dd:ee:ff')).toBe('AA:BB:CC:DD:EE:FF');
      expect(normalizeMacAddress('AA-BB-CC-DD-EE-FF')).toBe('AA:BB:CC:DD:EE:FF');
      expect(normalizeMacAddress('AABBCCDDEEFF')).toBe('AA:BB:CC:DD:EE:FF');
    });
  });
});

describe('Invoice Helpers', () => {
  describe('calculatePeriodEnd', () => {
    it('should calculate end date for days', () => {
      const startDate = new Date('2024-01-01');
      const endDate = calculatePeriodEnd(startDate, 30, 'd');
      expect(endDate.getDate()).toBe(31);
      expect(endDate.getMonth()).toBe(0); // January
    });

    it('should calculate end date for hours', () => {
      const startDate = new Date('2024-01-01T10:00:00');
      const endDate = calculatePeriodEnd(startDate, 24, 'h');
      expect(endDate.getHours()).toBe(10);
      expect(endDate.getDate()).toBe(2);
    });

    it('should calculate end date for minutes', () => {
      const startDate = new Date('2024-01-01T10:00:00');
      const endDate = calculatePeriodEnd(startDate, 60, 'm');
      expect(endDate.getHours()).toBe(11);
    });
  });

  describe('formatCurrency', () => {
    it('should format currency correctly', () => {
      expect(formatCurrency(1000)).toBe('KSH 1,000');
      expect(formatCurrency(1234.56)).toBe('KSH 1,235');
      expect(formatCurrency(0)).toBe('KSH 0');
    });
  });
});

describe('Phone Helpers', () => {
  describe('isValidKenyanPhone', () => {
    it('should validate correct Kenyan phone numbers', () => {
      expect(isValidKenyanPhone('0712345678')).toBe(true);
      expect(isValidKenyanPhone('254712345678')).toBe(true);
      expect(isValidKenyanPhone('+254712345678')).toBe(true);
      expect(isValidKenyanPhone('0722345678')).toBe(true);
      expect(isValidKenyanPhone('0733345678')).toBe(true);
    });

    it('should reject invalid phone numbers', () => {
      expect(isValidKenyanPhone('12345')).toBe(false);
      expect(isValidKenyanPhone('0612345678')).toBe(false);
      expect(isValidKenyanPhone('invalid')).toBe(false);
    });
  });

  describe('formatPhoneNumber', () => {
    it('should format to 254XXXXXXXXX format', () => {
      expect(formatPhoneNumber('0712345678')).toBe('254712345678');
      expect(formatPhoneNumber('712345678')).toBe('254712345678');
      expect(formatPhoneNumber('254712345678')).toBe('254712345678');
      expect(formatPhoneNumber('+254712345678')).toBe('254712345678');
    });
  });

  describe('formatPhoneDisplay', () => {
    it('should format for display', () => {
      expect(formatPhoneDisplay('254712345678')).toBe('0712 345 678');
      expect(formatPhoneDisplay('0712345678')).toBe('0712 345 678');
    });
  });

  describe('getNetworkOperator', () => {
    it('should identify Safaricom numbers', () => {
      expect(getNetworkOperator('254712345678')).toBe('Safaricom');
      expect(getNetworkOperator('254722345678')).toBe('Safaricom');
    });

    it('should identify Airtel numbers', () => {
      expect(getNetworkOperator('254733345678')).toBe('Airtel');
      expect(getNetworkOperator('254750345678')).toBe('Airtel');
    });

    it('should identify Telkom numbers', () => {
      expect(getNetworkOperator('254770345678')).toBe('Telkom');
    });

    it('should return Unknown for invalid numbers', () => {
      expect(getNetworkOperator('254612345678')).toBe('Unknown');
    });
  });
});