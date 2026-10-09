const express = require('express');
const { cariMusik } = require('../controllers/musicController');

const router = express.Router();

// GET /api/music/search — cari lagu (publik). Ikut globalLimiter yang dipasang
// di src/index.js SEBELUM route dipasang, jadi otomatis 100 req/15 menit/IP —
// endpoint ini tidak bisa dipakai membanjir YouTube dari IP server.
router.get('/search', cariMusik);

module.exports = router;
