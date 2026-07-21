# Inter-System Communication via HMAC-Signed Requests

This guide explains how to securely make and verify requests between internal systems using HMAC signature authentication.

---

## Overview

When two internal systems need to communicate (e.g. a **Support/Billing system** querying leads from an **Operations system**), requests are authenticated using a shared secret and HMAC signatures. This ensures that only trusted internal services can call each other's endpoints.

---

## Prerequisites
- The [`crypto`](https://nodejs.org/api/crypto.html) module (built into Node.js — no install needed).
- [`axios`](https://axios-http.com/) for making HTTP requests:

```env
INTER_SYSTEM_SECRET=6a29ad2284141319376d7191239154a11e756cd215457fb976c7cbdb8d4f5b5bd173360704bfa18a1edc9e917485a712efdb34046b7308758aa84c41d3cf7268
OPERATIONS_URI=https://api.skylinknetworks.co.ke

```bash
npm install axios
```

---

## How It Works

```
Support System                          Operations System
──────────────                          ─────────────────
 1. Build payload  ──────────────────►  3. Verify HMAC signature
 2. Sign with HMAC                      4. Check timestamp (replay protection)
    (INTER_SYSTEM_SECRET)               5. Validate action field
                                        6. Query DB and return data
```

Each request includes:
- An **`action`** field — identifies the intended operation and is validated on the receiving end.
- A **`timestamp`** — used to reject stale/replayed requests older than 5 minutes.
- An **`X-Signature` header** — the HMAC-SHA256 signature of the full payload.

---

## Part 1 — Requesting System (Support/Billing)

### 1. Create the Inter-System Service

Create a dedicated service file to centralise all outbound calls to the Operations system.

**`services/operationsService.js`**

```js
const axios = require("axios");
const crypto = require("crypto");

const INTER_SYSTEM_SECRET = process.env.INTER_SYSTEM_SECRET;

/**
 * Signs a payload using the shared inter-system secret.
 * @param {object} payload - The request body to sign.
 * @returns {string} HMAC-SHA256 hex signature.
 */
function signPayload(payload) {
  const hmac = crypto.createHmac("sha256", INTER_SYSTEM_SECRET);
  hmac.update(JSON.stringify(payload));
  return hmac.digest("hex");
}

/**
 * Fetches leads for a given agent from the Operations system.
 * @param {string} agentId - The ID of the agent whose leads to retrieve.
 * @returns {Promise<Array>} Array of lead records, or an empty array on failure.
 */
const fetchLeads = async (agentId) => {
  const payload = {
    action: "get_agent_leads",
    timestamp: Date.now(),
    agentId,
  };

  const signature = signPayload(payload);

  try {
    const res = await axios.post(
      `${process.env.OPERATIONS_URI}/api/v2/support/leads`,
      payload,
      {
        headers: {
          "X-Signature": signature,
          "Content-Type": "application/json",
        },
      }
    );

    return res.data.reports || [];
  } catch (err) {
    console.error("Failed to fetch leads:", err.response?.data || err.message);
    return [];
  }
};

module.exports = { fetchLeads };
```

### 2. Create the Controller

Use the service in a controller as you would any internal endpoint.

**`controllers/leadsController.js`**

```js
const { fetchLeads } = require("../services/operationsService");

const getLeads = async (req, res) => {
  const userId = req.user?.id;

  try {
    const leads = await fetchLeads(userId);
    res.status(200).json({
      leads,
      success: true,
      statusCode: 200,
      message: "Leads fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching leads:", error.message);
    res.status(500).json({
      message: "Server Error",
      statusCode: 500,
      success: false,
    });
  }
};

module.exports = { getLeads };
```

### 3. Register the Route

```js
const { getLeads } = require("../controllers/leadsController");

router.get("/leads", authMiddleware, getLeads);
```

---

## Part 2 — Receiving System (Operations)

### 1. Create the Signature Verification Middleware

This middleware runs before any inter-system route handler. It rejects requests with missing, invalid, or expired signatures.

**`middleware/verifySignature.js`**

```js
const crypto = require("crypto");

const verifySignature = (req, res, next) => {
  const signature = req.headers["x-signature"];

  if (!signature) {
    return res.status(401).json({ error: "Missing signature" });
  }

  const expected = crypto
    .createHmac("sha256", process.env.INTER_SYSTEM_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  const signaturesMatch = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );

  if (!signaturesMatch) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Reject requests older than 5 minutes (replay attack protection)
  if (Math.abs(Date.now() - req.body.timestamp) > 300_000) {
    return res.status(401).json({ error: "Request expired" });
  }

  next();
};

module.exports = { verifySignature };
```

### 2. Create the Handler

**`controllers/supportController.js`**

```js
const db = require("../db");

const getUserLeads = async (req, res) => {
  if (req.body.action !== "get_agent_leads") {
    return res.status(400).json({ error: "Invalid action" });
  }

  try {
    const reports = await db.query(
      `SELECT *
       FROM view_leads
       WHERE assigned_agent = ?
       ORDER BY created_at DESC`,
      [req.body.agentId]
    );

    res.status(200).json({ reports, success: true });
  } catch (error) {
    console.error("Error fetching agent leads:", error.message);
    res.status(500).json({
      message: "Internal Server Error",
      statusCode: 500,
      success: false,
    });
  }
};

module.exports = { getUserLeads };
```

### 3. Register the Route

Apply the `verifySignature` middleware to all inter-system routes.

```js
const { verifySignature } = require("../middleware/verifySignature");
const { getUserLeads } = require("../controllers/supportController");

router.post("/support/leads", verifySignature, getUserLeads);
```

---

## Security Notes

| Concern | How It's Handled |
|---|---|
| Forged requests | HMAC signature using shared `INTER_SYSTEM_SECRET` |
| Replay attacks | Timestamp checked — requests older than 5 minutes are rejected |
| Timing attacks | `crypto.timingSafeEqual` used for signature comparison |
| Unintended actions | `action` field validated in the handler before processing |

---

## Adding More Endpoints

The same pattern applies in both directions and for any new endpoint:

1. **Requesting system:** Add a new function to the service file, setting a unique `action` value in the payload.
2. **Receiving system:** Add a new route with the `verifySignature` middleware and a handler that validates the `action` field before processing.