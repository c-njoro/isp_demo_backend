const axios = require("axios");
const crypto = require("crypto");

const INTER_SYSTEM_SECRET = process.env.INTER_SYSTEM_SECRET;
const OPERATIONS_URI = process.env.OPERATIONS_URI || "https://operations.skylinknetworks.co.ke";

/**
 * Signs a payload using the shared inter-system secret.
 * @param {object} payload
 * @returns {string} HMAC-SHA256 hex signature
 */
function signPayload(payload) {
  const hmac = crypto.createHmac("sha256", INTER_SYSTEM_SECRET);
  hmac.update(JSON.stringify(payload));
  return hmac.digest("hex");
}

/**
 * Generic signed POST to the Operations system.
 * @param {string} path - API path e.g. "/api/v2/support/leads"
 * @param {object} body - Fields to merge with action + timestamp
 * @returns {Promise<object>} Response data
 */
async function signedPost(path, body) {
  const payload = {
    timestamp: Date.now(),
    ...body,
  };

  const signature = signPayload(payload);

  const res = await axios.post(`${OPERATIONS_URI}${path}`, payload, {
    headers: {
      "X-Signature": signature,
      "Content-Type": "application/json",
    },
    timeout: 10000,
  });

  return res.data;
}

// ─────────────────────────────────────────────
// LEADS
// ─────────────────────────────────────────────

/**
 * Fetch leads assigned to a specific agent.
 * @param {string} agentId
 * @returns {Promise<Array>}
 */
const fetchLeads = async (agentId) => {
  try {
    const data = await signedPost("/api/v2/support/leads", {
      action: "get_agent_leads",
      agentId,
    });
    return data.leads || data.reports || [];
  } catch (err) {
    console.error("[operationsService] fetchLeads error:", err.response?.data || err.message);
    return [];
  }
};

/**
 * Fetch all leads with optional filters.
 * @param {object} filters - { status, assignedAgent, page, limit }
 * @returns {Promise<{ leads: Array, pagination: object }>}
 */
const fetchAllLeads = async (filters = {}) => {
  try {
    const data = await signedPost("/api/v2/billing/leads", {
      action: "get_all_leads",
      ...filters,
    });
    console.log("Operations API response for leads:", JSON.stringify(data, null, 2)); // <-- add
    return {
      leads: data.leads || data.reports || [],
      pagination: data.pagination || null,
    };
  } catch (err) {
    console.error("[operationsService] fetchAllLeads error:", err.response?.data || err.message);
    return { leads: [], pagination: null };
  }
};


/**
 * Fetch all technician reports with optional filters.
 * @param {object} filters - { page, limit, search }
 * @returns {Promise<{ reports: Array, pagination: object }>}
 */
const fetchAllReports = async (filters = {}) => {
  try {
    const data = await signedPost("/api/v2/billing/reports", {
      action: "get_all_reports",
      ...filters,
    });
    return {
      reports: data.reports || [],
      pagination: data.pagination || null,
    };
  } catch (err) {
    console.error("[operationsService] fetchAllReports error:", err.response?.data || err.message);
    return { reports: [], pagination: null };
  }
};


// Add to operationsService.js

/**
 * Fetch a single lead by its ID
 * @param {number} leadId
 * @returns {Promise<object|null>}
 */
const fetchLeadById = async (leadId) => {
  try {
    const data = await signedPost("/api/v2/billing/leads/single", {
      action: "get_lead_by_id",
      leadId,
    });
    return data.lead || null;
  } catch (err) {
    console.error("[operationsService] fetchLeadById error:", err.response?.data || err.message);
    return null;
  }
};

/**
 * Fetch a single report by its ID
 * @param {number} reportId
 * @returns {Promise<object|null>}
 */
const fetchReportById = async (reportId) => {
  try {
    const data = await signedPost("/api/v2/billing/reports/single", {
      action: "get_report_by_id",
      reportId,
    });
    return data.report || null;
  } catch (err) {
    console.error("[operationsService] fetchReportById error:", err.response?.data || err.message);
    return null;
  }
};



// ─────────────────────────────────────────────
// TICKETS
// ─────────────────────────────────────────────

/**
 * Fetch tickets assigned to or created for a specific customer.
 * @param {string} customerId - accountId or _id of the customer
 * @returns {Promise<Array>}
 */
const fetchCustomerTickets = async (customerId) => {
  try {
    const data = await signedPost("/api/v2/support/tickets", {
      action: "get_customer_tickets",
      customerId,
    });
    return data.tickets || [];
  } catch (err) {
    console.error("[operationsService] fetchCustomerTickets error:", err.response?.data || err.message);
    return [];
  }
};

/**
 * Fetch tickets assigned to a specific agent.
 * @param {string} agentId
 * @param {object} filters - { status, priority, page, limit }
 * @returns {Promise<{ tickets: Array, pagination: object }>}
 */
const fetchAgentTickets = async (agentId, filters = {}) => {
  try {
    const data = await signedPost("/api/v2/support/tickets/agent", {
      action: "get_agent_tickets",
      agentId,
      ...filters,
    });
    return {
      tickets: data.tickets || [],
      pagination: data.pagination || null,
    };
  } catch (err) {
    console.error("[operationsService] fetchAgentTickets error:", err.response?.data || err.message);
    return { tickets: [], pagination: null };
  }
};

/**
 * Fetch a single ticket by its ID.
 * @param {string} ticketId
 * @returns {Promise<object|null>}
 */
const fetchTicketById = async (ticketId) => {
  try {
    const data = await signedPost("/api/v2/support/tickets/single", {
      action: "get_ticket",
      ticketId,
    });
    return data.ticket || null;
  } catch (err) {
    console.error("[operationsService] fetchTicketById error:", err.response?.data || err.message);
    return null;
  }
};

module.exports = {
  fetchLeads,
  fetchAllLeads,
  fetchCustomerTickets,
  fetchAgentTickets,
  fetchTicketById,
  fetchAllReports,
  fetchReportById,
  fetchLeadById
};