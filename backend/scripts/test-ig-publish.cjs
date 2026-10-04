// Uji jalur publikasi Instagram.
//
// CARA PAKAI
//   node scripts/test-ig-publish.cjs            -> dry-run (default, aman)
//   node scripts/test-ig-publish.cjs --publish  -> BENAR-benar memposting
//
// Kenapa dry-run itu default: langkah publish tidak bisa dibatalkan dan tidak
// idempoten. Dua kali jalankan dengan creation id yang sama menghasilkan dua
// postingan di akun sungguhan. Jadi orang yang membaca skrip ini harus
// mengetik --publish dengan sadar, bukan hanya omdat lupa flag.
//
// APA YANG DILAKUKAN DRY-RUN
//   1. GET  /me                        -> cek token masih hidup
//   2. POST /{ig-user-id}/media         -> bikin container
//
// Langkah 2 tidak memposting apa pun. Container cuma menyiapkan media; tidak
// muncul di profil, tidak kelihatan pengikut, dan kedaluwarsa sendiri dalam
// 24 jam kalau tidak diteruskan ke publish. Effeknya: izin
// instagram_business_content_publish terbukti ada atau tidak, tanpa risiko
// apa pun.
//
// APA YANG TAMBAHAN KALAU --publish
//   3. POST /{ig-user-id}/media_publish -> tayangkan ke feed publik
//
// Token tidak pernah dicetak. Credential dibaca dari .env lewat dotenv.
const path = require('path');
const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const ig = require('../src/services/instagramApi');

const PUBLISH = process.argv.includes('--publish');

// Gambar uji. Ganti dengan URL gambar asli kalau menguji container sungguhan.
// Default-nya picsum: stabil, gratis, dan tidak menyentuh aset milik siapa pun.
const GAMBAR = process.env.IG_TEST_IMAGE_URL || 'https://picsum.photos/seed/menfes/1080/1350';
const CAPTION = process.env.IG_TEST_CAPTION || 'Uji coba publikasi otomatis.';

function ok(msg) {
  console.log(`  OK      ${msg}`);
}
function info(msg) {
  console.log(`  INFO    ${msg}`);
}
function step(n, title) {
  console.log(`\n[${n}] ${title}`);
}

async function main() {
console.log('='.repeat(72));
console.log('Uji publikasi Instagram');
console.log(`Mode: ${PUBLISH ? 'PUBLISH (benar-benar memposting)' : 'DRY-RUN (tidak memposting)'}`);
console.log('='.repeat(72));

if (!ig.isConfigured()) {
  console.log('\nGAGAL: IG_ACCESS_TOKEN atau IG_USER_ID belum diisi di .env.');
  process.exit(1);
}

// ── 1. Token masih hidup? ────────────────────────────────────────────────────
step(1, 'Cek token dan akun');

let me;
try {
  me = await ig.getMe();
  ok(`Token hidup. Akun @${me.username} (${me.accountType})`);
  info(`Pengikut ${me.followersCount ?? '?'}, jumlah media ${me.mediaCount ?? '?'}`);
  info(`Versi Graph API ${ig.VERSION}`);

  const envId = process.env.IG_USER_ID;
  if (envId && String(envId) !== String(me.userId)) {
    console.log('\n  GAGAL   IG_USER_ID di .env tidak cocok dengan akun milik token.');
    console.log(`          .env  : ${envId}`);
    console.log(`          token : ${me.userId}`);
    console.log('          Perbaiki IG_USER_ID di .env sebelum lanjut.');
    process.exit(1);
  }
  ok('IG_USER_ID di .env cocok dengan akun token');
} catch (err) {
  console.log(`  GAGAL   ${err.message}`);
  if (err.penjelasan) console.log(`          -> ${err.penjelasan}`);
  process.exit(1);
}

// ── 2. Bikin container (uji izin publish) ────────────────────────────────────
step(2, 'Bikin container media (uji izin instagram_business_content_publish)');

info(`Gambar: ${GAMBAR}`);
info(`Caption: ${CAPTION}`);

let container;
try {
  container = await ig.createImageContainer({ imageUrl: GAMBAR, caption: CAPTION });
  ok(`Container dibuat: ${container.creationId}`);
  ok('Izin instagram_business_content_publish TERBUKTI ADA.');
  info('Belum ada yang diposting. Container ini akan kedaluwarsa dalam 24 jam.');
} catch (err) {
  console.log(`  GAGAL   ${err.message}`);
  if (err.code) console.log(`          Kode error: ${err.code}${err.subcode ? `/${err.subcode}` : ''}`);
  if (err.penjelasan) console.log(`          -> ${err.penjelasan}`);
  if (err.code === 200 || err.code === 3) {
    console.log('\n  Arti: token-nya belum punya izin publish.');
    console.log('  Perbaiki: Meta App Dashboard -> Instagram -> API setup with Instagram');
    console.log('            login -> Generate token -> centang instagram_business_content_publish.');
  }
  process.exit(1);
}

// ── 3. Publish (hanya kalau diminta) ─────────────────────────────────────────
if (!PUBLISH) {
  console.log('\n' + '='.repeat(72));
  console.log('DRY-RUN SELESAI. Tidak ada yang diposting.');
  console.log('Tambahkan --publish kalau benar-benar mau mengirim ke feed.');
  console.log('='.repeat(72));
  process.exit(0);
}

step(3, 'Terbitkan ke feed (AKSI PUBLIK, tidak bisa dibatalkan)');

try {
  const hasil = await ig.publishContainer(container.creationId);
  ok(`Sudah tayang. media id ${hasil.mediaId}`);
  if (hasil.permalink) ok(`Tautan: ${hasil.permalink}`);
  else info('Permalink tidak terbaca, tapi mediocak. Media id di atas tetap sah.');
  console.log('\n' + '='.repeat(72));
  console.log('PUBLISH BERHASIL.');
  console.log('='.repeat(72));
} catch (err) {
  console.log(`  GAGAL   ${err.message}`);
  if (err.code) console.log(`          Kode error: ${err.code}${err.subcode ? `/${err.subcode}` : ''}`);
  if (err.penjelasan) console.log(`          -> ${err.penjelasan}`);
  process.exit(1);
}
}

main().catch((err) => {
  console.error('\nSkrip gagal total:', err);
  process.exit(1);
});