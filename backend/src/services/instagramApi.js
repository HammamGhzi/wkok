// Pembungkus tipis untuk Instagram Graph API.
//
// Cakupan file ini sengaja sempit: hanya gambar, hanya feed. Tidak ada reels,
// tidak ada carousel, tidak ada moderasi komentar. Menambahkannya nanti berarti
// menambah endpoint dan menambah permukaan yang bisa rusak.
//
// ── Mengapa host-nya graph.instagram.com ──────────────────────────────────────
//
// Instagram punya dua jalur login, dan keduanya memakai host berbeda:
//
//   IGAA...  Instagram API with Instagram Login  -> graph.instagram.com
//   EAA...   Instagram API with Facebook Login    -> graph.facebook.com
//
// Token dari jalur A ditolak mentah-mentah oleh host B ("Cannot parse access
// token"). Karena itu prefix token menentukan host, dan host ikut dipin di
// sini supaya tidak salah kirim.
const HOST = 'https://graph.instagram.com';

// Versi Graph API dipin lewat environment, bukan ditulis di sini. Meta menaikkan
// versi secara berkala; kalau versi lama dimatikan, cukup ubah env lalu restart,
// tanpa menyentuh kode.
const VERSION = process.env.IG_GRAPH_VERSION || 'v22.0';

// Batas caption feed Instagram: 2200 karakter. Instagram akan memotong sendiri
// tanpa memberi error, jadi lebih baik divalidasi di sini dan diberi tahu admin
// daripada diam-diam memotong.
const BATAS_CAPTION = 2200;

/**
 * Error dari Graph API, cukup detail untuk memutuskan apa yang harus diperbaiki
 * tanpa perlu membuka dokumentasi.
 */
class InstagramApiError extends Error {
  /**
   * @param {string} message  pesan untuk ditampilkan ke admin
   * @param {object} info     detail mentah dari Graph API
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'InstagramApiError';
    this.code = info.code ?? null;
    this.subcode = info.subcode ?? null;
    this.type = info.type ?? null;
    this.httpStatus = info.httpStatus ?? null;
    this.penjelasan = null;
    this.raw = info.raw ?? null;
  }
}

/**
 * Terjemahan kode error yang sering muncul. Dipisah dari konstruktor supaya
 * pembuatan objek error tetap murah dan pemetaan teks bisa diuji terpisah.
 *
 * @param {number|null} code
 * @returns {string|null} penjelasan, atau null kalau kodenya tidak dikenal
 */
function jelaskanKode(code) {
  switch (code) {
    case 190:
      return 'Token tidak valid atau sudah kedaluwarsa. Generate ulang di Meta App Dashboard.';
    case 200:
      return 'Izin kurang. Token harus dibuat dengan izin instagram_business_content_publish.';
    case 9007:
      return 'Format media tidak dikenali. image_url harus menunjuk JPEG atau PNG yang bisa diakses publik.';
    case 36003:
      return 'Konten ditolak kebijakan Instagram. Caption atau gambarnya bermasalah.';
    case 36000:
      return 'Terlalu banyak konten dibuat dalam waktu singkat. Tunggu sebentar sebelum coba lagi.';
    default:
      return null;
  }
}

/**
 * Baca kredensial dari environment.
 *
 * Sengaja dipanggil per request, bukan sekali di modul-level: test runner dan
 * skrip sering memuat environment setelah modul ini sudah di-require.
 *
 * @returns {{token: string, igUserId: string}}
 * @throws {InstagramApiError} kalau ada yang belum diisi
 */
function kredensial() {
  const token = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;

  const kurang = [];
  if (!token) kurang.push('IG_ACCESS_TOKEN');
  if (!igUserId) kurang.push('IG_USER_ID');
  if (kurang.length > 0) {
    throw new InstagramApiError(
      `Konfigurasi belum lengkap: ${kurang.join(', ')} belum diisi di .env.`,
      { raw: kurang.join(',') }
    );
  }
  return { token, igUserId };
}

/**
 * Satu panggilan Graph API, dengan penanganan error terpusat.
 *
 * redirect: 'manual' disengaja. Tanpa itu Node mengikuti redirect secara
 * otomatis, dan yang kembali adalah halaman login HTML. Respons itu tidak bisa
 * dibaca, sehingga error aslinya hilang dan yang terlihat hanya "respons
 * tidak bisa dibaca".
 *
 * @param {string} path    path relatif, misalnya '17841419829679724/media'
 * @param {object} params  query atau body
 * @param {'GET'|'POST'} method
 * @param {string} token
 * @returns {Promise<object>} body JSON dari Graph API
 */
async function call(path, params, method, token) {
  const url = new URL(`${HOST}/${VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set('access_token', token);

  let res;
  try {
    res = await fetch(url, { method, redirect: 'manual' });
  } catch (cause) {
    throw new InstagramApiError(
      `Tidak bisa menghubungi graph.instagram.com (${cause.message}). Periksa koneksi internet.`,
      { raw: String(cause) }
    );
  }

  const raw = await res.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    const loc = res.headers.get('location');
    const ct = res.headers.get('content-type') || '(tidak ada)';
    const ket = loc ? ` Dialihkan ke: ${loc}` : '';
    throw new InstagramApiError(
      `Respons Instagram bukan JSON (status ${res.status}, ${ct}).${ket} ` +
        'Ini biasanya berarti token ditolak lalu dialihkan ke halaman login.',
      { httpStatus: res.status, raw: raw.slice(0, 300) }
    );
  }

  if (!res.ok || body?.error) {
    const e = body?.error || {};
    const err = new InstagramApiError(
      e.error_user_msg || e.message || `Instagram API menolak permintaan (status ${res.status}).`,
      {
        code: e.code,
        subcode: e.error_subcode,
        type: e.type,
        httpStatus: res.status,
        raw: e,
      }
    );
    err.penjelasan = jelaskanKode(e.code);
    throw err;
  }

  return body;
}

/**
 * Ambil profil akun Instagram yang terhubung dengan token.
 *
 * Dipakai sebagai pemeriksaan kesehatan: kalau gagal, kredensialnya salah dan
 * tidak ada guna mencoba publish.
 *
 * @returns {Promise<{userId: string, username: string, accountType: string}>}
 */
async function getMe() {
  const { token } = kredensial();
  const body = await call(
    'me',
    { fields: 'user_id,username,name,account_type,followers_count,media_count' },
    'GET',
    token
  );

  // Graph API dengan Instagram Login membungkus hasil dalam { data: [...] }.
  // Sebagian endpoint mengembalikan objek datar tanpa amplop, jadi tiga bentuk
  // ini harus diterima: array di dalam data, objek di dalam data, dan objek
  // polos. Tanpa percabangan ketiga, respons datar akan terbaca undefined.
  const row = Array.isArray(body?.data) ? body.data[0] : (body?.data ?? body);
  if (!row) {
    throw new InstagramApiError('Respons /me tidak berisi data akun.', { raw: body });
  }

  return {
    userId: row.user_id || row.id,
    username: row.username,
    name: row.name,
    accountType: row.account_type,
    followersCount: row.followers_count,
    mediaCount: row.media_count,
  };
}

/**
 * Bikin container media: persiapan untuk satu feed post.
 *
 * PENTING: fungsi ini tidak memposting apa pun. Container yang dibuat di sini
 * akan kedaluwarsa sendiri dalam 24 jam kalau tidak diteruskan ke
 * publishContainer(). Selama masih di tahap ini tidak ada yang muncul di profil
 * dan tidak ada yang kelihatan oleh pengikut.
 *
 * @param {object} args
 * @param {string} args.imageUrl  URL publik ke JPEG atau PNG
 * @param {string} [args.caption] caption, maksimal 2200 karakter
 * @returns {Promise<{creationId: string}>}
 */
async function createImageContainer({ imageUrl, caption }) {
  const { token, igUserId } = kredensial();

  if (!imageUrl) {
    throw new InstagramApiError('imageUrl wajib diisi.', { raw: 'missing imageUrl' });
  }

  const teks = (caption ?? '').trim();
  if (teks.length > BATAS_CAPTION) {
    throw new InstagramApiError(
      `Caption ${teks.length} karakter, batas Instagram ${BATAS_CAPTION}. ` +
        'Pendekkan sebelum memposting.',
      { raw: 'caption too long' }
    );
  }

  const body = await call(
    `${igUserId}/media`,
    {
      image_url: imageUrl,
      caption: teks || undefined,
      // media_type sengaja tidak dikirim. Field itu hanya dipakai untuk reels
      // dan carousel; untuk gambar tunggal Instagram menolaknya kalau diisi.
    },
    'POST',
    token
  );

  if (!body?.id) {
    throw new InstagramApiError('Instagram tidak mengembalikan creation id.', {
      raw: JSON.stringify(body).slice(0, 300),
    });
  }

  return { creationId: body.id };
}

/**
 * Terbitkan container jadi post yang benar-benar muncul di feed.
 *
 * INI LANGKAH YANG BERDAMPAK PUBLIK. Panggilannya tidak idempoten: dua kali
 * dengan creation id yang sama menghasilkan dua postingan. Jangan pernah
 * memanggil ulang tanpa sengaja.
 *
 * @param {string} creationId
 * @returns {Promise<{mediaId: string, permalink: string|null}>}
 */
async function publishContainer(creationId) {
  const { token, igUserId } = kredensial();

  if (!creationId) {
    throw new InstagramApiError('creationId wajib diisi.', { raw: 'missing creationId' });
  }

  const body = await call(
    `${igUserId}/media_publish`,
    { creation_id: creationId },
    'POST',
    token
  );

  if (!body?.id) {
    throw new InstagramApiError('Instagram tidak mengembalikan media id setelah publish.', {
      raw: JSON.stringify(body).slice(0, 300),
    });
  }

  // Permalink tidak ikut dalam respons publish, jadi diambil terpisah supaya
  // dashboard bisa menampilkan tautan ke post yang baru dibuat. Ini pelengkap:
  // kalau gagal diambil, media id tetap tersimpan dan bisa dibaca ulang nanti.
  let permalink = null;
  try {
    const detail = await call(`${body.id}?fields=permalink`, {}, 'GET', token);
    permalink = detail?.permalink ?? null;
  } catch {
    permalink = null;
  }

  return { mediaId: body.id, permalink };
}

/**
 * Cek status container media.
 *
 * Instagram memproses container secara asinkron, terutama kalau ada caption.
 * Publish dipanggil terlalu cepat akan gagal dengan error "media belum siap".
 *
 * @param {string} creationId
 * @returns {Promise<string>} status_code: 'FINISHED' | 'IN_PROGRESS' | 'ERROR'
 */
async function getContainerStatus(creationId) {
  const { token } = kredensial();

  if (!creationId) {
    throw new InstagramApiError('creationId wajib diisi.', { raw: 'missing creationId' });
  }

  const body = await call(
    `${creationId}`,
    { fields: 'status_code' },
    'GET',
    token
  );

  return body?.status_code || 'UNKNOWN';
}

/**
 * Apakah kredensial sudah terisi. Dipakai health check tanpa melempar error.
 *
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(process.env.IG_ACCESS_TOKEN && process.env.IG_USER_ID);
}

module.exports = {
  InstagramApiError,
  jelaskanKode,
  getMe,
  createImageContainer,
  publishContainer,
  getContainerStatus,
  isConfigured,
  VERSION,
  BATAS_CAPTION,
};