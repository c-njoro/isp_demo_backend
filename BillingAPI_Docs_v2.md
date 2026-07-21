# Billing System — Customer API

**Base URL:** `https://billing.skylinknetworks.co.ke`

---

## Authentication

All requests must be signed using the shared `INTER_SYSTEM_SECRET`.

```js
const payload = {
  action: "get_customers",
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

### Get Customers
```
POST /api/support/customers
```

Returns a paginated list of all customers including child accounts.

**Required fields:**
```json
{
  "action": "get_customers",
  "timestamp": 1718000000000
}

or(if you want to controll pagination)

{
  "action": "get_customers",
  "timestamp": 1781204245995,
  "page": 1,
  "limit": 13
}
```

**Optional filters:**

| Field | Description |
|---|---|
| `page` | Page number (default: `1`) |
| `limit` | Results per page (default: `13`) |
| `search` | Name, accountId, phone, PPPoE username, city, sublocation, local area |
| `status` | `"active"`, `"expired"`, `"suspended"`, `"disabled"` |
| `regionCode` | e.g. `"NKR"` |
| `packageId` | Filter by package |
| `siteId` | Filter by site |
| `city` | Partial match |
| `subLocation` | Partial match |
| `localArea` | Partial match |
| `sortBy` | Default: `"accountId"` |
| `sortOrder` | `"asc"` or `"desc"` |

---

### Get Single Customer
```
POST /api/support/customers/single
```

Fetch one customer by `accountId` or `customerId`.

```json
{
  "action": "get_customer",
  "timestamp": 1718000000000,
  "accountId": "SKY001"
}
```
