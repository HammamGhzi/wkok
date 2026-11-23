// Jalur publish Instagram yang dipicu dari pesan WA (tombol/link).
//
// Beda dengan jalur dashboard: admin tidak mengunggah kartu lagi. Kartu sudah
// dikirim dari browser saat Export WA, lalu disimpan ke uploads/ig/ oleh
// adminController. Token di bawah hanya membawa nama file itu — bukan gambar —
// supaya URL WhatsApp tetap pendek dan isi pesan tidak bisa dipalsukan.
//
// Token ditandatangani JWT_SECRET yang sudah ada. Tidak memakai auth admin:
// tautannya memang dipakai dari chat WA, jadi kepemilikan token = izin publish.
// GET sengaja hanya menampilkan konfirmasi, karena WhatsApp mengambil preview
// tautan secara otomatis; publish hanya terjadi di POST setelah admin menekan tombol.
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../lib/prisma');
const igPublish = require('./igPublish');
const igApi = require('./instagramApi');

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'ig');
const UMUR_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;
const AWAL_TOMBOL = 'igpub:';

function tanda(payload) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(payload)
    .digest('base64url');
}

function buatToken({ id, files }) {
  const payload = Buffer.from(JSON.stringify({
    id,
    files,
    exp: Date.now() + UMUR_TOKEN_MS,
  })).toString('base64url');
  return `${payload}.${tanda(payload)}`;
}

function kesalahanToken(pesan) {
  return Object.assign(new Error(pesan), { kode: 'TOKEN_SALAH' });
}

function bacaToken(token) {
  const bagian = String(token || '').split('.');
  if (bagian.length !== 2) throw kesalahanToken('Tautan tidak lengkap.');

  const [payload, tandaDiterima] = bagian;
  const tandaDiharapkan = tanda(payload);
  const a = Buffer.from(tandaDiterima);
  const b = Buffer.from(tandaDiharapkan);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw kesalahanToken('Tautan tidak valid atau sudah diubah.');
  }

  let isi;
  try {
    isi = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw kesalahanToken('Tautan tidak bisa dibaca.');
  }
  if (!isi?.id || !Array.isArray(isi.files) || isi.files.length === 0) {
    throw kesalahanToken('Isi tautan tidak lengkap.');
  }
  if (!Number.isFinite(isi.exp) || Date.now() > isi.exp) {
    throw kesalahanToken('Tautan sudah kedaluwarsa. Silakan Export WA lagi.');
  }
  return isi;
}

async function terbitkanDariToken(token) {
  const { id, files } = bacaToken(token);

  if (!igApi.isConfigured()) {
    const err = new Error('Instagram belum dikonfigurasi di server.');
    err.kode = 'BELUM_KONFIRMASI';
    throw err;
  }

  const menfes = await prisma.menfes.findUnique({
    where: { id },
    select: { status: true, message: true },
  });
  if (!menfes) {
    const err = new Error('Menfes tidak ditemukan.');
    err.kode = 'NOT_FOUND';
    throw err;
  }
  if (menfes.status !== 'APPROVED') {
    const err = new Error(`Hanya menfes APPROVED yang boleh diposting. Status: ${menfes.status}.`);
    err.kode = 'BUKAN_APPROVED';
    throw err;
  }

  // Nama file berasal dari token bertanda tangan, tapi tetap disaring sebelum
  // dipakai sebagai path — pertahanan kedua kalau ada bug pembuat token.
  const buffers = [];
  for (const nama of files) {
    const aman = String(nama).replace(/[^a-zA-Z0-9_.-]/g, '');
    try {
      const buffer = await fs.readFile(path.join(UPLOAD_DIR, aman));
      buffers.push({ buffer, mimeType: 'image/jpeg' });
    } catch {
      const err = new Error(
        'Kartu hasil Export WA sudah tidak ada di server (storage ephemeral). Silakan Export WA lagi.'
      );
      err.kode = 'KARTU_HILANG';
      throw err;
    }
  }

  // Caption otomatis sesuai permintaan: isi menfes, baris kosong, lalu -katt.
  return igPublish.terbitkan({
    menfesId: id,
    buffers,
    caption: `${menfes.message || ''}\n\n-katt`,
  });
}

module.exports = {
  AWAL_TOMBOL,
  buatToken,
  bacaToken,
  terbitkanDariToken,
};
