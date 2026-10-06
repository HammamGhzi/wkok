const express = require('express');
const { getStatusSite } = require('../controllers/siteController');

const router = express.Router();

// GET /api/site/status — Status buka/tutup menfess (publik)
router.get('/status', getStatusSite);

module.exports = router;
