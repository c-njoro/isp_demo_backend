# System Architecture Audit - Router-Based Changes

## Critical Issues Found ⚠️

### 1. **BROKEN: cron/pauseAccounts.js** 🔴 CRITICAL
**File**: `/home/njoro/work/isp_anagement/ISP_BACKEND/cron/pauseAccounts.js`  
**Line**: 23  
**Issue**: Calls `mikrotikService.testConnection(site)` but site object no longer has router property

```javascript
// BROKEN - Line 23
const testResult = await mikrotikService.testConnection(site);
// ❌ site doesn't have .router anymore!

// EXPECTED
const router = await Router.findOne({ site: site._id, isPrimary: true });
if (router) {
  const siteObj = buildSiteLikeObjectFromRouter(router);
  const testResult = await mikrotikService.testConnection(siteObj);
}
```

**Impact**: Site health checks will crash when trying to test connectivity  
**Fix**: ✋ Need to update cron job to fetch router from Router model

---

### 2. **BROKEN: mikrotikAutoconfigurationController.js** 🔴 CRITICAL  
**File**: `/home/njoro/work/isp_anagement/ISP_BACKEND/controllers/mikrotikAutoconfigurationController.js`  
**Line**: 443  
**Issue**: Tries to access `site.router.ip` which doesn't exist

```javascript
// BROKEN - Line 443
const nasResult = await radiusService.registerNas(
  site.router.ip,  // ❌ site has no .router property
  process.env.RADIUS_SECRET,
  site.siteName
);

// SHOULD BE
const primaryRouter = await Router.findOne({ site: site._id, isPrimary: true });
const nasResult = await radiusService.registerNas(
  primaryRouter.ip,
  process.env.RADIUS_SECRET,
  site.siteName
);
```

**Impact**: Mikrotik/RADIUS configuration will fail when setting up sites  
**Fix**: ✋ Add Router model and get primary router

---

### 3. **BROKEN: routerController.js** 🔴 CRITICAL  
**File**: `/home/njoro/work/isp_anagement/ISP_BACKEND/controllers/routerController.js`  
**Line**: 464  
**Issue**: Calls `radiusService.registerNas()` with wrong signature (object instead of arguments)

```javascript
// BROKEN - Line 464
const nasResult = await radiusService.registerNas({
  nasname: router.ip,
  shortname: router.site.name + '-' + router.name,
  secret: radiusSecret,
  type: 'mikrotik'
});
// ❌ registerNas expects: (nasIp, secret, shortName)

// SHOULD BE
const nasResult = await radiusService.registerNas(
  router.ip,
  radiusSecret,
  router.site.name + '-' + router.name
);
```

**Impact**: NAS registration in RADIUS will fail  
**Fix**: ✋ Correct function call signature

---

### 4. **QUESTIONABLE: scripts/createSecret.js** 🟡 ISSUE  
**File**: `/home/njoro/work/isp_anagement/ISP_BACKEND/scripts/createSecret.js`  
**Line**: 30  
**Issue**: Calls `mikrotikService.getConnection()` with individual parameters instead of site object

```javascript
// CURRENT - Line 30
const client = await mikrotikService.getConnection(
  site.router.ip,
  site.router.username,
  site.router.password,
  site.router.apiType
);
// ❌ getConnection expects a site object, not individual params

// SHOULD BE
const client = await mikrotikService.getConnection(site);
```

**Impact**: Test scripts won't work (minor - not production code)  
**Fix**: ✋ Wrap parameters in site-like object

---

### 5. **MISSING: paymentController.js** 🟡 MINOR  
**File**: `/home/njoro/work/isp_anagement/ISP_BACKEND/controllers/paymentController.js`  
**Lines**: 1198, 1338  
**Issue**: Commented-out code but needs update when uncommented

```javascript
// COMMENTED but when uncommented will be BROKEN:
// const mikroticResult = await mikroticService.endSession(site, sourceCustomer.pppoe.username);
// ❌ site doesn't have .router anymore

// SHOULD BE when uncommented:
const router = await getRouterForCustomer(sourceCustomer, false);
if (router) {
  const siteObj = buildSiteLikeObjectFromRouter(router);
  const mikroticResult = await mikroticService.endSession(siteObj, sourceCustomer.pppoe.username);
}
```

**Impact**: Only if payment reversal logic is activated  
**Fix**: ✋ Low priority but should fix when uncommenting

---

## Services Compatibility Status ✅/🔴

### radiusService.js ✅ COMPATIBLE
- `registerNas(nasIp, secret, shortName)` - **GOOD** - takes nasIp directly (not site)
- `getConnection()` - **GOOD** - doesn't need site
- All other methods - **GOOD** - operate on username/account, not site

### mikrotikService.js 🔴 NEEDS UPDATES
- `testConnection(site)` - **NEEDS site.router.ip** - works if passed buildSiteLikeObjectFromRouter() result
- `_getConnection(site)` - **NEEDS site.router.ip** - works if passed site-like object
- `endSession(site, username)` - **NEEDS site.router.ip** - works if passed site-like object
- `updatePPPoEPassword(site, username, password)` - **NEEDS site.router.ip** - works if passed site-like object

**Summary**: mikrotikService methods still expect site objects with `.router` property. Current workaround uses `buildSiteLikeObjectFromRouter()` but this is not ideal.

---

## Dependency Chain Analysis

### Functions That Call Broken Code:
1. **pauseAccounts.js** calls `mikrotikService.testConnection(site)`
   - Called by: Cron job (automatic)
   - Frequency: Every 10 minutes
   - Status: **🔴 BREAKS IMMEDIATELY**

2. **mikrotikAutoconfigurationController.js** uses `site.router.ip`
   - Called by: API endpoint for RADIUS configuration
   - Frequency: On-demand (when admin sets up site)
   - Status: **🔴 BREAKS WHEN SETTING UP NEW SITE**

3. **routerController.js** calls `radiusService.registerNas({...})`
   - Called by: API endpoint for router setup
   - Frequency: On-demand (when adding router to site)
   - Status: **🔴 BREAKS WHEN CONFIGURING ROUTER**

---

## Impact Assessment

### Severity Levels:

| Issue | Severity | Component | User Impact |
|-------|----------|-----------|------------|
| pauseAccounts cron | **CRITICAL** | System automation | 🔴 Site health checks crash every 10 min |
| mikrotikAutoconfig | **CRITICAL** | Initial setup | 🔴 Cannot setup sites with RADIUS |
| routerController | **HIGH** | Router management | 🔴 Cannot register routers in RADIUS |
| createSecret script | **LOW** | Dev/test tool | 🟡 Dev scripts fail (non-prod) |
| paymentController | **MEDIUM** | Payment reversal | 🟡 Feature unusable if enabled |

---

## What Still Works ✅

1. **Customer creation** - ✅ Uses new `getPrimaryRouterForSite()` helper
2. **Customer password change** - ✅ Uses `getRouterForCustomer()` helper
3. **Customer CPE updates** - ✅ Uses `getRouterForCustomer()` helper
4. **Customer migration** - ✅ Uses `getPrimaryRouterForSite()` helper
5. **Customer reactivation** - ✅ Uses `getRouterForCustomer()` helper
6. **RADIUS operations** - ✅ Don't depend on site object
7. **Customer suspension** - ✅ Only uses RADIUS (no Mikrotik dependency)

---

## Root Cause Analysis

The migration was **incomplete**:

1. ✅ **customerController.js** - Updated correctly
2. ❌ **All other controllers** - Still assume `site.router.ip` exists
3. ❌ **Cron jobs** - Not updated to use Router model
4. ❌ **Test scripts** - Not updated

**Why this happened**: Only customerController was refactored. Other files that use sites/routers were not audited or updated.

---

## Migration Checklist - What Still Needs Fixing

### URGENT (Do Immediately)
- [ ] Fix `cron/pauseAccounts.js` line 23 - fetch primary router
- [ ] Fix `mikrotikAutoconfigurationController.js` line 443 - get router IP from Router model
- [ ] Fix `routerController.js` line 464 - use correct registerNas signature

### IMPORTANT (Do Soon)  
- [ ] Fix `scripts/createSecret.js` line 30 - pass site-like object to getConnection
- [ ] Update `paymentController.js` lines 1198, 1338 - prepare for uncommenting

### NICE TO HAVE (Future)
- [ ] Refactor mikrotikService to accept router objects directly instead of site objects
- [ ] Remove buildSiteLikeObjectFromRouter() wrapper (temporary backward compat)
- [ ] Audit all other controllers for site.router usage

---

## Code Examples for Each Fix

### Fix #1: pauseAccounts.js
```javascript
// BEFORE (Line 23)
const testResult = await mikrotikService.testConnection(site);

// AFTER
const Router = require('../models/Router');
const primaryRouter = await Router.findOne({ site: site._id, isPrimary: true });
if (primaryRouter) {
  const siteObj = {
    router: {
      ip: primaryRouter.ip,
      username: primaryRouter.username,
      password: primaryRouter.password
    },
    siteName: site.siteName
  };
  const testResult = await mikrotikService.testConnection(siteObj);
  currentSuccess = testResult.success;
}
```

### Fix #2: mikrotikAutoconfigurationController.js
```javascript
// BEFORE (Line 443)
const nasResult = await radiusService.registerNas(site.router.ip, process.env.RADIUS_SECRET, site.siteName);

// AFTER
const Router = require('../models/Router');
const primaryRouter = await Router.findOne({ site: site._id, isPrimary: true });
if (!primaryRouter) {
  return next(new ErrorResponse('No primary router configured for this site', 400));
}
const nasResult = await radiusService.registerNas(primaryRouter.ip, process.env.RADIUS_SECRET, site.siteName);
```

### Fix #3: routerController.js
```javascript
// BEFORE (Line 464)
const nasResult = await radiusService.registerNas({
  nasname: router.ip,
  shortname: router.site.name + '-' + router.name,
  secret: radiusSecret,
  type: 'mikrotik'
});

// AFTER
const nasResult = await radiusService.registerNas(
  router.ip,
  radiusSecret,
  router.site.name + '-' + router.name
);
```

### Fix #4: scripts/createSecret.js
```javascript
// BEFORE (Line 30)
const client = await mikrotikService.getConnection(
  site.router.ip,
  site.router.username,
  site.router.password,
  site.router.apiType
);

// AFTER
const site = {
  router: {
    ip: '192.168.88.1',
    username: 'api_user',
    password: 'api1234',
    apiType: 'api'
  },
  siteName: 'Test Site'
};
const client = await mikrotikService.getConnection(site);
```

---

## Testing Recommendations

After each fix:
1. **pauseAccounts.js** - Run cron manually: `node cron/pauseAccounts.js`
2. **mikrotikAutoconfigurationController.js** - Test via API: POST `/api/sites/:id/configure-radius`
3. **routerController.js** - Test via API: POST `/api/routers/:id/configure`
4. **Check RADIUS** - Verify NAS is registered: `radclient -c /etc/raddb/clients.conf status 127.0.0.1:1812`

---

## Files Needing Audit

Search these for `site.router` pattern:
- [ ] `controllers/siteController.js`
- [ ] `controllers/routerController.js` ✋ Already found issues
- [ ] `controllers/mikrotikAutoconfigurationController.js` ✋ Already found issues
- [ ] `services/siteAutomation.js` - Check suspendCustomersForSite function
- [ ] `cron/connectionStatusCron.js`
- [ ] `cron/expiryAndRenew.js`
- [ ] Any route that calls these controllers

