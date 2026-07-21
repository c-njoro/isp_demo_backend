const express = require('express');
const router = express.Router();
const {
  getOlts,
  getOlt,
  createOlt,
  updateOlt,
  deleteOlt,
  testConnection,            // was testOltConnection
  getSystemInfo,             // new
  getPonPorts,               // new
  getOnus,                   // from OLT controller (ONUs on this OLT)
  getUnconfiguredOnus,       // new
  getOnuDetails,             // new
  findAvailablePort,         // was getAvailablePorts
  testCredentials,            // was testOltCredentials
  authorizeOnuSkylink
} = require('../controllers/oltController');
const { protect, applyRegionFilter, adminOnly } = require('../middleware/auth');

// All OLT routes require authentication and region filtering
router.use(protect);
router.use(applyRegionFilter);

// OLT CRUD operations
router.route('/')
  .get(getOlts)
  .post(adminOnly, createOlt);

router.route('/:id')
  .get(getOlt)
  .put(adminOnly, updateOlt)
  .delete(adminOnly, deleteOlt);

// OLT monitoring and status
router.get('/:id/test-connection', testConnection);               // test OLT reachability
router.get('/:id/system-info', getSystemInfo);                   // get hardware/software details
router.get('/:id/pon-ports', getPonPorts);                       // list PON ports with utilisation

// ONU management on this OLT
router.get('/:id/onus', getOnus);                                 // get ONUs (from DB or device)
router.get('/:id/unconfigured-onus', getUnconfiguredOnus);       // discover unprovisioned ONUs
router.get('/:id/onus/:ponPort/:onuId', getOnuDetails);          // detailed ONU info from device

// Port helpers
router.get('/:id/available-port', findAvailablePort);            // find best port for new ONU

// Credentials test (for onboarding)
router.post('/:id/authorize-skylink', adminOnly, authorizeOnuSkylink);
router.post('/test-credentials', adminOnly, testCredentials);



module.exports = router; 

// Note: The previous /stats endpoint has been removed – use /system-info instead.