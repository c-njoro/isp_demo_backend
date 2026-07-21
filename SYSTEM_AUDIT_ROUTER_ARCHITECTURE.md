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




[admin@MUGUGA KALRO] > export
# 2026-05-16 12:58:02 by RouterOS 7.14
# software id = RXXW-W5LI
#
# model = RB4011iGS+
# serial number = HGH09Y4VQ87
/interface bridge
add comment="Auto-created by ISP system" name=bridge-pppoe
add name=bridgeWAN
/interface ethernet
set [ find default-name=ether3 ] auto-negotiation=no
set [ find default-name=sfp-sfpplus1 ] auto-negotiation=no speed=1G-baseX
/interface vlan
add interface=bridge-pppoe name=ONU_MANAGEMENT_VLAN vlan-id=1170
add interface=bridge-pppoe name=SERVICE_VLAN vlan-id=1171
add comment="UPLINK B" interface=bridgeWAN name=vlan248 vlan-id=248
add comment=UPLINK interface=bridgeWAN name=vlan521 vlan-id=521
add comment="UPLINK B" disabled=yes interface=sfp-sfpplus1 name=vlan865 vlan-id=865
/ip pool
add name=onu_test ranges=10.10.10.11-10.10.10.22
add name=dhcp_pool1 ranges=172.16.0.2-172.16.15.254
add name=pppoe-pool ranges=10.254.0.10-10.254.255.255
add name=vpn_pool ranges=192.168.89.2-192.168.89.6
add name=dhcp_pool5 ranges=192.168.16.2-192.168.16.5
add comment=Auto-created name=active-pool ranges=10.114.0.2-10.114.255.254
add comment="Expired users" name=expired-pool ranges=10.254.254.2-10.254.254.254
add comment="Wrong password" name=credential-pool ranges=20.20.0.2-20.20.255.254
add comment="Non-existent user" name=non-existent ranges=30.30.0.2-30.30.255.254
add comment="MAC mismatch" name=mac-difference ranges=40.40.0.2-40.40.255.254
/ip dhcp-server
add address-pool=dhcp_pool1 interface=ONU_MANAGEMENT_VLAN name=dhcp1
add address-pool=dhcp_pool5 interface=ether4 name=dhcp2
/port
set 0 name=serial0
set 1 name=serial1
/ppp profile
set *0 dns-server=8.8.8.8 local-address=192.168.89.1 remote-address=vpn_pool
add local-address=10.10.10.10 name=onu_test remote-address=onu_test
add change-tcp-mss=yes name=ovpn use-encryption=yes
add dns-server=8.8.8.8,8.8.4.4 local-address=10.254.0.1 name=ppp remote-address=pppoe-pool
add change-tcp-mss=yes name=OVPN-SmartOLT only-one=yes use-encryption=required use-mpls=no
add comment=Auto-created dns-server=8.8.8.8,8.8.4.4 local-address=10.114.0.1 name=radius-profile only-one=yes \
    remote-address=active-pool use-encryption=no
/interface ovpn-client
add certificate=172.19.3.89 cipher=aes256-cbc connect-to=vpn.one-isp.net disabled=yes mac-address=FE:02:A8:DE:73:16 name=\
    "One ISP OVPN" profile=ovpn use-peer-dns=no user=172.19.3.89
add certificate=SmartOLT-Client cipher=aes256-cbc connect-to=skylinknetworks.smartolt.com mac-address=FE:01:DE:CD:C6:4C \
    name=SmartOLT-VPN port=16037 profile=OVPN-SmartOLT user=tunnel1@skylinknetworks.smartolt.com verify-server-certificate=\
    yes
/interface bridge port
add bridge=bridgeWAN interface=sfp-sfpplus1
add bridge=bridgeWAN interface=ether1
add bridge=bridgeWAN interface=ether7
add bridge=bridge-pppoe interface=ether3
/ip neighbor discovery-settings
set discover-interface-list=!dynamic
/interface pppoe-server server
add authentication=pap default-profile=ppp interface=SERVICE_VLAN keepalive-timeout=30 max-mru=1492 max-mtu=1492 mrru=1600 \
    one-session-per-host=yes service-name=oneISP_PPPoE
add authentication=pap default-profile=radius-profile disabled=no interface=SERVICE_VLAN max-mru=1492 max-mtu=1492 mrru=\
    1600 one-session-per-host=yes service-name=pppoe-server
/interface pptp-server server
# PPTP connections are considered unsafe, it is suggested to use a more modern VPN protocol instead
set authentication=chap,mschap1,mschap2 enabled=yes
/ip address
add address=102.210.40.6/30 comment="INTERNET UPLINK" interface=vlan521 network=102.210.40.4
add address=192.168.1.1/24 interface=ether2 network=192.168.1.0
add address=172.16.0.1/20 interface=ONU_MANAGEMENT_VLAN network=172.16.0.0
add address=172.30.1.1/24 interface=SERVICE_VLAN network=172.30.1.0
add address=102.210.41.242 comment="UPLINK B" disabled=yes interface=vlan865 network=102.210.41.242
add address=192.168.16.1/24 comment=TEST interface=ether4 network=192.168.16.0
add address=102.210.42.66/30 interface=vlan248 network=102.210.42.64
add address=102.210.40.50/30 interface=vlan248 network=102.210.40.48
add address=192.168.22.1/24 interface=ether7 network=192.168.22.0
add address=10.114.0.1/16 comment="PPPoE gateway" interface=SERVICE_VLAN network=10.114.0.0
add address=10.254.254.1/24 comment="Expired users gateway" interface=SERVICE_VLAN network=10.254.254.0
add address=20.20.0.1/16 comment="Wrong password gateway" interface=SERVICE_VLAN network=20.20.0.0
add address=30.30.0.1/16 comment="Non-existent user gateway" interface=SERVICE_VLAN network=30.30.0.0
add address=40.40.0.1/16 comment="MAC mismatch gateway" interface=SERVICE_VLAN network=40.40.0.0
/ip dhcp-server network
add address=172.16.0.0/20 gateway=172.16.0.1
add address=192.168.16.0/24 gateway=192.168.16.1
/ip dns
set servers=8.8.8.8,8.8.4.4
/ip firewall address-list
add address=redirect.one-isp.net comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" list=OI_REDIRECT_IP
add address=10.254.0.0/16 list=ALLOWED_USERS
add address=10.255.0.0/16 list=DISABLED_USERS
add address=10.114.0.0/16 comment="Active PPPoE users" list=ALLOWED_USERS
add address=10.254.254.0/24 comment="Expired/Disabled users" list=DISABLED_USERS
add address=redirect.skylinknetworks.co.ke comment="Redirect host" list=OI_REDIRECT_IP
/ip firewall filter
add action=reject chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=!80,3346 protocol=tcp \
    reject-with=icmp-network-unreachable src-address-list=DISABLED_USERS
add action=accept chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=53 protocol=tcp \
    src-address-list=DISABLED_USERS
add action=accept chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=53 protocol=udp \
    src-address-list=DISABLED_USERS
add action=drop chain=forward comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" src-address-list=DISABLED_USERS
add action=accept chain=forward comment="Accept bridge-lan to WAN" in-interface=bridge-pppoe out-interface=ether2
add action=reject chain=forward comment=OI_EXPIRED_REJECT_NON_HTTP dst-port=!80,3346 protocol=tcp reject-with=\
    icmp-network-unreachable src-address-list=DISABLED_USERS
add action=accept chain=forward comment=OI_EXPIRED_ALLOW_DNS_TCP dst-port=53 protocol=tcp src-address-list=DISABLED_USERS
add action=accept chain=forward comment=OI_EXPIRED_ALLOW_DNS_UDP dst-port=53 protocol=udp src-address-list=DISABLED_USERS
add action=accept chain=forward comment=OI_EXPIRED_ALLOW_RADIUS dst-address=102.210.42.46 dst-port=3799 protocol=tcp \
    src-address-list=DISABLED_USERS
add action=drop chain=forward comment=OI_EXPIRED_DROP_OTHER src-address-list=DISABLED_USERS
/ip firewall nat
add action=accept chain=srcnat comment="SmartOLT-VPN traffic excluded from NAT" out-interface=SmartOLT-VPN
add action=masquerade chain=srcnat src-address=102.210.40.5
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-address=8.8.8.8 src-address-list=\
    DISABLED_USERS
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-address=8.8.4.4 src-address-list=\
    DISABLED_USERS
add action=redirect chain=dstnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-ports=3346
add action=dst-nat chain=dstnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-port=80 protocol=tcp \
    src-address-list=DISABLED_USERS to-addresses=13.245.222.41
add action=masquerade chain=srcnat comment="-- DON'T REMOVE ::: OI EXPIRED USERS --" disabled=yes dst-address-list=\
    OI_REDIRECT_IP src-address-list=DISABLED_USERS
add action=masquerade chain=srcnat src-address-list=ALLOWED_USERS
add action=masquerade chain=srcnat
add action=masquerade chain=srcnat comment=TEST src-address=192.168.16.0/24
add action=masquerade chain=srcnat comment="Masquerade for active-pool" src-address=10.114.0.0/16
add action=masquerade chain=srcnat comment="Masquerade WAN" out-interface=ether2
add action=masquerade chain=srcnat comment=OI_EXPIRED_MASQ_DNS1 dst-address=8.8.8.8 src-address-list=DISABLED_USERS
add action=masquerade chain=srcnat comment=OI_EXPIRED_MASQ_DNS2 dst-address=8.8.4.4 src-address-list=DISABLED_USERS
add action=dst-nat chain=dstnat comment=OI_EXPIRED_REDIRECT_HTTP dst-port=80 protocol=tcp src-address-list=DISABLED_USERS \
    to-addresses=102.210.40.178 to-ports=8081
add action=masquerade chain=srcnat comment=OI_EXPIRED_MASQ_REDIRECT_HOST dst-address-list=OI_REDIRECT_IP src-address-list=\
    DISABLED_USERS
add action=src-nat chain=srcnat comment=OI_EXPIRED_SRCNAT_REDIRECT_SERVER dst-address=102.210.40.178 dst-port=8081 \
    protocol=tcp src-address-list=DISABLED_USERS to-addresses=192.168.1.1
/ip proxy
set enabled=yes max-cache-size=none parent-proxy=0.0.0.0 port=3346 src-address=0.0.0.0
/ip proxy access
add action=redirect action-data=redirect.one-isp.net/pata-fiber/expired/172.19.3.89 dst-host=!*.one-isp.net
/ip route
add check-gateway=ping disabled=no distance=2 dst-address=0.0.0.0/0 gateway=102.210.40.5 pref-src="" routing-table=main \
    scope=30 suppress-hw-offload=no target-scope=10
add check-gateway=ping disabled=yes distance=2 dst-address=0.0.0.0/0 gateway=102.210.42.65 pref-src="" routing-table=main \
    scope=30 suppress-hw-offload=no target-scope=10
add disabled=no distance=1 dst-address=0.0.0.0/0 gateway=102.210.40.49 pref-src="" routing-table=main scope=30 \
    suppress-hw-offload=no target-scope=10
/ip service
set telnet disabled=yes
set ssh disabled=yes
set api-ssl disabled=yes
/ppp aaa
set interim-update=5m use-radius=yes
/ppp secret
add disabled=yes name=test profile=onu_test service=pppoe
add disabled=yes name=test1 profile=onu_test service=pppoe
add disabled=yes name=test2 service=pppoe
add disabled=yes name=123 profile=onu_test service=pppoe
add name=vpn
/radius
add address=102.210.40.178 comment="RADIUS for PPPoE" service=ppp
/radius incoming
set accept=yes
/system clock
set time-zone-name=Africa/Nairobi
/system identity
set name="MUGUGA KALRO"
/system note
set show-at-login=no
/system routerboard settings
set enter-setup-on=delete-key
/system scheduler
add comment="Clear PPPoE after boot" name=startup-clear-sessions on-event=clear-pppoe-on-startup policy=\
    ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup
/system script
add comment="Mark internet down" dont-require-permissions=no name=mark-down owner=admin policy=read,write,test source=\
    ":log info \"Internet down \96 flag set.\""
add comment="Restart PPPoE" dont-require-permissions=no name=restart-pppoe owner=admin policy=read,write,test source=\
    ":log info \"Internet restored \96 removing PPPoE sessions.\" ; /ppp active remove [find]"
add comment="Clear on boot" dont-require-permissions=no name=clear-pppoe-on-startup owner=admin policy=read,write,test \
    source=":delay 60s; /ppp active remove [find]; :log info \"Startup: cleared PPPoE sessions\""
/tool netwatch
add comment="Internet watchdog" down-script=mark-down host=8.8.8.8 interval=30s timeout=10s type=simple up-script=\
    restart-pppoe
[admin@MUGUGA KALRO] > 