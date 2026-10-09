const { cariLagu } = require('../lib/ytmusic');

// Batas query & hasil sengaja kecil: pencarian hanya perlu membantu pengirim
// menemukan SATU lagu, bukan menjelajahi katalog.
const Q_MIN = 2;
const Q_MAKS = 100;
const HASIL_MAKS = 10;
const TIMEOUT_MS = 8000;

// Race melawan batas waktu supaya YouTube yang menggantung tidak menahan
// request sampai timeout axios di klien (10 detik) yang memutus duluan.
function kedaluwarsa(ms, pesan) {
  return new Promise((_, tolak) => {
    const t = setTimeout(() => tolak(new Error(pesan)), ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

/**
 * GET /api/music/search?q=...
 * Pencarian lagu untuk step musik di form menfess (publik, kena
 * globalLimiter di src/index.js — 100 request / 15 menit / IP).
 */
async function cariMusik(req, res) {
  const q = String(req.query.q || '').trim();
  if (q.length < Q_MIN) {
    return res.status(400).json({ error: `Kata kunci minimal ${Q_MIN} karakter.` });
  }
  if (q.length > Q_MAKS) {
    return res.status(400).json({ error: `Kata kunci maksimal ${Q_MAKS} karakter.` });
  }

  try {
    const hasil = await Promise.race([cariLagu(q), kedaluwarsa(TIMEOUT_MS, 'pencarian lambat')]);
    // Guard non-array: library yang balik bukan-array dibalas daftar kosong
    // (klien menampilkan "tidak ditemukan"), bukan 502 — transport sukses.
    const daftar = Array.isArray(hasil) ? hasil : [];
    res.json({
      data: daftar
        .filter((s) => s && typeof s.videoId === 'string' && typeof s.name === 'string')
        // Hanya tawarkan videoId yang pasti lolos validasi submit — kalau
        // tidak, pengirim memilih lagu lalu mati di 400 tanpa jalan keluar.
        .filter((s) => /^[A-Za-z0-9_-]{11}$/.test(s.videoId))
        .slice(0, HASIL_MAKS)
        .map((s) => ({
          videoId: s.videoId,
          title: s.name,
          artist: s.artist?.name || 'Tanpa artis',
          duration: Number.isFinite(s.duration) ? s.duration : null,
          // thumbnails diurutkan besar -> kecil; yang terakhir paling ringan
          // untuk kartu thumbnail di form maupun dashboard.
          thumb: Array.isArray(s.thumbnails) && s.thumbnails.length
            ? s.thumbnails[s.thumbnails.length - 1].url
            : null,
        })),
    });
  } catch (err) {
    // Detail (URL internal YouTube, stack) cukup untuk log server; ke klien
    // hanya pesan ramah — 502 = "gangguan di sisi layanan".
    console.error('Cari musik error:', err);
    res.status(502).json({ error: 'Pencarian lagu sedang gangguan. Coba lagi.' });
  }
}

module.exports = { cariMusik };
