# Router-Based Architecture Migration Guide

## Overview

This document describes the migration from **site-based Mikrotik operations** to a **router-based architecture**. Previously, each Site had a single Mikrotik router. Now, Sites are containers/regions that can have multiple routers, and customers connect to specific routers via `customer.pppoe.siteIp`.

## Key Architectural Changes

### Before

```
Site
├── router.ip (Mikrotik IP)
├── router.username
├── router.password
└── router.apiPort
```

### After

```
Site (Region Container)
├── siteName
├── regionCode
└── (no direct router)

Router (Separate Model)
├── ip
├── username
├── password
├── apiPort
├── site (reference to Site)
├── isPrimary (boolean)
└── name

Customer
└── pppoe.siteIp (specific router IP where customer connects)
```

## Helper Functions (customerController.js)

### 1. `getRouterForCustomer(customer, throwError = true)`

Gets the router that a customer is connected to based on their `pppoe.siteIp`.

**Usage:**

```javascript
// Get router and throw error if not found
const router = await getRouterForCustomer(customer, true);

// Get router without throwing error
const router = await getRouterForCustomer(customer, false);
if (!router) {
  console.log("No router found");
}
```

### 2. `getPrimaryRouterForSite(siteId)`

Gets the primary router for a site. Used when setting up new customers in a site.

**Usage:**

```javascript
const primaryRouter = await getPrimaryRouterForSite(siteId);
// Always throws error if not found - use in try/catch
```

### 3. `buildRouterConnectionObject(router)`

Converts a Router document to the connection object expected by mikrotikService.

**Usage:**

```javascript
const routerObj = buildRouterConnectionObject(router);
// Result: { ip, username, password, port, apiType }
```

### 4. `buildSiteLikeObjectFromRouter(router)`

For backward compatibility - wraps router into a site-like object for services that still expect site structure.

**Usage:**

```javascript
const siteObj = buildSiteLikeObjectFromRouter(router);
// Result: { router: {...}, siteName, ip }
// Pass to services: mikrotikService.testConnection(siteObj)
```

## Migration Patterns

### Pattern 1: Update Password (Before)

```javascript
// OLD - BROKEN
const site = await Site.findById(customer.siteId);
const result = await mikrotikService.updatePPPoEPassword(
  site,
  username,
  password,
);
```

### Pattern 1: Update Password (After)

```javascript
// NEW - CORRECT
const router = await getRouterForCustomer(customer, false);
if (router) {
  const siteObj = buildSiteLikeObjectFromRouter(router);
  const result = await mikrotikService.updatePPPoEPassword(
    siteObj,
    username,
    password,
  );
} else {
  console.warn("No router found, skipping Mikrotik update");
}
```

---

### Pattern 2: Register NAS in RADIUS (Before)

```javascript
// OLD - BROKEN
radiusService.registerNas(site.router.ip, secret, siteName);
```

### Pattern 2: Register NAS in RADIUS (After)

```javascript
// NEW - CORRECT
const router = await Router.findOne({ ip: nasIp });
radiusService.registerNas(router.ip, secret, siteName);
```

---

### Pattern 3: Customer Migration (Before)

```javascript
// OLD - BROKEN
const tempCustomer = {
  ...customer.toObject(),
  pppoe: {
    username: newPppoeUsername,
    siteIp: newSite.router.ip, // ❌ newSite has no router property
  },
};
```

### Pattern 3: Customer Migration (After)

```javascript
// NEW - CORRECT
const newRouter = await getPrimaryRouterForSite(newSiteId);
const tempCustomer = {
  ...customer.toObject(),
  pppoe: {
    username: newPppoeUsername,
    siteIp: newRouter.ip, // ✅ Get from router document
  },
};
```

---

### Pattern 4: Session Management (Before)

```javascript
// OLD - BROKEN
const site = await Site.findById(customer.siteId);
const result = await mikrotikService.endSession(site, username);
```

### Pattern 4: Session Management (After)

```javascript
// NEW - CORRECT
try {
  const router = await getRouterForCustomer(customer, false);
  if (router) {
    const siteObj = buildSiteLikeObjectFromRouter(router);
    const result = await mikrotikService.endSession(siteObj, username);
  }
} catch (error) {
  console.error("Error managing session:", error.message);
}
```

---

### Pattern 5: MAC Address Updates (Before)

```javascript
// OLD - BROKEN
const site = await Site.findById(customer.siteId);
const client = await mikrotikService.getConnection(
  site.router.ip,
  site.router.username,
  site.router.password,
  site.router.apiType,
);
```

### Pattern 5: MAC Address Updates (After)

```javascript
// NEW - CORRECT
const router = await getRouterForCustomer(customer, false);
if (router) {
  const siteObj = buildSiteLikeObjectFromRouter(router);
  const client = await mikrotikService.getConnection(siteObj);
}
```

---

## Error Handling Style Guide

### DO: Graceful Degradation

When router is optional (e.g., Mikrotik updates):

```javascript
try {
  const router = await getRouterForCustomer(customer, false);
  if (router) {
    const siteObj = buildSiteLikeObjectFromRouter(router);
    await mikrotikService.updatePPPoEPassword(siteObj, username, password);
  } else {
    console.warn("⚠️ No router found, skipping Mikrotik update");
  }
} catch (error) {
  console.error("⚠️ Error updating password:", error.message);
}
```

### DON'T: Let Errors Bubble Up

```javascript
// ❌ BAD - Customer creation fails if router doesn't exist
const router = await getRouterForCustomer(customer); // throwError=true
const siteObj = buildSiteLikeObjectFromRouter(router);
await mikrotikService.updatePPPoEPassword(siteObj, username, password);
```

### DO: Use Try-Catch for Critical Operations

When router lookup is mandatory (e.g., customer migration):

```javascript
try {
  const newRouter = await getPrimaryRouterForSite(newSiteId);
  // Use newRouter...
} catch (routerError) {
  return next(new ErrorResponse(`Cannot migrate: ${routerError.message}`, 500));
}
```

---

## Functions Updated in customerController.js

1. ✅ **createCustomer** - Uses `getPrimaryRouterForSite()` for new customers
2. ✅ **changePassword** - Uses `getRouterForCustomer()` with graceful degradation
3. ✅ **updateCPE** - Uses `getRouterForCustomer()` for MAC updates
4. ✅ **migrateCustomer** - Uses `getPrimaryRouterForSite()` for target site
5. ✅ **reactivateCustomer** - Uses `getRouterForCustomer()` for session restart
6. ✅ **getCustomerRouterStatus** - Uses router lookup for connection testing
7. ✅ **createChildAccount** - Uses `getPrimaryRouterForSite()` for child accounts

---

## Remaining Work: Other Controllers

Apply the same patterns to:

- ✋ `radiusManagementController.js` - NAS registration
- ✋ `customerPortalController.js` - Session/connection queries
- ✋ `siteController.js` - Site-level operations
- ✋ `routerController.js` - Router management
- ✋ Any other file using `site.router` pattern

---

## Router Model Expected Structure

Ensure your Router model has these fields:

```javascript
{
  _id: ObjectId,
  name: String,
  ip: String (unique),
  username: String,
  password: String,
  apiPort: Number (default: 8728),
  apiType: String (default: 'api'),
  site: ObjectId (ref: 'Site'),
  isPrimary: Boolean (default: false),
  isActive: Boolean (default: true),
  createdAt: Date,
  updatedAt: Date
}
```

---

## Testing Checklist

- [ ] Create customer → assigns primary router from site
- [ ] Change password → updates both RADIUS and Mikrotik via correct router
- [ ] Update MAC → correctly identifies and updates via customer's router
- [ ] Migrate customer → retrieves new site's primary router
- [ ] Reactivate customer → restarts session on correct router
- [ ] Get router status → queries connection on customer's specific router
- [ ] Create child account → uses parent's router
- [ ] Error cases → gracefully handle missing router (no crashes)

---

## Backward Compatibility Notes

The `buildSiteLikeObjectFromRouter()` helper allows services to continue using the old "site" object pattern temporarily. This is NOT a long-term solution - update services to accept router objects directly.

**Current services still expecting site object:**

- `mikrotikService.testConnection(site)`
- `mikrotikService.updatePPPoEPassword(site, ...)`
- `mikrotikService.endSession(site, ...)`
- `mikrotikService.getConnection(site)`

**Future improvement:** Refactor these services to accept router objects directly instead of site objects.
