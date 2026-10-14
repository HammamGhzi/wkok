const prisma = require('../lib/prisma');

// ── Status buka/tutup menfess untuk publik ────────────────────────────────────
//
// Fitur ini punya dua bagian yang sengaja dipisah:
//
//   1. JADWAL (konstanta JADWAL di bawah) — kini sumber kebenaran GANDA:
//      menentukan buka/tutup otomatis pada mode 'auto' DAN ditampilkan ke
//      user sebagai informasi "jam buka" (lewat JAM_BUKA yang di-derive
//      dari jadwal yang sama). Satu data, dua keperluan — tampilan dan
//      perilaku tidak mungkin berbeda. Tidak disimpan di database supaya
//      tidak ada dua sumber kebenaran.
//
//   2. SAKELAR (baris SiteSetting di database, field `mode`):
//      'auto'  — bawaan; buka/tutup ikut jadwal WIB, tanpa campur tangan admin.
//      'buka'  — admin memaksa buka; menang atas jadwal sampai admin sendiri
//                mengembalikan ke 'auto'.
//      'tutup' — admin memaksa tutup; menang atas jadwal sampai admin sendiri
//                mengembalikan ke 'auto'.
//
// Status dihitung saat request dibaca (bukan lewat cron): endpoint status
// memang dipoll halaman user tiap 60 detik, jadi perpindahan buka/tutup
// otomatis muncul sendiri tanpa proses terjadwal.

// Jadwal dalam WIB. Batas awal termasuk, batas akhir tidak (10.00 = sudah tutup).
const JADWAL = [
  { buka: '08:00', tutup: '10:00' },
  { buka: '12:00', tutup: '14:00' },
  { buka: '16:00', tutup: '21:00' },
];

const keMenit = (jam) => {
  const [h, m] = jam.split(':').map(Number);
  return h * 60 + m;
};

// Bentuk tampilan untuk publik: '08.00 – 10.00', dst.
const JAM_BUKA = JADWAL.map((s) => `${s.buka.replace(':', '.')} – ${s.tutup.replace(':', '.')}`);

/**
 * Menit sejak tengah malam WIB untuk sebuah waktu.
 * Server produksi berjalan di UTC, sedangkan jadwal dalam WIB (UTC+7) —
 * jadi jamnya dikonversi dulu tanpa library timezone (cukup jam+7 % 24).
 */
function menitWib(sekarang = new Date()) {
  return ((sekarang.getUTCHours() + 7) % 24) * 60 + sekarang.getUTCMinutes();
}

/**
 * Apakah menit WIB ini berada di dalam salah satu slot jadwal.
 * Murni dan tanpa waktu nyata — supaya bisa diuji dengan jam tetap.
 */
function diJadwal(menit) {
  return JADWAL.some((s) => menit >= keMenit(s.buka) && menit < keMenit(s.tutup));
}

/**
 * Terjemahkan baris SiteSetting menjadi buka/tutup.
 * Belum ada baris = belum pernah diset = perilaku bawaan 'auto' (ikut jadwal).
 */
function hitungOpen(baris) {
  if (!baris) return diJadwal(menitWib());
  if (baris.mode === 'buka') return true;
  if (baris.mode === 'tutup') return false;
  return diJadwal(menitWib());
}

async function bacaBaris() {
  return prisma.siteSetting.findUnique({ where: { id: 'utama' } });
}

/**
 * Baca status akhir. Dipakai dua tempat: endpoint status publik dan guard
 * submit — keduanya HARUS melihat hal yang sama, termasuk override admin.
 * Sengaja TIDAK di-cache — barisnya cuma satu, bolt ke database hampir gratis,
 * dan hasilnya harus langsung terlihat begitu admin menekan toggle (termasuk
 * dari instance Render yang lain). Mode 'auto' ikut terhitung ulang tiap
 * baca, jadi batas jadwal tidak menunggu cache kedaluwarsa.
 */
async function statusBuka() {
  return hitungOpen(await bacaBaris());
}

/**
 * GET /api/site/status (publik, tanpa auth)
 * Halaman user memanggil ini saat mount dan tiap 60 detik, supaya layar
 * tutup/terbuka ikut berubah tanpa reload. `mode` ikut dikirim supaya
 * dashboard admin bisa menampilkan posisi sakelar sekarang.
 */
async function getStatusSite(req, res) {
  try {
    const baris = await bacaBaris();
    res.json({
      open: hitungOpen(baris),
      mode: baris ? baris.mode : 'auto',
      jamBuka: JAM_BUKA,
    });
  } catch (err) {
    console.error('Get status situs error:', err);
    res.status(500).json({ error: 'Gagal membaca status menfess.' });
  }
}

/**
 * PATCH /api/admin/site (wajib login admin — dipasang di routes/admin.js
 * yang memasang authMiddleware di semua rutenya)
 *
 * Tubuh (dua bentuk diterima):
 *   { mode: 'auto' | 'buka' | 'tutup' }  — bentuk utama, sakelar tiga posisi
 *   { open: boolean }                    — bentuk lama (dashboard lama yang
 *                                           belum ke-refresh): true -> 'buka',
 *                                           false -> 'tutup'
 *
 * Upsert supaya toggle pertama kali membuat baris.
 */
async function setSiteOpen(req, res) {
  try {
    const { mode, open } = req.body || {};
    let modeAkhir;

    if (mode !== undefined) {
      if (!['auto', 'buka', 'tutup'].includes(mode)) {
        return res.status(400).json({
          error: "Mode harus salah satu dari 'auto', 'buka', atau 'tutup'.",
        });
      }
      modeAkhir = mode;
    } else if (typeof open === 'boolean') {
      modeAkhir = open ? 'buka' : 'tutup';
    } else {
      return res.status(400).json({
        error: 'Field open (boolean) atau mode (auto/buka/tutup) wajib diisi.',
      });
    }

    await prisma.siteSetting.upsert({
      where: { id: 'utama' },
      update: { mode: modeAkhir },
      create: { id: 'utama', mode: modeAkhir },
    });

    const baris = await bacaBaris();
    res.json({ mode: modeAkhir, open: hitungOpen(baris) });
  } catch (err) {
    console.error('Set status situs error:', err);
    res.status(500).json({ error: 'Gagal mengubah status menfess.' });
  }
}

module.exports = { getStatusSite, setSiteOpen, statusBuka, JAM_BUKA, diJadwal, menitWib };
