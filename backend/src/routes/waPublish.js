const express = require('express');
const waPublish = require('../services/waPublish');
const igApi = require('../services/instagramApi');
const cache = require('../lib/menfesCache');
const adminCache = require('../lib/adminCache');
const prisma = require('../lib/prisma');

const router = express.Router();

function escapeHtml(teks) {
  return String(teks ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function halaman(judul, isi) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(judul)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;` +
    `line-height:1.6;color:#1a1a1a}button{padding:.75rem 1.25rem;font-size:1rem;cursor:pointer}` +
    `a{color:#075985}</style></head><body>${isi}</body></html>`;
}

// GET cuma konfirmasi. WhatsApp (dan browser) mengambil preview tautan secara
// otomatis; kalau publish terjadi di sini, membuka link saja sudah cukup untuk
// memposting ke feed akun sungguhan.
router.get('/:token', async (req, res) => {
  let isi;
  try {
    isi = waPublish.bacaToken(req.params.token);
  } catch (err) {
    return res.status(400).type('html').send(halaman('Tautan tidak valid', `
      <h1>Tautan tidak valid</h1><p>${escapeHtml(err.message)}</p>
      <p>Silakan klik Export WA lagi di dashboard untuk mendapat tautan baru.</p>`));
  }

  const menfes = await prisma.menfes.findUnique({
    where: { id: isi.id },
    select: { message: true },
  });
  const caption = `${menfes?.message || ''}\n\n-katt`;

  res.type('html').send(halaman('Post ke Instagram', `
    <h1>Post ke Instagram?</h1>
    <p>Kartu hasil Export WA akan dipublish ke feed <strong>@harkatnekatt</strong>
    dengan caption otomatis:</p>
    <pre style="white-space:pre-wrap;background:#f3f4f6;padding:1rem;border-radius:.5rem"
    >${escapeHtml(caption)}</pre>
    <form method="post" action="/api/wa/post-ig/${escapeHtml(req.params.token)}">
      <button type="submit">Post ke IG</button>
    </form>
    <p><a href="/api/wa/post-ig/${escapeHtml(req.params.token)}">Muat ulang halaman ini</a></p>`));
});

router.post('/:token', async (req, res) => {
  try {
    const hasil = await waPublish.terbitkanDariToken(req.params.token);

    // Sama seperti jalur dashboard: publish mengubah status menfes, jadi cache
    // publik dan cache admin harus dibersihkan berdua.
    cache.invalidate();
    adminCache.invalidate();

    res.type('html').send(halaman('Berhasil', `
      <h1>Berhasil</h1><p>Menfes sudah tayang di Instagram.</p>
      ${hasil.permalink ? `<p><a href="${escapeHtml(hasil.permalink)}">Lihat postingan</a></p>` : ''}`));
  } catch (err) {
    let status = 500;
    if (err.kode === 'BELUM_KONFIRMASI') status = 503;
    else if (err.kode === 'NOT_FOUND') status = 404;
    else if (['SUDAH_TAYANG', 'SEDANG_PROSES', 'BUKAN_APPROVED', 'KUOTA_HABIS'].includes(err.kode)) status = 409;
    else if (['INPUT_SALAH', 'KARTU_HILANG', 'TOKEN_SALAH'].includes(err.kode)) status = 400;
    else if (err instanceof igApi.InstagramApiError) status = 502;

    console.error('WA -> IG publish error:', err.kode || '-', err.message);
    res.status(status).type('html').send(halaman('Gagal', `
      <h1>Gagal memposting</h1><p>${escapeHtml(err.message)}</p>
      <p><a href="/api/wa/post-ig/${escapeHtml(req.params.token)}">Coba lagi</a></p>`));
  }
});

module.exports = router;
