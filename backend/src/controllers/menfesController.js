const crypto = require('crypto');
const { notifyNewMenfes } = require('../services/telegramBot');
const prisma = require('../lib/prisma');
const { unggahFoto, hapusFoto } = require('../lib/cloudinary');
const cache = require('../lib/menfesCache');
const { parsePaging } = require('../lib/paging');
const { statusBuka, JAM_BUKA } = require('./siteController');

// ── Batas foto pengirim ─────────────────────────────────────────────────────
// JPG/PNG saja — dua-satunya format yang diterima children container
// Instagram. WebP sengaja ditolak di sini supaya gagal sebagai 400 yang jelas
// di pengirim, bukan sebagai fallback diam-diam saat publish IG nanti.
const UKURAN_FOTO_MAKS = 5 * 1024 * 1024;
const TIPE_FOTO = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
]);

// ── Lagu pilihan pengirim (opsional) ─────────────────────────────────────────
// Metadata lagu diterima SEBAGAI SNAPSHOT dari klien (bukan ditarik ulang dari
// YouTube) supaya submit tidak pernah gantung saat YouTube mati. Yang dijaga
// ketat hanya videoId — tautan playback satu-satunya — dan panjang teksnya.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const potong = (v, maks) => (typeof v === 'string' ? v.trim().substring(0, maks) : null);

function normalisasiMusic(mentah) {
  // Bentuk objek (request JSON) maupun string (FormData) sama-sama diterima.
  let m = mentah;
  if (typeof m === 'string') {
    try {
      m = JSON.parse(m);
    } catch {
      return { salah: 'Lagu tidak valid.' };
    }
  }
  if (!m || typeof m !== 'object') return { salah: 'Lagu tidak valid.' };
  if (!VIDEO_ID.test(String(m.videoId || ''))) return { salah: 'videoId lagu tidak valid.' };
  return {
    music: {
      videoId: String(m.videoId),
      title: potong(m.title, 100) || 'Tanpa judul',
      artist: potong(m.artist, 100) || 'Tanpa artis',
      thumb:
        typeof m.thumb === 'string' && m.thumb.startsWith('https://')
          ? m.thumb.substring(0, 500)
          : null,
      duration: Number.isFinite(m.duration) && m.duration >= 0 ? Math.round(m.duration) : null,
    },
  };
}

/**
 * Hash IP address untuk anti-spam tanpa menyimpan IP asli
 */
function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip + process.env.JWT_SECRET).digest('hex').substring(0, 16);
}

/**
 * POST /api/menfes
 * Submit menfes baru (publik, anonim)
 */
async function submitMenfes(req, res) {
  try {
    // Guard paling depan, sebelum validasi payload: menfess tutup berarti
    // tolak semua, tidak peduli isinya. Inilah yang membuat layar tutup di
    // halaman user tidak bisa ditembus — menyiasati overlay lewat API langsung
    // tetap kena 403 dengan pesan jadwal yang sama.
    if (!(await statusBuka())) {
      return res.status(403).json({
        error: `Menfess sedang tutup. Jam buka: ${JAM_BUKA.join(', ')}.`,
      });
    }

    // ── Baca body: multipart (hanya mungkin kalau ada foto) atau JSON ────────
    // Parser multipart di routes/menfes.js menyerahkan byte mentah sebagai
    // Buffer; Response.formData() bawaan Node yang mengurainya (sama persis
    // dengan jalur post-to-Instagram di adminController). Request JSON lama
    // lolos parser dan tetap datang sebagai objek — tidak ada perubahan perilaku.
    let fields = req.body;
    let file = null;
    if (Buffer.isBuffer(req.body)) {
      let form;
      try {
        form = await new Response(req.body, {
          headers: { 'content-type': req.headers['content-type'] },
        }).formData();
      } catch {
        return res.status(400).json({ error: 'Data unggahan tidak bisa dibaca.' });
      }
      fields = {};
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') fields[k] = v;
      }
      const kandidat = form.get('foto');
      if (kandidat instanceof File) file = kandidat;
    }

    const { message, senderName, senderInfo } = fields;

    // Lagu opsional — dinormalisasi SEBELUM upload foto dan pembuatan baris.
    let music = null;
    if (fields.music !== undefined && fields.music !== null && fields.music !== '') {
      const hasil = normalisasiMusic(fields.music);
      if (hasil.salah) return res.status(400).json({ error: hasil.salah });
      music = hasil.music;
    }

    // Validasi pesan
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Pesan menfes wajib diisi.' });
    }

    const trimmed = message.trim();
    if (trimmed.length < 5) {
      return res.status(400).json({ error: 'Pesan minimal 5 karakter.' });
    }
    if (trimmed.length > 500) {
      return res.status(400).json({ error: 'Pesan maksimal 500 karakter.' });
    }

    // ── Foto (opsional): periksa SEBELUM menyentuh database ─────────────────
    // Urutan ini disengaja: input rusak dibalas 400 tanpa baris baru dan
    // tanpa file sampah, sama seperti periksaGambar di jalur Instagram.
    if (file) {
      if (file.size === 0) {
        return res.status(400).json({ error: 'Foto kosong atau tidak terkirim.' });
      }
      if (!TIPE_FOTO.has(String(file.type || '').toLowerCase())) {
        return res.status(400).json({ error: 'Format foto harus JPG atau PNG.' });
      }
      if (file.size > UKURAN_FOTO_MAKS) {
        return res.status(400).json({
          error: `Foto ${(file.size / 1024 / 1024).toFixed(1)} MB, batas ${UKURAN_FOTO_MAKS / 1024 / 1024} MB.`,
        });
      }
    }

    // Ambil IP pengirim (di-hash untuk privasi).
    // req.ip sudah memperhitungkan 'trust proxy', jadi bukan header mentah
    // yang bisa dipalsukan client.
    const ipHash = hashIp(req.ip);

    // Foto diunggah ke Cloudinary DULU, baru baris dibuat dengan fotoUrl-nya
    // sekalian — kalau barisnya yang gagal dibuat, aset tadi dibersihkan di
    // catch. urlFoto + barisJadi dipakai untuk membersihkan tanpa sempat
    // menghapus aset yang sudah menempel pada baris yang berhasil dibuat.
    let urlFoto = null;
    let barisJadi = false;
    try {
      if (file) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const ext = TIPE_FOTO.get(file.type.toLowerCase());
        // Nama aset dari angka acak, BUKAN dari nama file pengguna: nama dari
        // input membuka path traversal dan membocorkan asal kiriman.
        const publicId = `foto-${crypto.randomBytes(10).toString('hex')}`;
        urlFoto = (await unggahFoto(buffer, file.type, publicId, ext)).url;
      }

      // Simpan ke database
      const menfes = await prisma.menfes.create({
        data: {
          message: trimmed,
          senderName: senderName?.trim()?.substring(0, 100) || null,
          senderInfo: senderInfo?.trim()?.substring(0, 200) || null,
          status: 'PENDING',
          ipHash,
          fotoUrl: urlFoto,
          // Tanpa lagu: kolomnya TIDAK disentuh sama sekali (nullable JSON —
          // meng-omit lebih aman daripada menulis null eksplisit ke kolom Json).
          ...(music ? { music } : {}),
        },
      });
      barisJadi = true;

      // Kirim notifikasi Telegram ke admin (non-blocking — tidak ganggu response)
      notifyNewMenfes(menfes).catch((err) =>
        console.error('Telegram notif error (non-fatal):', err.message)
      );

      // Response publik — JANGAN tampilkan info pengirim
      res.status(201).json({
        message: 'Menfes berhasil dikirim! Menunggu persetujuan admin.',
        id: menfes.id,
      });
    } catch (gagal) {
      // Proses gagal SEBELUM baris jadi: buang aset Cloudinary yatim supaya
      // tidak menumpuk sebagai sampah.
      if (urlFoto && !barisJadi) {
        hapusFoto(urlFoto).catch(() => {});
      }
      throw gagal;
    }
  } catch (err) {
    console.error('Submit menfes error:', err);
    res.status(500).json({ error: 'Gagal mengirim menfes.' });
  }
}

/**
 * GET /api/menfes
 * Ambil semua menfes yang sudah APPROVED (publik)
 */
async function getApprovedMenfes(req, res) {
  try {
    const { page, limit, skip } = parsePaging(req.query, {
      defaultLimit: 10,
      maxLimit: 20,
      maxPage: 100,
    });

    // Halaman 1 di-cache supaya jalur publik tidak menyentuh database.
    let cached = page === 1 ? cache.get(limit) : undefined;

    let menfes;
    let total;
    if (cached) {
      ({ menfes, total } = cached);
    } else {
      [menfes, total] = await Promise.all([
        prisma.menfes.findMany({
          where: { status: 'APPROVED' },
          select: {
            id: true,
            message: true,
            approvedAt: true,
            createdAt: true,
            // senderName, senderInfo, ipHash TIDAK diambil
          },
          orderBy: { approvedAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.menfes.count({ where: { status: 'APPROVED' } }),
      ]);
      if (page === 1) cache.set(limit, { menfes, total });
    }

    res.json({
      data: menfes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Get menfes error:', err);
    res.status(500).json({ error: 'Gagal mengambil data menfes.' });
  }
}

module.exports = { submitMenfes, getApprovedMenfes };
