/**
 * Uji services/instagramApi.js tanpa jaringan.
 *
 * Semua panggilan HTTP diarahkan ke stub fetch di bawah, jadi tes ini jalan
 * offline dan tidak pernah menyentuh akun Instagram sungguhan. Yang diuji:
 *
 *   1. credential yang belum lengkap ditolak dengan pesan yang menyebut nama var
 *   2. URL dibangun ke host dan versi yang benar
 *   3. caption melebihi batas ditolak SEBELUM ada panggilan jaringan
 *   4. error dari Graph API dipetakan ke penjelasan yang bisa dibaca admin
 *   5. respons non-JSON dan redirect tidak swallowed jadi pesan generik
 *   6. token tidak pernah bocor ke pesan error
 */
const path = require('path');
const ROOT = __dirname;
require('dotenv').config({ path: path.join(ROOT, '.env') });

const ig = require('./src/services/instagramApi');

// ─── Kerangka tes ─────────────────────────────────────────────────────────────

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'OK   ' : 'GAGAL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

const TOKEN_ASLI = process.env.IG_ACCESS_TOKEN;
const USER_ID_ASLI = process.env.IG_USER_ID;

function setEnv(token, userId) {
  if (token === undefined) delete process.env.IG_ACCESS_TOKEN;
  else process.env.IG_ACCESS_TOKEN = token;
  if (userId === undefined) delete process.env.IG_USER_ID;
  else process.env.IG_USER_ID = userId;
}

// Stub fetch: mencatat permintaan dan mengembalikan respons yang diminta tes.
let calls = [];
let nextResponse = null;

global.fetch = async (url, opts) => {
  const u = url instanceof URL ? url : new URL(String(url));
  calls.push({ url: u, method: (opts && opts.method) || 'GET' });
  if (!nextResponse) throw new Error('stub fetch tidak diberi respons');
  // Bentuk fungsi dipakai saat satu skenario butuh respons berbeda untuk
  // panggilan berikutnya, misalnya publish lalu ambil permalink. nextResponse
  // sengaja tidak ditimpa dengan hasilnya, supaya fungsi tetap hidup untuk
  // panggilan ketiga dan seterusnya.
  return typeof nextResponse === 'function' ? nextResponse(calls.length) : nextResponse;
};

function jsonRes(body, status = 200, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function errRes(message, code, subcode) {
  return jsonRes({ error: { message, type: 'OAuthException', code, error_subcode: subcode } }, 400);
}

function reset() {
  calls = [];
  nextResponse = null;
}

/**
 * Jalankan fungsi yang diperkirakan melempar, kembalikan error-nya.
 * Kalau tidak melempar, kembalikan null supaya tes bisa gagal dengan jelas.
 */
async function grab(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

async function main() {
// ─── 1. Bentuk modul ──────────────────────────────────────────────────────────

const HARAP_ADA = [
  'getMe',
  'createImageContainer',
  'publishContainer',
  'isConfigured',
  'jelaskanKode',
  'InstagramApiError',
];
for (const nama of HARAP_ADA) {
  check(`modul mengekspor ${nama}`, typeof ig[nama] === 'function' || typeof ig[nama] === 'function');
}
check('BATAS_CAPTION = 2200', ig.BATAS_CAPTION === 2200, String(ig.BATAS_CAPTION));

// ─── 2. Pemetaan kode error ───────────────────────────────────────────────────

check('kode 190 dipetakan ke penjelasan token', /token/i.test(ig.jelaskanKode(190) || ''));
check('kode 200 dipetakan ke penjelasan izin', /izin/i.test(ig.jelaskanKode(200) || ''));
check('kode 9007 dipetakan ke format media', /format media/i.test(ig.jelaskanKode(9007) || ''));
check('kode tak dikenal mengembalikan null', ig.jelaskanKode(123456) === null);

// ─── 3. Credential belum lengkap ─────────────────────────────────────────────

setEnv(undefined, undefined);
check('isConfigured false tanpa credential', ig.isConfigured() === false);

let e = await grab(() => ig.getMe());
check('getMelempar tanpa credential', e !== null);
check('pesan menyebut IG_ACCESS_TOKEN', /IG_ACCESS_TOKEN/.test(e?.message || ''), e?.message);
check('pesan menyebut IG_USER_ID', /IG_USER_ID/.test(e?.message || ''));
check('tidak ada panggilan jaringan saat credential kurang', calls.length === 0);

e = await grab(() => ig.createImageContainer({ imageUrl: 'https://x.test/a.jpg' }));
check('createImageContainer melempar tanpa credential', e !== null);

// ─── 4. Credential valid: URL yang dibangun ──────────────────────────────────

setEnv('TOKEN-UJI-12345', '999888777');

reset();
nextResponse = jsonRes({ data: [{ user_id: '999888777', username: 'harkatnekatt' }] });
const me = await ig.getMe();
const u = calls[0].url;
check('host adalah graph.instagram.com', u.host === 'graph.instagram.com', u.host);
check('path memakai versi lalu /me', /^\/v\d+\.\d+\/me$/.test(u.pathname), u.pathname);
check('fields dikirim', (u.searchParams.get('fields') || '').includes('user_id'));
check('access_token ada di query', u.searchParams.get('access_token') === 'TOKEN-UJI-12345');
check('userId dibaca dari data[0]', me.userId === '999888777', me.userId);
check('username dibaca', me.username === 'harkatnekatt', me.username);
check('method GET', calls[0].method === 'GET');

// Bentuk respons lain: objek datar tanpa amplop data.
reset();
nextResponse = jsonRes({ user_id: '111222333', username: 'datar' });
const me2 = await ig.getMe();
check('respons objek datar juga diterima', me2.userId === '111222333', me2.userId);

// ─── 5. Batas caption ────────────────────────────────────────────────────────

const panjang = 'a'.repeat(ig.BATAS_CAPTION + 1);
reset();
e = await grab(() => ig.createImageContainer({ imageUrl: 'https://x.test/a.jpg', caption: panjang }));
check('caption kelebihan ditolak', e !== null);
check('pesan menyebut panjang caption', /2201 karakter/.test(e?.message || ''), e?.message);
check('caption kelebihan tidak memanggil jaringan', calls.length === 0);

reset();
e = await grab(() => ig.createImageContainer({ caption: 'tanpa gambar' }));
check('imageUrl kosong ditolak', e !== null && /imageUrl wajib/.test(e?.message || ''));
check('imageUrl kosong tidak memanggil jaringan', calls.length === 0);

reset();
nextResponse = jsonRes({ id: 'CREATION-1' });
await ig.createImageContainer({ imageUrl: 'https://x.test/a.jpg', caption: 'halo' });
check('caption terkirim saat tidak kosong', calls[0].url.searchParams.get('caption') === 'halo');
check('image_url terkirim', calls[0].url.searchParams.get('image_url') === 'https://x.test/a.jpg');
check('method POST', calls[0].method === 'POST');

reset();
nextResponse = jsonRes({ id: 'CREATION-2' });
await ig.createImageContainer({ imageUrl: 'https://x.test/a.jpg', caption: '   ' });
check('caption kosong tidak terkirim', !calls[0].url.searchParams.has('caption'));
check('media_type tidak terkirim', !calls[0].url.searchParams.has('media_type'));

// ─── 6. Publish ──────────────────────────────────────────────────────────────

reset();
nextResponse = (n) =>
  n === 1
    ? jsonRes({ id: 'MEDIA-99' })
    : jsonRes({ permalink: 'https://www.instagram.com/p/ABC/' });
const pub = await ig.publishContainer('CREATION-1');
check('creation_id terkirim', calls[0].url.searchParams.get('creation_id') === 'CREATION-1');
check('path publish memakai media_publish', /\/media_publish$/.test(calls[0].url.pathname));
check('mediaId dikembalikan', pub.mediaId === 'MEDIA-99', pub.mediaId);
check('permalink diambil terpisah', pub.permalink === 'https://www.instagram.com/p/ABC/');

// Permalink gagal diambil: media id tetap harus balik.
reset();
nextResponse = (n) =>
  n === 1 ? jsonRes({ id: 'MEDIA-100' }) : errRes('permalink tidak boleh', 100, 1234);
const pub2 = await ig.publishContainer('CREATION-1');
check('mediaId tetap ada saat permalink gagal', pub2.mediaId === 'MEDIA-100', pub2.mediaId);
check('permalink null saat gagal diambil', pub2.permalink === null);

reset();
e = await grab(() => ig.publishContainer(''));
check('creationId kosong ditolak', e !== null && /creationId wajib/.test(e?.message || ''));
check('creationId kosong tidak memanggil jaringan', calls.length === 0);

// ─── 7. Error dari Graph API ─────────────────────────────────────────────────

reset();
nextResponse = errRes('Permission is either not granted or has expired', 200);
e = await grab(() => ig.createImageContainer({ imageUrl: 'https://x.test/a.jpg' }));
check('kode 200 masuk ke err.code', e?.code === 200, String(e?.code));
check('penjelasan izin terisi', /izin/i.test(e?.penjelasan || ''), e?.penjelasan);
check('penjelasan tidak bocorkan token', !JSON.stringify(e?.penjelasan || '').includes('TOKEN-UJI'));

reset();
nextResponse = errRes('Invalid OAuth access token', 190);
e = await grab(() => ig.getMe());
check('kode 190 terpetakan', e?.code === 190 && /Token tidak valid/i.test(e?.penjelasan || ''));

reset();
nextResponse = errRes('caption satu', 36003);
e = await grab(() => ig.createImageContainer({ imageUrl: 'https://x.test/a.jpg', caption: 'x' }));
check('kode kebijakan terpetakan', e?.code === 36003 && /kebijakan/i.test(e?.penjelasan || ''));

// ─── 8. Respons rusak tidak jadi pesan generik ───────────────────────────────

reset();
nextResponse = jsonRes('<html><body>login</body></html>', 200, { 'content-type': 'text/html' });
e = await grab(() => ig.getMe());
check('respons HTML ditolak', e !== null);
check('pesan menyebut content-type', /text\/html/.test(e?.message || ''), e?.message);

reset();
nextResponse = jsonRes('', 302, { location: 'https://www.facebook.com/login' });
e = await grab(() => ig.getMe());
check('redirect terdeteksi lewat status', /status 302/.test(e?.message || ''), e?.message);
check('redirect mentioned location', /facebook\.com\/login/.test(e?.message || ''));

reset();
nextResponse = jsonRes('', 204);
e = await grab(() => ig.getMe());
check('body kosong ditolak tanpa crash', e !== null);

reset();
nextResponse = null;
const origFetch = global.fetch;
global.fetch = async () => {
  throw new Error('ECONNREFUSED');
};
e = await grab(() => ig.getMe());
global.fetch = origFetch;
check('koneksi gagal dilaporkan jelas', /Tidak bisa menghubungi/.test(e?.message || ''), e?.message);
check('token tidak bocor di pesan koneksi', !/TOKEN-UJI/.test(e?.message || ''));

// ─── Ringkasan ────────────────────────────────────────────────────────────────

setEnv(TOKEN_ASLI, USER_ID_ASLI);

const gagal = results.filter((r) => !r.pass);
console.log('\n' + '='.repeat(60));
console.log(`${results.length - gagal.length}/${results.length} lulus`);
if (gagal.length > 0) {
  console.log('\nGAGAL:');
  for (const g of gagal) console.log(`  - ${g.name}`);
}
console.log('='.repeat(60));
process.exit(gagal.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTes gagal total:', err);
  process.exit(1);
});