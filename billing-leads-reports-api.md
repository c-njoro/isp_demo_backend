# Billing System — Leads & Reports API

**Base URL:** `https://api.skylinknetworks.co.ke`

---

## Authentication

All requests must be signed using the shared `INTER_SYSTEM_SECRET`.

```js
const payload = {
  action: "get_all_leads",
  timestamp: Date.now(),
  // ...other fields
};

const signature = crypto
  .createHmac("sha256", process.env.INTER_SYSTEM_SECRET)
  .update(JSON.stringify(payload))
  .digest("hex");
```

Include the signature as a header on every request:
```
X-Signature: <signature>
Content-Type: application/json
```

> Requests older than **5 minutes** are automatically rejected.

---

## Endpoints

### Get All Leads
```
POST /api/v2/billing/leads
```

Returns a paginated list of leads.

**Required fields:**
```json
{
  "action": "get_all_leads",
  "timestamp": 1718000000000
}
```

or (if you want to control pagination)

```json
{
  "action": "get_all_leads",
  "timestamp": 1781204245995,
  "page": 1,
  "limit": 20
}
```

**Optional filters:**

| Field | Description |
|---|---|
| `page` | Page number (default: `1`) |
| `limit` | Results per page (default: `20`) |
| `search` | Customer name or phone number |

---

### Get All Reports
```
POST /api/v2/billing/reports
```

Returns a paginated list of technician reports.

**Required fields:**
```json
{
  "action": "get_all_reports",
  "timestamp": 1718000000000
}
```

or (if you want to control pagination)

```json
{
  "action": "get_all_reports",
  "timestamp": 1781204245995,
  "page": 1,
  "limit": 20
}
```

**Optional filters:**

| Field | Description |
|---|---|
| `page` | Page number (default: `1`) |
| `limit` | Results per page (default: `20`) |
| `search` | Customer name or contact number |
