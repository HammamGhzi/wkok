const { audit } = require('../lib/audit');
const prisma = require('../lib/prisma');
const cache = require('../lib/menfesCache');
const adminCache = require('../lib/adminCache');
const { parsePaging } = require('../lib/paging');
const igApi = require('../services/instagramApi');
const igPublish = require('../services/igPublish');

// Kunci cache untuk daftar admin. Status sudah diambil dari daftar putih di
// bawah dan page serta limit sudah dijepit parsePaging, jadi ruang kuncinya
// terbatas dan tidak bisa digenomari.
function cacheKey(status, page, limit) {
  return `list:${status}:${page}:${limit}`;
}

// Membersihkan kedua cache. Setiap mutasi mengubah tampilan publik dan isi
// dashboard admin sekaligus, jadi kalau hanya cache publik yang dibersihkan
// admin akan melihat data basi selama masa TTL.
function invalidateAll() {
  cache.invalidate();
  adminCache.invalidate();
}

// Status yang dikenal. Nilai lain DITOLAK dengan 400, bukan diam-diam
// diperlakukan sebagai "semua". Perilaku lama membuat ?status=BOGUS membalas
// 200 berisi seluruh baris tanpa filter — jawaban yang menyesatkan, seolah
// permintaan berhasil. Status kosong/absen tetap berarti "tanpa filter".
const STATUS_TERIMA = ['PENDING', 'APPROVED', 'REJECTED'];

/**
 * GET /api/admin/menfes
 * Ambil semua menfes (admin only) — termasuk info pengirim
 */
async function getAllMenfes(req, res) {
  try {
    const { page, limit, skip } = parsePaging(req.query, {
      defaultLimit: 20,
      maxLimit: 50,
      maxPage: 100,
    });
    const status = req.query.status; // PENDING | APPROVED | REJECTED

    // `status` bisa berupa array kalau parameter diulang di URL
    // (?status=A&status=B); includes() menolaknya dengan aman.
    const adaFilter = status !== undefined && status !== '';
    if (adaFilter && !STATUS_TERIMA.includes(status)) {
      return res.status(400).json({
        error: `Status tidak dikenal. Gunakan salah satu dari: ${STATUS_TERIMA.join(', ')}.`,
      });
    }

    const where = adaFilter ? { status } : {};

    const key = cacheKey(adaFilter ? status : 'ALL', page, limit);
    const cached = adminCache.get(key);
    if (cached) return res.json(cached);

    const [menfes, total] = await Promise.all([
      prisma.menfes.findMany({
        where,
        // Admin dapat melihat SEMUA field termasuk pengirim
        select: {
          id: true,
          message: true,
          senderName: true,
          senderInfo: true,
          status: true,
          createdAt: true,
          approvedAt: true,
          ipHash: true,
          // Status publikasi Instagram. igImageUrl sengaja tidak ikut: itu
          // alamat file di server kita dan tidak berguna di dashboard.
          igStatus: true,
          igMediaId: true,
          igPermalink: true,
          igCaption: true,
          igError: true,
          igPublishedAt: true,
        },
        orderBy: status === 'APPROVED' ? { approvedAt: 'desc' } : { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.menfes.count({ where }),
    ]);

    // Membaca daftar admin adalah aksi paling sensitif di aplikasi ini:
    // responsnya memuat senderName, senderInfo dan ipHash untuk setiap menfes.
    // Kalau password pernah bocor, ini yang pertama dilakukan penyerang.
    // Dicatat supaya aktivitas baca bisa dibedakan dari tidak ada aktivitas.
    audit('menfes.list', req, {
      page,
      limit,
      filter: status || 'ALL',
      returned: menfes.length,
    });

    const body = {
      data: menfes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
    adminCache.set(key, body);
    return res.json(body);
  } catch (err) {
    console.error('Admin getAllMenfes error:', err);
    res.status(500).json({ error: 'Gagal mengambil data menfes.' });
  }
}

/**
 * PATCH /api/admin/menfes/:id/approve
 * Approve menfes
 *
 * PENDING dan REJECTED sama-sama boleh diapprove. Reject lalu approve adalah
 * koreksi yang sah — sama logikanya dengan approve lalu reject: admin bisa
 * berubah pikiran, dan menfes REJECTED yang diapprove ulang hanya menulis
 * status yang memang sudah tidak dipakai lagi.
 *
 * Yang ditolak hanya APPROVED -> APPROVED. Dua klik cepat atau satu klik yang
 * terkirim dua kali akibat pengulangan jaringan akan menulis ulang approvedAt
 * dua kali dan membalas 200 dua kali, dan admin tidak pernah melihat tanda
 * bahwa approve pertama sebenarnya sudah berhasil. Dengan menolak yang sudah
 * APPROVED, klik kedua justru memberi tahu admin bahwa pekerjaannya sudah
 * selesai.
 *
 * Jalur Telegram (src/routes/telegram.js) memakai syarat yang lebih ketat,
 * hanya PENDING. Itu sengaja: tombol callback bot tidak punya ruang untuk
 * menampilkan pilihan koreksi, jadi kesalahan tekan di sana lebih mahal.
 */
async function approveMenfes(req, res) {
  try {
    const { id } = req.params;

    const menfes = await prisma.menfes.findUnique({ where: { id } });
    if (!menfes) {
      return res.status(404).json({ error: 'Menfes tidak ditemukan.' });
    }

    if (menfes.status === 'APPROVED') {
      return res.status(409).json({ error: 'Menfes ini sudah diapprove sebelumnya.' });
    }

    const updated = await prisma.menfes.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    });

    audit('menfes.approve', req, { menfesId: id });
    invalidateAll();

    res.json({ message: 'Menfes berhasil diapprove.', data: updated });
  } catch (err) {
    console.error('Approve menfes error:', err);
    res.status(500).json({ error: 'Gagal approve menfes.' });
  }
}

/**
 * PATCH /api/admin/menfes/:id/reject
 * Reject menfes
 */
async function rejectMenfes(req, res) {
  try {
    const { id } = req.params;

    const menfes = await prisma.menfes.findUnique({ where: { id } });
    if (!menfes) {
      return res.status(404).json({ error: 'Menfes tidak ditemukan.' });
    }

    const updated = await prisma.menfes.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    audit('menfes.reject', req, { menfesId: id });
    invalidateAll();

    res.json({ message: 'Menfes berhasil direject.', data: updated });
  } catch (err) {
    console.error('Reject menfes error:', err);
    res.status(500).json({ error: 'Gagal reject menfes.' });
  }
}

/**
 * PATCH /api/admin/menfes/:id/retry
 * Reset fields publikasi Instagram supaya admin bisa publish ulang melalui
 * Export modal. Hanya mengosongkan igMediaId, igPermalink, igError, igPublishedAt;
 * status APPROVED tetap utk menghindari kehilangan approvedAt.
 */
async function retryMenfes(req, res) {
  try {
    const { id } = req.params;

    const menfes = await prisma.menfes.findUnique({ where: { id } });
    if (!menfes) {
      return res.status(404).json({ error: 'Menfes tidak ditemukan.' });
    }

    const updated = await prisma.menfes.update({
      where: { id },
      data: {
        igMediaId: null,
        igPermalink: null,
        igError: null,
        igPublishedAt: null,
      },
    });

    audit('menfes.ig_retry', req, { menfesId: id });
    invalidateAll();

    res.json({ message: 'Status direset. Buka Export modal untuk publish ulang.', data: updated });
  } catch (err) {
    console.error('Retry menfes error:', err);
    res.status(500).json({ error: 'Gagal mereset status menfes.' });
  }
}

/**
 * DELETE /api/admin/menfes/:id
 * Hapus menfes permanen
 */
async function deleteMenfes(req, res) {
  try {
    const { id } = req.params;

    const menfes = await prisma.menfes.findUnique({ where: { id } });
    if (!menfes) {
      return res.status(404).json({ error: 'Menfes tidak ditemukan.' });
    }

    await prisma.menfes.delete({ where: { id } });

    audit('menfes.delete', req, { menfesId: id });
    invalidateAll();

    res.json({ message: 'Menfes berhasil dihapus.' });
  } catch (err) {
    console.error('Delete menfes error:', err);
    res.status(500).json({ error: 'Gagal menghapus menfes.' });
  }
}

/**
 * GET /api/admin/stats
 * Statistik dashboard admin
 */
async function getStats(req, res) {
  try {
    const cached = adminCache.get('stats');
    if (cached) return res.json(cached);

    // Empat count terpisah diubah menjadi satu query. Semuanya dijawab dari
    // hasil yang sama, dan ukurannya tetap sama persis: jumlah per status
    // ditambah seluruh baris.
    //
    // ::int itu wajib. COUNT(*) di PostgreSQL bertipe bigint, dan bigint tidak
    // bisa diserialisasi jadi JSON. Tanpa pemotongan ini res.json akan
    // melempar TypeError setiap kali statistik diminta.
    const baris = await prisma.$queryRaw`
      SELECT status, COUNT(*)::int AS n FROM "Menfes" GROUP BY status
    `;

    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let total = 0;
    for (const b of baris) {
      total += b.n;
      if (b.status === 'PENDING') pending = b.n;
      else if (b.status === 'APPROVED') approved = b.n;
      else if (b.status === 'REJECTED') rejected = b.n;
    }

    const body = { pending, approved, rejected, total };
    adminCache.set('stats', body);
    return res.json(body);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Gagal mengambil statistik.' });
  }
}

/**
 * POST /api/admin/menfes/:id/post
 * Publikasikan satu menfes ke Instagram.
 *
 * Body: multipart/form-data dengan dua field.
 *   image   — file JPEG atau PNG, hasil canvas di browser
 *   caption — teks opsional, maksimal 2200 karakter
 *
 * Body multipart dibaca lewat express.raw di routes/admin.js, bukan
 * express.json global. Alasannya ada di sana.
 *
 * YANG TIDAK BOLEH KELEWAT
 *
 *  - Hanya menfes APPROVED yang boleh tayang. Feed Instagram jauh lebih besar
 *    daripada web ini, dan menfes yang sengaja ditahan di dashboard tidak
 *    seharusnya bocor lewat jalan lain.
 *  - Menfes yang sudah pernah tayang ditolak dengan 409, bukan di-post ulang.
 *    media_publish tidak idempoten; dua panggilan berarti dua postingan yang
 *    tidak bisa ditarik kembali tanpa hapus manual.
 *    supaya kesalahan ketik admin tidak pernah menyentuh Instagram dan tidak
 *    pernah mengubah status menfes.
 */
async function postMenfesToInstagram(req, res) {
  try {
    const { id } = req.params;

    if (!igApi.isConfigured()) {
      return res.status(503).json({
        error: 'Instagram belum dikonfigurasi di server (IG_ACCESS_TOKEN / IG_USER_ID kosong).',
      });
    }

    const menfes = await prisma.menfes.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!menfes) {
      return res.status(404).json({ error: 'Menfes tidak ditemukan.' });
    }
    if (menfes.status !== 'APPROVED') {
      return res.status(409).json({
        error: `Hanya menfes yang sudah APPROVED yang boleh diposting. Status menfes ini ${menfes.status}.`,
      });
    }

    // express.raw hanya menyentuh request bertipe multipart. Kalau body bukan
    // Buffer di sini, berarti Content-Type-nya salah: parser global JSON sudah
    // memegangnya duluan. Tolak dengan 415, jangan diteruskan.
    if (!Buffer.isBuffer(req.body)) {
      return res.status(415).json({
        error: 'Kirim multipart/form-data dengan field image.',
      });
    }

    let form;
    try {
      // Parser multipart bawaan runtime, tanpa dependensi baru. Dipakai lewat
      // Response karena req.body sudah berupa Buffer penuh.
      form = await new Response(req.body, {
        headers: { 'content-type': req.headers['content-type'] },
      }).formData();
    } catch (err) {
      return res.status(400).json({ error: 'Data unggahan tidak bisa dibaca.' });
    }

    const file = form.get('image');
    const mentahCaption = form.get('caption');
    const caption = typeof mentahCaption === 'string' ? mentahCaption : '';

    if (!(file instanceof File) || file.size === 0) {
      return res.status(400).json({ error: 'Field image wajib berisi file gambar.' });
    }
    if (caption.length > igApi.BATAS_CAPTION) {
      return res.status(400).json({
        error: `Caption ${caption.length} karakter, batas Instagram ${igApi.BATAS_CAPTION}.`,
      });
    }

    const imageBuffer = Buffer.from(await file.arrayBuffer());

    // Validasi di sini, sebelum terbitkan. Kalau ini gagal, tidak ada klaim
    // kerja, tidak ada file di disk, dan status menfes tidak berubah.
    try {
      igPublish.periksaGambar(imageBuffer, file.type);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const hasil = await igPublish.terbitkan({
      menfesId: id,
      imageBuffer,
      mimeType: file.type,
      caption,
    });

    audit('menfes.ig_publish', req, {
      menfesId: id,
      mediaId: hasil.mediaId,
      punyaCaption: caption.trim().length > 0,
    });
    invalidateAll();

    res.json({
      message: 'Menfes berhasil diposting ke Instagram.',
      data: {
        id,
        igStatus: 'PUBLISHED',
        igMediaId: hasil.mediaId,
        igPermalink: hasil.permalink,
      },
    });
  } catch (err) {
    // Kode dari igPublish bersifat spesifik dan layak dibalas apa adanya.
    // 409 untuk-tabrakan dengan proses lain, 404 kalau menfes hilang.
    if (err.kode === 'SUDAH_TAYANG' || err.kode === 'SEDANG_PROSES') {
      return res.status(409).json({ error: err.message });
    }
    if (err.kode === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    // Kegagalan Instagram adalah masalah pihak ketiga, bukan bug server ini.
    // 502 menyatakan itu jujur; 502 juga membuat admins terasa perlu waited
    // sebelum mencoba ulang, bukan langsung mengulang.
    if (err instanceof igApi.InstagramApiError) {
      console.error('IG publish error:', err.code || '-', err.message);
      return res.status(502).json({
        error: err.message,
        tahap: err.tahap || null,
      });
    }

    console.error('Post menfes ke Instagram error:', err);
    res.status(500).json({ error: 'Gagal memposting ke Instagram.' });
  }
}

module.exports = {
  getAllMenfes,
  approveMenfes,
  rejectMenfes,
  deleteMenfes,
  getStats,
  postMenfesToInstagram,
  retryMenfes,
};
