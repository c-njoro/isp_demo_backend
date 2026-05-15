// utils/errorMessages.js

/**
 * Get standardized error message for resource not found
 * @param {string} resourceName - Name of the resource (e.g., 'Site', 'OLT')
 * @returns {string} - Error message
 */
const getResourceNotFoundMessage = (resourceName) => {
    return `${resourceName} not found`;
  };
  
  /**
   * Get standardized error message for access denied
   * @param {string} resourceName - Name of the resource
   * @returns {string} - Error message
   */
  const getAccessDeniedMessage = (resourceName) => {
    return `Access denied to this ${resourceName.toLowerCase()}`;
  };
  
  /**
   * Get standardized error message for duplicate resource
   * @param {string} resourceName - Name of the resource
   * @param {string} field - Field that is duplicated (optional)
   * @param {string} value - Duplicate value (optional)
   * @returns {string} - Error message
   */
  const getDuplicateMessage = (resourceName, field, value) => {
    if (field && value) {
      return `${resourceName} with ${field} '${value}' already exists`;
    }
    return `${resourceName} already exists`;
  };
  
  module.exports = {
    getResourceNotFoundMessage,
    getAccessDeniedMessage,
    getDuplicateMessage
  };