/**
 * Validate and format Kenyan phone numbers
 */

/**
 * Validate phone number format
 * Accepts: 0712345678, 712345678, 254712345678, +254712345678
 */
const isValidKenyanPhone = (phone) => {
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    // Check if it's a valid Kenyan number
    // Should be 9 digits (without 0 or country code) or 10 digits (with 0) or 12 digits (with 254)
    if (cleaned.length === 9 || cleaned.length === 10 || cleaned.length === 12) {
      // Check if starts with valid Kenyan prefix
      if (cleaned.startsWith('254')) {
        // Full format with country code
        return /^254[17]\d{8}$/.test(cleaned);
      } else if (cleaned.startsWith('0')) {
        // Format with leading zero
        return /^0[17]\d{8}$/.test(cleaned);
      } else {
        // Format without leading zero
        return /^[17]\d{8}$/.test(cleaned);
      }
    }
    
    return false;
  };
  
  /**
   * Format phone number to international format (254XXXXXXXXX)
   * Input: 0712345678, 712345678, 254712345678, +254712345678
   * Output: 254712345678
   */
  const formatPhoneNumber = (phone) => {
    if (!phone) return null;
    
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Remove leading 0 if present
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    
    // Add country code if not present
    if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned;
    }
    
    return cleaned;
  };
  
  /**
   * Format phone number for display (0712 345 678)
   */
  const formatPhoneDisplay = (phone) => {
    const formatted = formatPhoneNumber(phone);
    if (!formatted) return phone;
    
    // Remove country code and add spaces
    const local = formatted.replace('254', '0');
    return local.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
  };
  
  /**
   * Get network operator from phone number
   */
  const getNetworkOperator = (phone) => {
    const formatted = formatPhoneNumber(phone);
    if (!formatted) return 'unknown';
    
    const prefix = formatted.substring(3, 6); // Get first 3 digits after 254
    
    // Safaricom prefixes
    if (['110', '111', '112', '113', '114', '115', '700', '701', '702', '703', '704', '705', '706', '707', '708', '709', '710', '711', '712', '713', '714', '715', '716', '717', '718', '719', '720', '721', '722', '723', '724', '725', '726', '727', '728', '729', '740', '741', '742', '743', '745', '746', '748', '757', '758', '759', '768', '769', '790', '791', '792', '793', '794', '795', '796', '797', '798', '799'].includes(prefix)) {
      return 'Safaricom';
    }
    
    // Airtel prefixes
    if (['730', '731', '732', '733', '734', '735', '736', '737', '738', '739', '750', '751', '752', '753', '754', '755', '756', '780', '781', '782', '783', '784', '785', '786', '787', '788', '789'].includes(prefix)) {
      return 'Airtel';
    }
    
    // Telkom prefixes
    if (['770', '771', '772', '773', '774', '775', '776', '777', '778', '779'].includes(prefix)) {
      return 'Telkom';
    }
    
    return 'unknown';
  };
  
  module.exports = {
    isValidKenyanPhone,
    formatPhoneNumber,
    formatPhoneDisplay,
    getNetworkOperator
  };