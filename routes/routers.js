const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const {
  getRouters,
  getRouter,
  createRouter,
  updateRouter,
  deleteRouter,
  testRouterConnection,
  getRouterDiagnostics,
  getRouterInterfaces,
  getExistingConfig,
  getConfigurationStatus,
  createBridge,
  createIpPool,
  createPppoeServer,
  enableRadius,
  configureDisabledRedirect,
  configureSystemScripts,
  generateVpnConfig,
  downloadVpnConfig,
  getVpnStatus,
  revokeVpnConfig,
  getVpnSetupScript,
  getRouterTopology,
  getRouterBandwidth,
  getRouterBandwidthHistory,
  getRoutersForFilters
} = require('../controllers/routerController');

// All router operations require authentication and admin rights
router.use(protect);

// CRUD
router.route('/')
  .get(getRouters)
  .post(createRouter);

  router.get("/for-filters", getRoutersForFilters);

router.route('/:id')
  .get(getRouter)
  .put(updateRouter)
  .delete(deleteRouter);

// Test & diagnostics
router.post('/:id/test-connection', testRouterConnection);
router.get('/:id/diagnostics', getRouterDiagnostics);

// MikroTik configuration (all use routerId as parameter)
router.get('/:routerId/interfaces', getRouterInterfaces);
router.get('/:routerId/existing-config', getExistingConfig);
router.get('/:routerId/configuration-status', getConfigurationStatus);
router.post('/:routerId/bridge', createBridge);
router.post('/:routerId/ip-pool', createIpPool);
router.post('/:routerId/pppoe-server', createPppoeServer);
router.post('/:routerId/enable-radius', enableRadius);
router.post('/:routerId/configure-disabled-redirect', configureDisabledRedirect);
router.post('/:routerId/configure-system-scripts', configureSystemScripts);
router.post('/:id/vpn/generate',  protect, generateVpnConfig);
router.get('/:id/vpn/download',   protect, downloadVpnConfig);
router.get('/:id/vpn/status',     protect, getVpnStatus);
router.get('/:id/vpn/script',     protect, getVpnSetupScript);
router.delete('/:id/vpn',         protect, revokeVpnConfig);
router.get('/:routerId/topology', protect, getRouterTopology);
router.get('/:routerId/bandwidth', protect, getRouterBandwidth);
router.get('/:routerId/bandwidth/history',protect,  getRouterBandwidthHistory);

module.exports = router;