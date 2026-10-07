'use strict';

/**
 * Klien Cloudinary tanpa dependensi — kirim/hapus foto pengirim ke penyimpanan
 * yang awet.
 *
 * Latar belakang: foto dulu ditulis ke disk Render, dan disk itu hapus tiap
 * redeploy — sementara Meta bisa meminta foto dari URL jauh setelah upload.
 * Cloudinary nyimpan aset di tempat terpisah dari proses kita.
 *
 * Autentikasi: signature SHA-1 sesuai aturan resmi Cloudinary — semua parameter
 * yang ikut dikirim (kecuali `file`, `api_key`, `cloud_name`, `resource_type`)
 * diurutkan alfabet, digabung 'k=v' dengan '&', API secret ditempel tanpa
 * pemisah, lalu di-hash SHA-1 hex. Kredensial dibaca dari environment SETIAP
 * dipanggil (bukan saat module load) supaya test dan server yang sama-sama
 * bisa memakai file ini.
 */

const crypto = require('crypto');

const API_DASAR = 'https://api.cloudinary.com/v1_1';

function konfigurasi() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET belum lengkap di environment.'
    );
  }
  return { cloudName, apiKey, apiSecret };
}

function tandaTangan(params, apiSecret) {
  const stringToSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(stringToSign + apiSecret).digest('hex');
}

/**
 * Public ID aset dari URL delivery-nya, atau null kalau bukan URL Cloudinary
 * kita (baris lama '/uploads/foto/...' dan nilai aneh lainnya tidak disentuh).
 *
 * URL bentuknya:
 *   https://res.cloudinary.com/<cloud>/image/upload/v1767123/foto-ab12.png
 *   .../v1767123/          <- versi, dibuang
 *   ...foto-ab12.png        <- ekstensi format, dibuang (public_id tanpa ekstensi)
 */
function publicIdDariUrl(urlFoto) {
  if (typeof urlFoto !== 'string' || !urlFoto.startsWith('https://res.cloudinary.com/')) {
    return null;
  }
  let bagian;
  try {
    bagian = new URL(urlFoto).pathname.split('/upload/')[1];
  } catch {
    return null;
  }
  if (!bagian) return null;
  return bagian.replace(/^v\d+\//, '').replace(/\.[A-Za-z0-9]+$/, '') || null;
}

/**
 * Unggah satu foto. Mengembalikan { url, publicId } — url inilah yang disimpan
 * ke kolom fotoUrl (absolut, tidak lagi tergantung base URL manapun).
 *
 * Nama berkas pembawa ekstensi ikut dikirim karena Cloudinary menentukan format
 * aset dari nama itu; isi berkasnya sendiri tervalidasi tipe-nya di controller.
 */
async function unggahFoto(buffer, mimeType, publicId, ekstensi) {
  const { cloudName, apiKey, apiSecret } = konfigurasi();
  const timestamp = Math.floor(Date.now() / 1000);
  const param = { public_id: publicId, timestamp };

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), `${publicId}.${ekstensi}`);
  form.append('api_key', apiKey);
  form.append('public_id', publicId);
  form.append('timestamp', String(timestamp));
  form.append('signature', tandaTangan(param, apiSecret));

  const res = await fetch(`${API_DASAR}/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.secure_url) {
    throw new Error(
      `Unggah Cloudinary gagal (HTTP ${res.status}): ${data?.error?.message || 'tanpa pesan'}`
    );
  }
  return { url: data.secure_url, publicId: data.public_id };
}

/**
 * Buang aset berdasarkan URL delivery-nya. Sengaja `invalidate: true` supaya
 * salinan CDN ikut dibersihkan — tanpa itu foto "terhapus" masih bisa diserve
 * dari cache CDN sampai 30 hari.
 *
 * Best effort dari sisi pemanggil: aset yang sudah tidak ada balasannya
 * `result: 'not found'`, bukan error.
 */
async function hapusFoto(urlFoto) {
  const publicId = publicIdDariUrl(urlFoto);
  if (!publicId) return { ok: false, alasan: 'bukan URL Cloudinary' };

  const { cloudName, apiKey, apiSecret } = konfigurasi();
  const timestamp = Math.floor(Date.now() / 1000);
  const param = { invalidate: 'true', public_id: publicId, timestamp };

  const form = new FormData();
  form.append('public_id', publicId);
  form.append('invalidate', 'true');
  form.append('timestamp', String(timestamp));
  form.append('api_key', apiKey);
  form.append('signature', tandaTangan(param, apiSecret));

  const res = await fetch(`${API_DASAR}/${cloudName}/image/destroy`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Hapus aset Cloudinary gagal (HTTP ${res.status}): ${data?.error?.message || 'tanpa pesan'}`
    );
  }
  return { ok: true, result: data?.result };
}

/**
 * Apakah aset masih ada? Ditanya lewat Admin API, BUKAN lewat URL delivery-nya:
 * salinan CDN bisa bertahan lama setelah destroy, jadi GET ke URL bisa tetap
 * 200 padahal asetnya sudah benar-benar hilang dari penyimpanan.
 */
async function adaAset(urlFoto) {
  const publicId = publicIdDariUrl(urlFoto);
  if (!publicId) return false;

  const { cloudName, apiKey, apiSecret } = konfigurasi();
  const dasar = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const res = await fetch(
    `${API_DASAR}/${cloudName}/resources/image/upload/${publicId}`,
    { headers: { Authorization: `Basic ${dasar}` } }
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`Cek aset Cloudinary gagal (HTTP ${res.status})`);
  }
  return true;
}

module.exports = { unggahFoto, hapusFoto, adaAset, publicIdDariUrl };
