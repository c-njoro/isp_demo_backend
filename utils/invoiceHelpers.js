const Invoice = require('../models/Invoice');

/**
 * Generate unique invoice number
 * Format: INV-REGIONCODE-YEAR-SEQUENCE (e.g., INV-SKY-2024-0001)
 */
const generateInvoiceNumber = async (regionCode) => {
  try {
    const year = new Date().getFullYear();
    const prefix = `INV-${regionCode}-${year}-`;

    // Get last invoice for this region and year
    const lastInvoice = await Invoice
      .findOne({ 
        regionCode,
        invoiceNumber: { $regex: `^${prefix}` }
      })
      .sort({ invoiceNumber: -1 })
      .limit(1);

    if (!lastInvoice) {
      // First invoice for this region and year
      return `${prefix}0001`;
    }

    // Extract sequence number
    const lastSequence = parseInt(lastInvoice.invoiceNumber.split('-').pop());
    const nextSequence = (lastSequence + 1).toString().padStart(4, '0');

    return `${prefix}${nextSequence}`;
  } catch (error) {
    console.error('Error generating invoice number:', error);
    throw error;
  }
};

/**
 * Calculate period end date based on package period
 */
const calculatePeriodEnd = (startDate, period, periodUnit) => {
  const endDate = new Date(startDate);

  switch (periodUnit) {
    case 'm':
      endDate.setMinutes(endDate.getMinutes() + period);
      break;
    case 'h':
      endDate.setHours(endDate.getHours() + period);
      break;
    case 'd':
      if (period >= 30) {
        // Monthly billing – advance by one calendar month
        endDate.setMonth(endDate.getMonth() + 1);
      } else {
        // Short‑day periods (e.g., 7‑day trial) – add literal days
        endDate.setDate(endDate.getDate() + period);
      }
      break;
    default:
      // Fallback for any other unit (e.g., minutes)
      endDate.setMinutes(endDate.getMinutes() + period);
  }

  return endDate;
};

/**
 * Format currency to KSH
 */
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES'
  }).format(amount);
};

module.exports = {
  generateInvoiceNumber,
  calculatePeriodEnd,
  formatCurrency
};