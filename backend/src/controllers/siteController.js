const prisma = require('../lib/prisma');

// ── Status buka/tutup menfess untuk publik ────────────────────────────────────
//
// Fitur ini punya dua bagian yang sengaja dipisah:
//
//   1. JADWAL (konstanta di bawah) — statis, cuma ditampilkan ke user sebagai
//      informasi "jam buka". Tidak disimpan di database supaya tidak ada dua
//      sumber kebenaran yang bisa berbeda.
//
//   2. SAKELAR (baris SiteSetting di database) — satu-satunya yang menentukan
//      apakah publik bisa mengirim saat ini. Admin yang menekan, bukan jam.
//
// Karena sakelar manual, tidak ada satu pun kode di sini yang membaca jam:
// tidak ada perhitungan timezone, tidak ada yang berubah sendiri tengah malam.
const JAM_BUKA = ['08.00 – 10.00', '12.00 – 14.00', '16.00 – 21.00'];

/**
 * Baca sakelar. Dipakai dua tempat: endpoint status publik dan guard submit.
 * Sengaja TIDAK di-cache — barisnya cuma satu, bolt ke database hampir gratis,
 * dan hasilnya harus langsung terlihat begitu admin menekan toggle (termasuk
 * dari instance Render yang lain).
 */
async function statusBuka() {
  const baris = await prisma.siteSetting.findUnique({ where: { id: 'utama' } });
  // Baris belum ada = belum pernah diset = terbuka. Deploy pertama fitur ini
  // tidak boleh menutup situs diam-diam sebelum admin sempat menekan apa pun.
  return baris ? baris.isOpen : true;
}

/**
 * GET /api/site/status (publik, tanpa auth)
 * Halaman user memanggil ini saat mount dan tiap 60 detik, supaya layar
 * tutup/terbuka ikut berubah tanpa reload.
 */
async function getStatusSite(req, res) {
  try {
    res.json({ open: await statusBuka(), jamBuka: JAM_BUKA });
  } catch (err) {
    console.error('Get status situs error:', err);
    res.status(500).json({ error: 'Gagal membaca status menfess.' });
  }
}

/**
 * PATCH /api/admin/site (wajib login admin — dipasang di routes/admin.js
 * yang memasang authMiddleware di semua rutenya)
 * Tubuh: { open: boolean }. Upsert supaya toggle pertama kali membuat baris.
 */
async function setSiteOpen(req, res) {
  try {
    const { open } = req.body;
    if (typeof open !== 'boolean') {
      return res.status(400).json({ error: 'Field open harus boolean.' });
    }

    await prisma.siteSetting.upsert({
      where: { id: 'utama' },
      update: { isOpen: open },
      create: { id: 'utama', isOpen: open },
    });

    res.json({ open });
  } catch (err) {
    console.error('Set status situs error:', err);
    res.status(500).json({ error: 'Gagal mengubah status menfess.' });
  }
}

module.exports = { getStatusSite, setSiteOpen, statusBuka, JAM_BUKA };
