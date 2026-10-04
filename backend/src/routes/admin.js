const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  getAllMenfes,
  approveMenfes,
  rejectMenfes,
  deleteMenfes,
  getStats,
  postMenfesToInstagram,
  retryMenfes,
} = require('../controllers/adminController');

const router = express.Router();

// ─── Parser gambar untuk unggahan Instagram ───────────────────────────────────
//
// Parser ini sengaja TIDAK dipasang di router, dan src/index.js memasang path
// terkait secara langsung dengan urutan auth lalu parser. Alasannya urutan, dan
// urutannya tidak bisa ditebak:
//
//   express.json() dan express.raw() sama-sama melompat kalau request sudah
//   diparse; body-parser mengecek req._body sebelum membaca body. Di antara
//   keduanya, yang dipasang lebih dulu yang menang. Body parser global 1 MB di
//   src/index.js dipasang lebih dulu, jadi parser 8 MB yang menempel di router
//   ini tidak akan pernah dipanggil: request gambar mentok 1 MB sudah ditolak
//   global dengan 413, dan parser besar tidak pernah dipanggil sama sekali.
//
//   src/index.js karena itu memasang app.post() untuk path ini, dengan
//   authMiddleware DI DAHULU parser gambar. Dua hal yang membuat urutan itu
//   penting:
//
//   - Tanpa auth di depan, siapa pun bisa memaksa server membaca 8 MB tanpa
//     batas. globalLimiter juga dipasang setelah body parser, jadi tidak ada
//     pembatas lain yang aktif sebelum body dibaca.
//   - type dibatasi ke multipart/form-data, jadi request dengan Content-Type
//     lain tidak disentuh parser ini dan tidak ada jalur untuk membuat server
//     membaca body besar tanpa bentuk multipart yang jelas.
//
// authMiddleware tetap dipasang di router juga, jadi baris di bawah bukan
// Pengganti melainkan pengaman kalau ada route admin baru yang lupa.
// Batas parser ini LEBIH BESAR dari batas gambar di igPublish (8 MB), dan itu
// disengaja.
//
// Dua alasan, keduanya soal pengalaman admin:
//
//  1. Body multipart selalu lebih besar daripada filenya sendiri, karena ada
//     boundary dan header per bagian. Kalau batas parser ikut disamakan dengan
//     batas gambar, gambar yang tepat di batas sah akan ditolak 413 oleh
//     body-parser, bukan lolos ke validasi.
//
//  2. Di atas batas gambar, pesan yang sampai ke admin jauh lebih berguna kalau
//     berasal dari periksaGambar: "Gambar 9.0 MB, batas 8 MB." Bandingkan
//     dengan "request entity too large" milik body-parser.
//
// Parser ini tetap jadi penutup terakhir untuk request gila, bukan pengganti
// validasi.
const BATAS_BODY = '10mb';
const parserGambar = express.raw({
  type: 'multipart/form-data',
  limit: BATAS_BODY,
});

// Semua route admin butuh JWT
router.use(authMiddleware);

// GET /api/admin/stats — Statistik dashboard
router.get('/stats', getStats);

// GET /api/admin/menfes — Ambil semua menfes (dengan filter status)
router.get('/menfes', getAllMenfes);

// PATCH /api/admin/menfes/:id/approve — Approve menfes
router.patch('/menfes/:id/approve', approveMenfes);

// PATCH /api/admin/menfes/:id/reject — Reject menfes
router.patch('/menfes/:id/reject', rejectMenfes);

// PATCH /api/admin/menfes/:id/retry — Reset fields publikasi Instagram
router.patch('/menfes/:id/retry', retryMenfes);

// DELETE /api/admin/menfes/:id — Hapus menfes
router.delete('/menfes/:id', deleteMenfes);

// Route publikasi Instagram (/menfes/:id/post) TIDAK didefinisikan di sini.
// Dipasang di src/index.js sebelum body parser global, dengan urutan auth lalu
// parser gambar. Kalau route itu didefinisikan di sini juga, yang di sini tidak
// akan pernah dipanggil, dan Kalau registrasi di index.js terhapus, admin akan
// melihat 500 mysterious sebagai pengganti 404 yang jujur.
//
// Dipakai src/index.js: parserGambar dan handler-nya.
module.exports = router;
module.exports.parserGambar = parserGambar;
module.exports.postMenfesToInstagram = postMenfesToInstagram;
module.exports.retryMenfes = retryMenfes;
