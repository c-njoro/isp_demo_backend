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
  configureSystemScripts
} = require('../controllers/routerController');

// All router operations require authentication and admin rights
router.use(protect, adminOnly);

// CRUD
router.route('/')
  .get(getRouters)
  .post(createRouter);

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

module.exports = router;