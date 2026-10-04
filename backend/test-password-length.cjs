/**
 * Uji batas panjang password di ketiga jalur: login, change-password, seed.
 *
 * Yang diuji bukan hanya "ditolak", tapi bahwa serangannya benar-benar
 * tidak bisa-gerai: karena tidak ada jalur yang bisa membuat password
 * > 72 byte tersimpan, maka triplet "orang hanya tahu 72 byte pertama"
 * tidak akan pernah punya hash untuk dicocokkan.
 *
 * DB: MariaDB lokal, bukan produksi.
 */
process.chdir(__dirname);
const path = require('path');

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'OK   ' : 'GAGAL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

(async () => {
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';

  const app = require(path.join(__dirname, 'src/index.js'));
  await new Promise((r) => setTimeout(r, 700));
  const server = app.listen(0);
  await new Promise((r) => setTimeout(r, 300));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { PrismaClient } = require('@prisma/client');
  const bcrypt = require('bcryptjs');
  const prisma = new PrismaClient();

  const USER = 'pwlen-test';
  const PASS = 'password-uji-123';
  await prisma.admin.deleteMany({ where: { username: USER } });
  await prisma.admin.create({
    data: { username: USER, password: await bcrypt.hash(PASS, 10) },
  });

  let n = 0;
  const call = (p, { method = 'GET', body, token } = {}) =>
    fetch(`${base}${p}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        // IP unik per request: limiter login 5/15 menit tidak boleh
        // mengaburkan pengukuran batas panjang.
        'X-Forwarded-For': `10.55.0.${(n++ % 250) + 1}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  const me = (token) => call('/api/auth/me', { token });

  const login = (username, password) =>
    call('/api/auth/login', { method: 'POST', body: { username, password } });

  // ─── 1. login menolak > 72 byte ────────────────────────────────────────────
  console.log('── 1. login: batas panjang ──');
  let r = await login(USER, 'A'.repeat(72) + 'RAHASIA');
  check('password 84 byte ditolak di login', r.status === 400, `HTTP ${r.status}`);
  check('respons 400 menyebut batasnya',
    r.status === 400 && /72/.test(JSON.stringify(r.body)), JSON.stringify(r.body));

  r = await login(USER, 'A'.repeat(100000));
  check('password 100.000 byte ditolak di login', r.status === 400, `HTTP ${r.status}`);

  // ─── 2. tepat 72 byte tetap jalan normal ──────────────────────────────────
  console.log('\n── 2. login: tepat di batas tetap normal ──');
  r = await login(USER, 'A'.repeat(72));
  check('password 72 byte TIDAK ditolak (masuk ke bcrypt, jadi 401)',
    r.status === 401, `HTTP ${r.status}`);
  r = await login(USER, PASS);
  check('password asli 16 byte tetap bisa login', r.status === 200, `HTTP ${r.status}`);
  let token = r.body && r.body.token;

  // ─── 3. multibyte: .length bukan ukuran yang benar ─────────────────────────
  console.log('\n── 3. multibyte: yang diukur byte, bukan .length ──');
  // `.length` di JavaScript menghitung UTF-16 code unit, bukan karakter dan
  // bukan byte. Emoji di astral plane (U+1F600) adalah surrogate pair, jadi
  // setiap emoji dihitung 2 unit dan 4 byte.
  //
  // Artinya ada DUA cara cek naive gagal, dan keduanya ditutup oleh byte:
  //   (a) .length terlalu kecil vs byte  -> 30 emoji: .length 60, byte 120
  //   (b) .length terlalu besar vs byte  -> 30 huruf ASCII: .length 30, byte 30
  const emoji30 = '\u{1F600}'.repeat(30);
  check('fixture: 30 emoji -> .length 60 (UTF-16 unit), 120 byte',
    emoji30.length === 60 && Buffer.byteLength(emoji30, 'utf8') === 120,
    `.length=${emoji30.length}, byte=${Buffer.byteLength(emoji30, 'utf8')}`);
  r = await login(USER, emoji30);
  check('30 emoji DITOLAK (120 byte) walau .length cuma 60',
    r.status === 400, `HTTP ${r.status}`);
  check('cek memakai byte, bukan .length',
    r.status === 400, 'kalau pakai .length, 60 < 72 akan lolos');

  // Batas tepat: 18 emoji = 36 unit = 72 byte, harus TIDAK ditolak.
  const emoji18 = '\u{1F600}'.repeat(18);
  check('fixture: 18 emoji -> .length 36, 72 byte',
    Buffer.byteLength(emoji18, 'utf8') === 72 && emoji18.length === 36,
    `.length=${emoji18.length}, byte=${Buffer.byteLength(emoji18, 'utf8')}`);
  r = await login(USER, emoji18);
  check('72 byte pas (18 emoji) TIDAK ditolak -> masuk bcrypt (401)',
    r.status === 401, `HTTP ${r.status}`);

  // 19 emoji = 76 byte, harus ditolak.
  const emoji19 = '\u{1F600}'.repeat(19);
  check('fixture: 19 emoji = 76 byte',
    Buffer.byteLength(emoji19, 'utf8') === 76,
    `.length=${emoji19.length}, byte=${Buffer.byteLength(emoji19, 'utf8')}`);
  r = await login(USER, emoji19);
  check('76 byte (19 emoji) ditolak', r.status === 400, `HTTP ${r.status}`);

  // Sebaliknya: string multi-byte yang .length-nya MELEBIHI 72 tapi byte-nya
  // juga melebihi, harus tetap ditolak (tidak ada celah kebocoran di arah ini).
  const ascii72 = 'a'.repeat(72);
  r = await login(USER, ascii72 + '!');
  check('73 byte ASCII ditolak', r.status === 400, `HTTP ${r.status}`);

  // ─── 4. respons seragam: tidak membocorkan keberadaan akun ────────────────
  console.log('\n── 4. tidak ada kebocoran informasi lewat 400 ──');
  const ada = await login(USER, 'A'.repeat(200));
  const tidakAda = await login('user-tidak-ada-sama-sekali', 'A'.repeat(200));
  check('akun ada dan tidak ada -> status sama',
    ada.status === tidakAda.status, `${ada.status} vs ${tidakAda.status}`);
  check('akun ada dan tidak ada -> pesan sama',
    JSON.stringify(ada.body) === JSON.stringify(tidakAda.body),
    JSON.stringify(tidakAda.body));

  // ─── 5. change-password menolak > 72 byte ─────────────────────────────────
  console.log('\n── 5. change-password: batas panjang ──');
  r = await call('/api/auth/change-password', {
    method: 'POST', token,
    body: { currentPassword: PASS, newPassword: 'B'.repeat(73) },
  });
  check('password baru 73 byte ditolak', r.status === 400, `HTTP ${r.status}`);

  r = await call('/api/auth/change-password', {
    method: 'POST', token,
    body: { currentPassword: PASS, newPassword: 'B'.repeat(72) },
  });
  check('password baru 72 byte diterima', r.status === 200, `HTTP ${r.status}`);

  // Ganti password yang berhasil membatalkan token yang memakainya, jadi
  // token di bawah harus diganti dengan yang dikembalikan respons. Tanpa ini
  // setiap permintaan berikutnya gagal 401 karena alasan yang salah, dan
  // assertion "attack gagal" jadi lolos karena token basi, bukan karena
  // serangannya benar-benar ditolak.
  const tokenSetelah72 = r.body?.token;
  check('ganti password mengembalikan token pengganti', !!tokenSetelah72);
  if (tokenSetelah72) token = tokenSetelah72;

  // kembalikan ke PASS supaya sisa test tidak compounding
  const kembaliKePass = await call('/api/auth/change-password', {
    method: 'POST', token,
    body: { currentPassword: 'B'.repeat(72), newPassword: PASS },
  });
  check('password dikembalikan ke nilai semula', kembaliKePass.status === 200,
    `HTTP ${kembaliKePass.status}`);
  if (kembaliKePass.body?.token) token = kembaliKePass.body.token;

  // ─── 6. THE POINT: serangan truncation tidak bisa disediakan ───────────────
  console.log('\n── 6. serangan truncation tidak bisa disiapkan ──');
  // Attack: set password 72 byte + rahasia, lalu login hanya dengan 72 byte.
  const depan = 'T'.repeat(72);
  const penuh = depan + 'RAHASIA';

  const setLong = await call('/api/auth/change-password', {
    method: 'POST', token,
    body: { currentPassword: PASS, newPassword: penuh },
  });
  check('tidak bisa membuat password > 72 byte lewat change-password',
    setLong.status === 400, `HTTP ${setLong.status}`);
  // Password tidak berubah, jadi token di sini masih yang benar. Pemeriksaan
  // ini penting: tanpa itu, assertion "attack gagal" di bawah bisa lolos
  // hanya karena token-nya sudah mati karena alasan lain.
  const tokenMasihSegar = await me(token);
  check('token masih sah sesudah percobaan ditolak (kontrol)',
    tokenMasihSegar.status === 200,
    `HTTP ${tokenMasihSegar.status} - kalau bukan 200, test di bawah tidak membuktikan apa pun`);

  const kosongkan = await login(USER, depan);
  check('akun masih memakai password yang sebenarnya (attack gagal)',
    kosongkan.status === 401, `HTTP ${kosongkan.status}`);

  const passwordAsliMasih = await login(USER, PASS);
  check('password yang benar tetap yang berlaku',
    passwordAsliMasih.status === 200, `HTTP ${passwordAsliMasih.status}`);

  // ─── 7. normal error handling tidak rusak ─────────────────────────────────
  console.log('\n── 7. error handling biasa tidak terganggu ──');
  r = await login(USER, 'salah');
  check('password salah (normal) -> 401 bukan 400', r.status === 401, `HTTP ${r.status}`);
  r = await login(USER, 'pendek');
  check('password 6 karakter salah -> 401 (min 8 hanya berlaku saat SET)',
    r.status === 401, `HTTP ${r.status}`);
  r = await login('', 'apa saja');
  check('username kosong -> 400', r.status === 400, `HTTP ${r.status}`);

  await prisma.admin.deleteMany({ where: { username: USER } });
  server.close();
  await prisma.$disconnect();

  const failed = results.filter((x) => !x.pass);
  console.log(`\n${'='.repeat(64)}`);
  console.log(`${results.length - failed.length}/${results.length} pemeriksaan lolos`);
  if (failed.length) {
    console.log('\nGAGAL:');
    for (const f of failed) console.log(`  - ${f.name}`);
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('ERROR:', e.stack);
  process.exit(1);
});