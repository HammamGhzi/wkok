const express = require('express');
const { submitMenfes, getApprovedMenfes } = require('../controllers/menfesController');

const router = express.Router();

// Rate limit submit menfes ditangani langsung di controller (cek database),
// bukan di sini dengan MemoryStore. Alasannya:
// - MemoryStore tidak akurat di multi-instance (tiap instance hitung sendiri)
// - Window sliding dari request pertama, bukan reset tengah malam
// - Cek database jauh lebih akurat dan konsisten lintas instance

// GET /api/menfes — Ambil menfes approved (publik)
router.get('/', getApprovedMenfes);

// Parser multipart untuk submit BERTAMPILAN FOTO DAN/ATAU VIDEO. Sama tekniknya
// dengan parserGambar di routes/admin.js: express.raw mengambil byte mentah
// (limit 50MB = 4 foto 5MB + video 25MB + sisa overhead form), lalu submitMenfes
// mengurai body itu dengan Response.formData() bawaan Node — tanpa dependensi
// multer/busboy.
//
// Request JSON biasa TIDAK disentuh parser ini (type-nya multipart), jadi
// jalur submit lama tanpa lampiran tetap utuh.
const parserFoto = express.raw({
  type: 'multipart/form-data',
  limit: '50mb',
});

// POST /api/menfes — Kirim menfes baru (publik). Lampiran opsional: lewati
// parserFoto kalau badannya JSON.
router.post('/', parserFoto, submitMenfes);

module.exports = router;
