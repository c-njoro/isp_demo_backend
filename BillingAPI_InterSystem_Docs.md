# Billing System — Inter-System API Documentation

This document describes how to call the Billing system's customer endpoints from the Operations system. All requests are authenticated using HMAC-SHA256 signatures.

---

## Base URL

```
https://billing.skylinknetworks.co.ke
```

---

## Authentication

Every request must be signed using the shared `INTER_SYSTEM_SECRET`. Include the signature in the `X-Signature` header.

### How to sign a request

```js
const crypto = require("crypto");

const payload = {
  action: "get_customers", // varies per endpoint
  timestamp: Date.now(),
  // ...other fields
};

const signature = crypto
  .createHmac("sha256", process.env.INTER_SYSTEM_SECRET)
  .update(JSON.stringify(payload))
  .digest("hex");
```

### Rules
- Every request body **must include a `timestamp`** (Unix ms — `Date.now()`).
- Requests older than **5 minutes** are rejected.
- The signature is computed over the **entire JSON body** — the body sent must match exactly.
- Use `Content-Type: application/json` on all requests.

---

## Endpoints

### 1. Get Customers (Paginated + Filtered)

Fetch a paginated list of customers with optional filters.

```
POST /api/support/customers
```

**Headers**

| Header | Value |
|---|---|
| Content-Type | application/json |
| X-Signature | `<hmac signature>` |

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | ✅ | Must be `"get_customers"` |
| `timestamp` | number | ✅ | `Date.now()` — Unix ms |
| `page` | number | | Page number. Default: `1` |
| `limit` | number | | Results per page. Default: `13` |
| `search` | string | | Search by name, accountId, phone, PPPoE username, city, sublocation, or local area. Supports two-word name searches. |
| `status` | string | | `"active"`, `"expired"`, `"suspended"`, or `"disabled"` |
| `packageId` | string | | Filter by package ID |
| `siteId` | string | | Filter by site ID |
| `city` | string | | Filter by city (partial match) |
| `subLocation` | string | | Filter by sublocation (partial match) |
| `localArea` | string | | Filter by local area (partial match) |
| `nasIp` | string | | Filter by NAS IP |
| `sortBy` | string | | Field to sort by. Default: `"accountId"` |
| `sortOrder` | string | | `"asc"` or `"desc"`. Default: `"asc"` |
| `regionCode` | string | | Scope results to a specific region e.g. `"NKR"` |

**Example Request Body**

```json
{
  "action": "get_customers",
  "timestamp": 1718000000000,
  "page": 1,
  "limit": 20,
  "status": "active",
  "regionCode": "NKR",
  "search": "John"
}
```

**Example Response**

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "customers": [
      {
        "_id": "665abc123def456",
        "accountId": "SKY001",
        "firstName": "John",
        "lastName": "Doe",
        "phoneNumber": "0712345678",
        "city": "Nakuru",
        "regionCode": "NKR",
        "subscription": {
          "status": "active",
          "expiresAt": "2025-07-01T00:00:00.000Z",
          "packageId": {
            "_id": "pkg123",
            "packageName": "10Mbps Home",
            "price": 1500
          }
        },
        "siteId": {
          "_id": "site456",
          "name": "Nakuru Main",
          "regionCode": "NKR"
        },
        "pppoe": {
          "username": "SKY001"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 142,
      "pages": 8
    }
  }
}
```

---

### 2. Get Single Customer

Fetch one customer by their `accountId` or internal `_id`.

```
POST /api/support/customers/single
```

**Headers**

| Header | Value |
|---|---|
| Content-Type | application/json |
| X-Signature | `<hmac signature>` |

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | ✅ | Must be `"get_customer"` |
| `timestamp` | number | ✅ | `Date.now()` — Unix ms |
| `accountId` | string | Either/or | Customer account ID e.g. `"SKY001"` |
| `customerId` | string | Either/or | MongoDB `_id` of the customer |

Provide either `accountId` or `customerId` — not both required, but at least one.

**Example Request Body**

```json
{
  "action": "get_customer",
  "timestamp": 1718000000000,
  "accountId": "SKY001"
}
```

**Example Response**

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "customer": {
      "_id": "665abc123def456",
      "accountId": "SKY001",
      "firstName": "John",
      "lastName": "Doe",
      "phoneNumber": "0712345678",
      "city": "Nakuru",
      "regionCode": "NKR",
      "subscription": {
        "status": "active",
        "expiresAt": "2025-07-01T00:00:00.000Z",
        "packageId": {
          "_id": "pkg123",
          "packageName": "10Mbps Home",
          "price": 1500
        }
      },
      "siteId": {
        "_id": "site456",
        "name": "Nakuru Main",
        "regionCode": "NKR"
      },
      "pppoe": {
        "username": "SKY001"
      }
    }
  }
}
```

---

### 3. Get Unprocessed Payment (by Receipt)

Fetch a single unprocessed payment by its receipt number.

```
POST /api/v2/inter-system/payments/unprocessed/single
```

**Headers**

| Header | Value |
|---|---|
| Content-Type | application/json |
| X-Signature | `<hmac signature>` |

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | ✅ | Must be `"get_unprocessed_payment"` |
| `timestamp` | number | ✅ | `Date.now()` — Unix ms |
| `receipt` | string | ✅ | Receipt number of the unprocessed payment |

**Example Request Body**

```json
{
  "action": "get_unprocessed_payment",
  "timestamp": 1718000000000,
  "receipt": "RCP123456789"
}
```

**Example Response**

> Response shape matches `GET /api/payments/unprocessed/:receipt`.

```json
{
    "success": true,
    "message": "Unprocessed payment retrieved successfully",
    "data": {
        "_id": "69ca80d1ead19f4bc99627ca",
        "receiptNumber": "TEST1774878929564",
        "phoneNumber": "254720128696",
        "amount": 2,
        "transactionDate": null,
        "rawData": {
            "TransactionType": "Pay Bill",
            "TransID": "TEST1774878929564",
            "TransTime": 1774878929564,
            "TransAmount": 2,
            "BusinessShortCode": "600000",
            "BillRefNumber": "TEST001",
            "MSISDN": "254720128696",
            "FirstName": "John",
            "MiddleName": "",
            "LastName": "Doe"
        },
        "status": "new",
        "createdAt": "2026-03-30T13:55:29.670Z",
        "updatedAt": "2026-03-30T14:02:59.861Z",
        "__v": 0
    }
}
```

---

### 4. Resolve Unprocessed Payment

Resolve (process) an unprocessed payment by linking it to a customer.

```
POST /api/v2/inter-system/payments/resolve
```

**Headers**

| Header | Value |
|---|---|
| Content-Type | application/json |
| X-Signature | `<hmac signature>` |

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | ✅ | Must be `"resolve_customer_payment"` |
| `timestamp` | number | ✅ | `Date.now()` — Unix ms |
| `receiptNumber` | string | ✅ | Receipt number of the payment to resolve |
| `customerId` | string | ✅ | Account ID or customer identifier to link the payment to |
| `customerType` | string | ✅ | `"pppoe"` or `"hotspot"` |

**Example Request Body**

```json
{
  "action": "resolve_customer_payment",
  "timestamp": 1718000000000,
  "receiptNumber": "RCP123456789",
  "customerId": "SKY001",
  "customerType": "pppoe"
}
```

**Example Response**

> Response shape matches `POST /api/payments/resolve`.

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "payment": {
      "_id": "pay987654321",
      "receipt": "RCP123456789",
      "amount": 1500,
      "status": "resolved",
      "resolvedAt": "2025-06-15T11:00:00.000Z",
      "customerId": "SKY001",
      "customerType": "pppoe"
    }
  }
}
```

---

## Error Responses

| Status | Message | Cause |
|---|---|---|
| `400` | `"Invalid action"` | `action` field is missing or wrong |
| `400` | `"Provide either accountId or customerId"` | Single lookup called with neither field |
| `400` | `"Receipt number is required"` | `receipt` field missing on unprocessed payment lookup |
| `401` | `"Missing inter-system signature"` | `X-Signature` header not present |
| `401` | `"Invalid signature"` | Signature does not match the body |
| `401` | `"Request expired or missing timestamp"` | Timestamp older than 5 minutes or missing |
| `404` | `"Customer not found"` | No customer matched the provided ID |
| `500` | `"Internal Server Error"` | Server-side error |

---

## Notes

- PPPoE passwords and CPE WiFi passwords are **never returned** by these endpoints.
- Child accounts (accountIds containing `-`) are excluded from the list endpoint.
- The `search` field supports two-word name queries e.g. `"John Doe"` — it will match first+last or last+first order.
- All inter-system payment endpoints delegate to the existing internal payment controllers (`paymentControllerKopoKopo`), so responses are identical to the internal APIs.
