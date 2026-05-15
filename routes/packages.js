const express = require('express');
const router = express.Router();
const {
  getPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
  getPackageCustomers
} = require('../controllers/packageController');
const { protect, applyRegionFilter } = require('../middleware/auth');

router.use(protect);
router.use(applyRegionFilter);

router.route('/').get(getPackages).post(createPackage);
router.route('/:id').get(getPackage).put(updatePackage).delete(deletePackage);
router.get('/:id/customers', getPackageCustomers)

module.exports = router;