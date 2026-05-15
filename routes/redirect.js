const express = require('express');
const router = express.Router();


const { handleRedirect } = require('../controllers/redirectController');


router.get('/expired/:siteId', handleRedirect);

module.exports = router;