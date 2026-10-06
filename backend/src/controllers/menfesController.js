const crypto = require('crypto');
const { notifyNewMenfes } = require('../services/telegramBot');
const prisma = require('../lib/prisma');
const cache = require('../lib/menfesCache');
const { parsePaging } = require('../lib/paging');
const { statusBuka, JAM_BUKA } = require('./siteController');

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

    const { message, senderName, senderInfo } = req.body;

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

    // Ambil IP pengirim (di-hash untuk privasi).
    // req.ip sudah memperhitungkan 'trust proxy', jadi bukan header mentah
    // yang bisa dipalsukan client.
    const ipHash = hashIp(req.ip);

    // Simpan ke database
    const menfes = await prisma.menfes.create({
      data: {
        message: trimmed,
        senderName: senderName?.trim()?.substring(0, 100) || null,
        senderInfo: senderInfo?.trim()?.substring(0, 200) || null,
        status: 'PENDING',
        ipHash,
      },
    });

    // Kirim notifikasi Telegram ke admin (non-blocking — tidak ganggu response)
    notifyNewMenfes(menfes).catch((err) =>
      console.error('Telegram notif error (non-fatal):', err.message)
    );

    // Response publik — JANGAN tampilkan info pengirim
    res.status(201).json({
      message: 'Menfes berhasil dikirim! Menunggu persetujuan admin.',
      id: menfes.id,
    });
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
