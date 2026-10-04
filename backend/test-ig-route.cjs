/**
 * Uji route POST /api/admin/menfes/:id/post tanpa menyentuh Instagram.
 *
 * Cakupannya bukan "berhasil tidak", tapi hal-hal yang mudah salah dan
 * membuka celah:
 *
 *  1. Auth harus jalan SEBELUM parser gambar. Kalau urutannya terbalik,
 *     siapa pun tanpa token bisa memaksa server membaca 8 MB per request tanpa
 *     batas, karena globalLimiter juga baru aktif setelah body parser.
 *  2. Validasi gambar dan caption harus menolak SEBELUM terbitan dipanggil,
 *     supaya kesalahan ketik admin tidak pernah mengubah status menfes.
 *  3. Menfes yang belum APPROVED tidak boleh tayang.
 *  4. Kode error dari lapisan bawah harus diteruskan apa adanya, bukan
 *     diratakan jadi 500.
 *
 * TIDAK ada panggilan ke Instagram. Fungsi terbitkan ditukar, tapi modulnya
 * sendiri tetap asli: periksaGambar, TIPE_BOKEH dan UKURAN_MAKS yang diuji
 * di sini adalah kode yang benar-benar dipakai produksi. Bot Telegram juga
 * di-stub supaya test ini tidak memicu polling sungguhan.
 *
 * Row yang dibuat test ini dihapus kembali di akhir, jadi tidak ada sisa.
 */
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');

const ROOT = __dirname;
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

// ─── Stub bot Telegram: jangan pernah menyentuh api.telegram.org ─────────────
class FakeBot extends EventEmitter {
  async sendMessage() { return { message_id: 1 }; }
  async editMessageText() { return { message_id: 1 }; }
  async answerCallbackQuery() { return true; }
  async getMe() { return { id: 1, username: 'fakebot' }; }
  processUpdate() {}
}
const asliLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'node-telegram-bot-api') return FakeBot;
  return asliLoad.call(this, req, parent, isMain);
};

// ─── Tangkap stdout supaya bisa memeriksa audit ──────────────────────────────
let captured = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  captured.push(String(chunk));
  return realWrite(chunk, ...rest);
};
const auditLines = () =>
  captured.filter((l) => l.includes('[AUDIT]')).map((l) => l.slice(l.indexOf('[AUDIT]')));

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'OK   ' : 'GAGAL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

// ─── Bars byte yang harus utuh setelah melewati multipart ────────────────────
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

(async () => {
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  // Token palsu. Yang dibutuhkan fungsi isConfigured hanya Genome ada nilai,
  // tidak ada request yang keluar ke Instagram.
  process.env.IG_ACCESS_TOKEN = 'IGAA-token-palsu-untuk-uji-route';
  process.env.IG_USER_ID = '1234567890';

  const { PrismaClient } = require('@prisma/client');
  const bcrypt = require('bcryptjs');
  const prisma = new PrismaClient();

  const igPublish = require(path.join(ROOT, 'src/services/igPublish'));

  // Hanya terbitkan yang ditukar. Properti modul diganti, dan adminController
  // membaca igPublish.terbitkan saat request datang, bukan saat modul dimuat,
  // jadi pertukaran ini benar-benar dipakai oleh controller.
  const panggilan = [];
  let jebakan = null;
  igPublish.terbitkan = async (args) => {
    panggilan.push(args);
    if (jebakan) throw jebakan;
    return {
      mediaId: 'MEDIA-UJI-1',
      permalink: 'https://www.instagram.com/p/UJI/',
      imageUrl: 'https://menfs.onrender.com/uploads/ig/uji.jpg',
    };
  };

  const app = require(path.join(ROOT, 'src/index.js'));
  await new Promise((r) => setTimeout(r, 700));
  const server = app.listen(0);
  await new Promise((r) => setTimeout(r, 300));
  const base = `http://127.0.0.1:${server.address().port}`;

  // ─── Admin uji ─────────────────────────────────────────────────────────────
  const USER = 'ig-route-test-admin';
  const PASS = 'password-ig-route-123';
  await prisma.admin.deleteMany({ where: { username: USER } });
  const admin = await prisma.admin.create({
    data: { username: USER, password: await bcrypt.hash(PASS, 10) },
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.91.0.1' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const token = (await login.json()).token;
  check('admin uji berhasil login', !!token);

  // ─── Menfes uji ────────────────────────────────────────────────────────────
  const TANDAN = 'IG-ROUTE-TEST - dihapus otomatis';
  const dibuat = [];
  const buatMenfes = async (status) => {
    const m = await prisma.menfes.create({ data: { message: TANDAN, status } });
    dibuat.push(m.id);
    return m;
  };
  const approved = await buatMenfes('APPROVED');
  const pending = await buatMenfes('PENDING');

  // Header tetap dipakai. Content-Type SENGAJA tidak diisi di sini: fetch yang
  // memasang boundary multipart sendiri, dan boundary yang kita tulis manual
  // akan membuat body tidak bisa diurai.
  const KIRIM = { Authorization: `Bearer ${token}`, 'X-Forwarded-For': '10.91.0.2' };

  // Bangun multipart persis seperti browser.
  const formDengan = ({ image = null, tipe = 'image/jpeg', caption = null } = {}) => {
    const fd = new FormData();
    if (image !== null) {
      fd.append('image', new Blob([image], { type: tipe }), 'menfes.jpg');
    }
    if (caption !== null) fd.append('caption', caption);
    return fd;
  };

  const Kirim = (id, fd, headers = {}) =>
    fetch(`${base}/api/admin/menfes/${id}/post`, {
      method: 'POST',
      headers: { ...KIRIM, ...headers },
      body: fd,
    });

  // ═══ 1. Auth dulu, baru parser gambar ═════════════════════════════════════
  console.log('\n── 1. auth mendahului parser gambar ──');
  panggilan.length = 0;

  let r = await fetch(`${base}/api/admin/menfes/${approved.id}/post`, {
    method: 'POST',
    headers: { 'X-Forwarded-For': '10.91.0.3' },
    body: formDengan({ image: JPEG }),
  });
  check('tanpa token ditolak 401', r.status === 401, `HTTP ${r.status}`);
  check('tidak ada panggilan publish', panggilan.length === 0);

  r = await fetch(`${base}/api/admin/menfes/${approved.id}/post`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-palsa', 'X-Forwarded-For': '10.91.0.4' },
    body: formDengan({ image: JPEG }),
  });
  check('token palsu ditolak 401', r.status === 401, `HTTP ${r.status}`);

  // Body 9 MB tanpa token. Parser gambar dibatasi 8 MB, jadi kalau auth berada
  // di belakang parser, jawabannya pasti 413 "entity too large". Jawaban 401
  // membuktikan body 9 MB itu tidak pernah dibaca sama sekali.
  // membuktikan body 9 MB itu tidak pernah dibaca sama sekali.
  r = await fetch(`${base}/api/admin/menfes/${approved.id}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=xyz', 'X-Forwarded-For': '10.91.0.5' },
    body: Buffer.alloc(9 * 1024 * 1024, 0x41),
  });
  check(
    'body 9 MB tanpa token ditolak 401, bukan 413',
    r.status === 401,
    `HTTP ${r.status} (413 berarti auth ada di belakang parser)`
  );

  // ═══ 2. Content-Type yang salah ═══════════════════════════════════════════
  console.log('\n── 2. content-type ──');
  panggilan.length = 0;

  r = await fetch(`${base}/api/admin/menfes/${approved.id}/post`, {
    method: 'POST',
    headers: { ...KIRIM, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption: 'halo' }),
  });
  check('JSON ditolak 415', r.status === 415, `HTTP ${r.status}`);
  check('tidak ada panggilan publish', panggilan.length === 0);

  r = await fetch(`${base}/api/admin/menfes/${approved.id}/post`, {
    method: 'POST',
    headers: { ...KIRIM, 'Content-Type': 'text/plain' },
    body: 'bukan multipart sama sekali',
  });
  check('body teks ditolak 415', r.status === 415, `HTTP ${r.status}`);

  r = await Kirim(approved.id, formDengan({}));
  check('multipart tanpa field image ditolak 400', r.status === 400, `HTTP ${r.status}`);
  check('pesan menyebut nama field', /image/.test((await r.clone().text()) || ''));

  // ═══ 3. Validasi sebelum terbitan ═════════════════════════════════════════
  console.log('\n── 3. validasi menolak sebelum menyentuh Instagram ──');

  r = await Kirim(approved.id, formDengan({ image: JPEG, tipe: 'text/plain' }));
  check('tipe gambar salah ditolak 400', r.status === 400, `HTTP ${r.status}`);
  check('tidak ada panggilan publish', panggilan.length === 0);

  r = await Kirim(approved.id, formDengan({ image: Buffer.alloc(0), tipe: 'image/jpeg' }));
  check('gambar kosong ditolak 400', r.status === 400, `HTTP ${r.status}`);
  check('tidak ada panggilan publish', panggilan.length === 0);

  // Batas parser body sengaja di atas batas gambar, supaya pesan yang sampai ke
  // admin berasal dari validasi kita: "Gambar 9.0 MB, batas 8 MB." Kalau batas
  // parser ikut 8 MB, body-parser yang menolak lebih dulu dan admin membaca
  // "request entity too large".
  r = await Kirim(approved.id, formDengan({ image: Buffer.alloc(9 * 1024 * 1024), tipe: 'image/jpeg' }));
  check('gambar 9 MB ditolak 400 dengan pesan batas', r.status === 400, `HTTP ${r.status}`);
  check('pesan menyebut ukuran dan batas', /9\.0 MB/.test(await r.clone().text()));
  check('tidak ada panggilan publish', panggilan.length === 0);

  // Parser body tetap jadi penutup untuk request gila: 11 MB melewati batas 10 MB.
  r = await Kirim(approved.id, formDengan({ image: Buffer.alloc(11 * 1024 * 1024), tipe: 'image/jpeg' }));
  check('body 11 MB ditolak 413', r.status === 413, `HTTP ${r.status}`);
  check('tidak ada panggilan publish', panggilan.length === 0);

  r = await Kirim(approved.id, formDengan({ image: JPEG, caption: 'z'.repeat(2201) }));
  check('caption 2201 karakter ditolak 400', r.status === 400, `HTTP ${r.status}`);
  check('tidak ada panggilan publish', panggilan.length === 0);

  // Batas bawah harus diterima.
  r = await Kirim(approved.id, formDengan({ image: JPEG, caption: 'z'.repeat(2200) }));
  check('caption 2200 karakter diterima', r.status === 200, `HTTP ${r.status}`);

  // ═══ 4. Hanya menfes APPROVED ═════════════════════════════════════════════
  console.log('\n── 4. hanya menfes APPROVED ──');
  panggilan.length = 0;

  r = await Kirim(pending.id, formDengan({ image: JPEG }));
  check('menfes PENDING ditolak 409', r.status === 409, `HTTP ${r.status}`);
  check('pesan menyebut statusnya', /PENDING/.test(await r.text()));
  check('tidak ada panggilan publish', panggilan.length === 0);

  r = await Kirim('00000000-0000-4000-8000-000000000000', formDengan({ image: JPEG }));
  check('menfes tidak ada ditolak 404', r.status === 404, `HTTP ${r.status}`);
  check('tidak ada panggilan publish', panggilan.length === 0);

  // ═══ 5. Jalur sukses ═════════════════════════════════════════════════════
  console.log('\n── 5. jalur sukses ──');
  panggilan.length = 0;
  captured.length = 0;

  r = await Kirim(approved.id, formDengan({ image: JPEG, caption: '  halo dunia  ' }));
  const body = await r.json();
  check('berhasil 200', r.status === 200, `HTTP ${r.status}`);
  check('mediaId diteruskan', body.data?.igMediaId === 'MEDIA-UJI-1');
  check('permalink diteruskan', /instagram\.com/.test(body.data?.igPermalink || ''));
  check('terbitkan dipanggil tepat sekali', panggilan.length === 1, String(panggilan.length));

  const arg = panggilan[0];
  check('menfesId benar', arg.menfesId === approved.id);
  check('buffer gambar utuh byte per byte', arg.imageBuffer?.equals(JPEG) === true,
    `${arg.imageBuffer?.length} byte, benar ${JPEG.length}`);
  check('mime diteruskan apa adanya', arg.mimeType === 'image/jpeg', arg.mimeType);
  check('caption diteruskan mentah ke service', arg.caption === '  halo dunia  ', JSON.stringify(arg.caption));

  const barisAudit = auditLines().find((l) => l.includes('menfes.ig_publish')) || '';
  check('audit mencatat menfes.ig_publish', !!barisAudit);
  check('audit mencatat mediaId', barisAudit.includes('MEDIA-UJI-1'));
  check('audit tidak membocorkan caption', !barisAudit.includes('halo dunia'));

  // ═══ 6. Kode error diteruskan apa adanya ══════════════════════════════════
  console.log('\n── 6. penerusan kode error ──');

  const buatError = (kode, pesan) => Object.assign(new Error(pesan), { kode });

  jebakan = buatError('SUDAH_TAYANG', 'Menfes ini sudah tayang di https://www.instagram.com/p/OLD/.');
  r = await Kirim(approved.id, formDengan({ image: JPEG }));
  check('SUDAH_TAYANG jadi 409', r.status === 409, `HTTP ${r.status}`);
  check('pesan diteruskan', /sudah tayang/.test(await r.text()));

  jebakan = buatError('SEDANG_PROSES', 'Menfes sedang diproses.');
  r = await Kirim(approved.id, formDengan({ image: JPEG }));
  check('SEDANG_PROSES jadi 409', r.status === 409, `HTTP ${r.status}`);

  jebakan = buatError('NOT_FOUND', 'Menfes tidak ditemukan.');
  r = await Kirim(approved.id, formDengan({ image: JPEG }));
  check('NOT_FOUND jadi 404', r.status === 404, `HTTP ${r.status}`);

  const igApi = require(path.join(ROOT, 'src/services/instagramApi'));
  jebakan = new igApi.InstagramApiError('Kode 190: token kedaluwarsa.', 190);
  r = await Kirim(approved.id, formDengan({ image: JPEG }));
  check('kesalahan Instagram jadi 502', r.status === 502, `HTTP ${r.status}`);
  check('penjelasan error Instagram diteruskan', /token kedaluwarsa/.test(await r.text()));

  jebakan = new Error('database padam');
  r = await Kirim(approved.id, formDengan({ image: JPEG }));
  check('error tak dikenal jadi 500', r.status === 500, `HTTP ${r.status}`);
  jebakan = null;

  // ═══ 7. Server tidak dikonfigurasi ════════════════════════════════════════
  console.log('\n── 7. tanpa kredensial ──');
  const simpanToken = process.env.IG_ACCESS_TOKEN;
  process.env.IG_ACCESS_TOKEN = '';
  r = await Kirim(approved.id, formDengan({ image: JPEG }));
  check('tanpa token server membalas 503', r.status === 503, `HTTP ${r.status}`);
  check('pesan menyebut nama env', /IG_ACCESS_TOKEN/.test(await r.text()));
  process.env.IG_ACCESS_TOKEN = simpanToken;

  // ─── Bersihkan ─────────────────────────────────────────────────────────────
  await prisma.menfes.deleteMany({ where: { id: { in: dibuat } } });
  await prisma.admin.deleteMany({ where: { username: USER } });
  server.close();
  await prisma.$disconnect();

  const gagal = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(60));
  console.log(`${results.length - gagal.length}/${results.length} lulus`);
  if (gagal.length > 0) {
    console.log('\nGAGAL:');
    for (const g of gagal) console.log(`  - ${g.name}`);
  }
  console.log('='.repeat(60));
  process.exit(gagal.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nTes gagal total:', err);
  process.exit(1);
});
