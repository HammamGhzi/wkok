'use strict';

/**
 * Klien Cloudinary tanpa dependensi — foto dan video pengirim ke penyimpanan
 * yang awet.
 *
 * Latar belakang: foto dulu ditulis ke disk Render, dan disk itu hapus tiap
 * redeploy — sementara Meta bisa meminta media dari URL jauh setelah upload.
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

// Foto dibingkai di browser; video TIDAK — merekam ulang video di browser
// butuh 1x durasi dan hasilnya WebM yang ditolak Instagram. Jadi frame video
// dipasang Cloudinary saat upload, dengan geometri yang sama persis dengan
// bingkai foto (HomePage.bingkaiFoto): kanvas 1080x1350, area media 960x1110,
// margin krem, handle di strip bawah.
//
// f_mp4 sekaligus menormalkan sumber apa pun (MOV/HEVC dari iPhone, WebM)
// jadi MP4 H.264/AAC — satu-satunya bentuk yang diterima Graph API.
const FRAME_VIDEO = [
  'c_pad,w_960,h_1110,b_rgb:F6EFDD',
  'c_pad,w_1080,h_1350,b_rgb:F6EFDD',
  'l_text:Arial_44_bold:@harkatnekatt,co_rgb:7A1F2B,g_south,y_70',
  'f_mp4',
].join('/');

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
 *   https://res.cloudinary.com/<cloud>/video/upload/<transformasi>/v1767123/video-ab12.mp4
 *   .../v1767123/          <- versi, dibuang
 *   ...foto-ab12.png        <- ekstensi format, dibuang (public_id tanpa ekstensi)
 *
 * URL hasil eager transformation membawa segmen transformasi sebelum versi.
 * Karena itu yang diambil adalah bagian SETELAH segmen `v<angka>/`, bukan
 * sekadar membuang awalan — tanpa ini hapus aset video menunjuk public_id
 * yang salah dan asetnya tertinggal.
 */
function publicIdDariUrl(urlAset) {
  if (typeof urlAset !== 'string' || !urlAset.startsWith('https://res.cloudinary.com/')) {
    return null;
  }
  let bagian;
  try {
    bagian = new URL(urlAset).pathname.split('/upload/')[1];
  } catch {
    return null;
  }
  if (!bagian) return null;
  const versi = bagian.match(/(?:^|\/)v\d+\/(.+)$/);
  const sisa = versi ? versi[1] : bagian;
  return sisa.replace(/\.[A-Za-z0-9]+$/, '') || null;
}

/**
 * Unggah satu aset. `jenis` adalah resource_type Cloudinary ('image' atau
 * 'video'); `tambahan` adalah parameter upload lain yang ikut ditandatangani.
 *
 * Nama berkas pembawa ekstensi ikut dikirim karena Cloudinary menentukan format
 * aset dari nama itu; isi berkasnya sendiri tervalidasi tipe-nya di controller.
 */
async function unggah(jenis, buffer, mimeType, publicId, ekstensi, tambahan = {}) {
  const { cloudName, apiKey, apiSecret } = konfigurasi();
  const timestamp = Math.floor(Date.now() / 1000);
  const param = { public_id: publicId, timestamp, ...tambahan };

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), `${publicId}.${ekstensi}`);
  form.append('api_key', apiKey);
  for (const [k, v] of Object.entries(param)) {
    form.append(k, String(v));
  }
  form.append('signature', tandaTangan(param, apiSecret));

  const res = await fetch(`${API_DASAR}/${cloudName}/${jenis}/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.secure_url) {
    throw new Error(
      `Unggah Cloudinary gagal (HTTP ${res.status}): ${data?.error?.message || 'tanpa pesan'}`
    );
  }
  return data;
}

/**
 * Unggah satu foto. Mengembalikan { url, publicId } — url inilah yang disimpan
 * ke kolom fotoUrl (absolut, tidak lagi tergantung base URL manapun).
 */
async function unggahFoto(buffer, mimeType, publicId, ekstensi) {
  const data = await unggah('image', buffer, mimeType, publicId, ekstensi);
  return { url: data.secure_url, publicId: data.public_id };
}

/**
 * Unggah satu video, sekalian memasang frame polaroid dan menormalkan format.
 *
 * Eager: transformasi dijalankan saat upload, jadi URL yang disimpan sudah
 * berupa MP4 berframe — Instagram tidak perlu menunggu Cloudinary transcode
 * saat menariknya. Kalau respons tidak membawa hasil eager (akun dengan
 * pemrosesan asinkron), URL-nya disusun sendiri dari secure_url; transformasi
 * baru jalan saat pertama diminta, dan video tetap sah.
 */
async function unggahVideo(buffer, mimeType, publicId, ekstensi) {
  const data = await unggah('video', buffer, mimeType, publicId, ekstensi, {
    eager: FRAME_VIDEO,
  });
  const url =
    data.eager?.[0]?.secure_url ||
    data.secure_url.replace('/video/upload/', `/video/upload/${FRAME_VIDEO}/`);
  return { url, publicId: data.public_id };
}

/**
 * Buang aset berdasarkan URL delivery-nya. Sengaja `invalidate: true` supaya
 * salinan CDN ikut dibersihkan — tanpa itu aset "terhapus" masih bisa diserve
 * dari cache CDN sampai 30 hari.
 *
 * Best effort dari sisi pemanggil: aset yang sudah tidak ada balasannya
 * `result: 'not found'`, bukan error.
 */
async function hapus(jenis, urlAset) {
  const publicId = publicIdDariUrl(urlAset);
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

  const res = await fetch(`${API_DASAR}/${cloudName}/${jenis}/destroy`, {
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

function hapusFoto(urlFoto) {
  return hapus('image', urlFoto);
}

function hapusVideo(urlVideo) {
  return hapus('video', urlVideo);
}

/**
 * Apakah aset masih ada? Ditanya lewat Admin API, BUKAN lewat URL delivery-nya:
 * salinan CDN bisa bertahan lama setelah destroy, jadi GET ke URL bisa tetap
 * 200 padahal asetnya sudah benar-benar hilang dari penyimpanan.
 */
async function adaAset(urlAset, jenis = 'image') {
  const publicId = publicIdDariUrl(urlAset);
  if (!publicId) return false;

  const { cloudName, apiKey, apiSecret } = konfigurasi();
  const dasar = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const res = await fetch(
    `${API_DASAR}/${cloudName}/resources/${jenis}/upload/${publicId}`,
    { headers: { Authorization: `Basic ${dasar}` } }
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`Cek aset Cloudinary gagal (HTTP ${res.status})`);
  }
  return true;
}

module.exports = {
  unggahFoto,
  unggahVideo,
  hapusFoto,
  hapusVideo,
  adaAset,
  publicIdDariUrl,
  FRAME_VIDEO,
};
