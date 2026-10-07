const express = require('express');
const rateLimit = require('express-rate-limit');
const { submitMenfes, getApprovedMenfes } = require('../controllers/menfesController');

const router = express.Router();

// Rate limit submit menfes — per IP, pengaturan lewat env.
//
// CATATAN PENTING SOAL NILAI YANG DIMASUKKAN:
//
// express-rate-limit memakai MemoryStore, yaitu in-memory per-process.
// Kalau aplikasi berjalan di lebih dari satu instance (Render menjalankan
// 2 instance saat trafik naik), setiap instance punya hitungan sendiri
// sehingga limit EFEKTIF menjadi max x jumlah-instance.
//
// Di produksi terverifikasi: max=5 dengan 2 instance -> 10 request lolos.
// Gejalanya: header X-RateLimit-Remaining naik lagi dari 0 ke 1 di tengah
// window, dan request #1,#3,#5,#7,#11 dilayani instance A sementara
// #2,#4,#6,#8,#13 dilayani instance B — masing-masing tepat 5.
//
// Jadi angka di bawah perlu dibagi jumlah instance. Nilai 3 dipilih supaya
// limit efektif ~6 pada 2 instance (angka ini sudah dibaca dari env, jadi
// bisa diturunkan tanpa menyentuh kode kalau spam benar-benar masuk).
//
// Fix yang sebenarnya adalah shared store (Redis), yang bisa dipakai
// banyak instance sekaligus. Itu butuh dependency + biaya, belum dilakukan.
const SUBMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const SUBMIT_MAX = Number(process.env.RATE_LIMIT_MAX_SUBMIT) || 3;

// Jangan pakai X-Forwarded-For mentah: header itu dikontrol client dan bisa
// dipalsukan tiap request untuk lolos dari limit. Dengan 'trust proxy' yang
// diset di src/index.js, req.ip sudah memperhitungkan proxy di depan, dan
// bagian paling kanan XFF adalah IP asli dari proxy — bukan pilihan client.
const submitLimiter = rateLimit({
  windowMs: SUBMIT_WINDOW_MS,
  max: SUBMIT_MAX,
  message: { error: 'Terlalu banyak pengiriman. Coba lagi dalam 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/menfes — Ambil menfes approved (publik)
router.get('/', getApprovedMenfes);

// Parser multipart untuk submit BERTAMPILAN FOTO. Sama tekniknya dengan
// parserGambar di routes/admin.js: express.raw mengambil byte mentah (limit
// 6MB = foto 5MB + sisa overhead form), lalu submitMenfes mengurai body itu
// dengan Response.formData() bawaan Node — tanpa dependensi multer/busboy.
//
// Request JSON biasa TIDAK disentuh parser ini (type-nya multipart), jadi
// jalur submit lama tanpa foto tetap utuh.
const parserFoto = express.raw({
  type: 'multipart/form-data',
  limit: '6mb',
});

// POST /api/menfes — Kirim menfes baru (publik). Foto opsional: lewati
// parserFoto kalau badannya JSON.
router.post('/', submitLimiter, parserFoto, submitMenfes);

module.exports = router;
