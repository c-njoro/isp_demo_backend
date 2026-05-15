const express = require('express');
const router = express.Router();
const {
  getRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions
} = require('../controllers/roleController');
const { protect, adminOnly } = require('../middleware/auth');

router.use(protect);
router.use(adminOnly);

router.route('/').get(getRoles).post(createRole);
router.route('/:id').get(getRole).put(updateRole).delete(deleteRole);
router.get('/:id/permissions', getRolePermissions);

module.exports = router;