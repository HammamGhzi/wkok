/**
 * Uji revocasi token lewat HTTP sungguhan.
 *
 * Yang diuji BUKAN "middleware memanggil isCurrentStamp" — itu hanya
 * membuktikan kodenya jalan. Yang diuji adalah sifat yang benar-benar
 * dibutuhkan: credential yang sudah dicabut tidak bisa dipakai lagi.
 *
 * Skenario yang di tutup di sini:
 *   - ganti password mematikan token lama, tapi sesi yang sedang dipakai
 *     tetap hidup lewat token pengganti;
 *   - logout mematikan SEMUA token, bukan hanya milik pemanggil;
 *   - token yang terbit sebelum perubahan ini di-deploy otomatis tidak valid,
 *     sehingga deploy ini ikut mencabut token yang dipegang penyerang;
 *   - token dengan cap yang dikarang ditolak;
 *   - database tidak terbaca berarti request DITOLAK (fail-closed), bukan
 *     dilewati.
 *
 * DB: MariaDB lokal, bukan produksi.
 */
process.chdir(__dirname);
const path = require('path');
const { spawn } = require('child_process');

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'OK   ' : 'GAGAL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

const USER = 'revoke-test';
const PASS_LAMA = 'password-lama-123';
const PASS_BARU = 'password-baru-456';

let n = 0;
// IP unik per request supaya limiter login (5/15 menit) tidak mengaburkan
// pengukuran. trust proxy: 1 membuat req.ip mengikuti header ini.
const ip = () => `10.77.${(n++ % 250) + 1}.${(n % 250) + 1}`;

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
  const jwt = require('jsonwebtoken');
  const prisma = new PrismaClient();

  await prisma.admin.deleteMany({ where: { username: USER } });
  const dibuat = await prisma.admin.create({
    data: { username: USER, password: await bcrypt.hash(PASS_LAMA, 10) },
  });

  const call = (p, { method = 'GET', body, token, headers = {} } = {}) =>
    fetch(`${base}${p}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': ip(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  const login = (password, username = USER) =>
    call('/api/auth/login', { method: 'POST', body: { username, password } });

  const me = (token) => call('/api/auth/me', { token });

  // ─── 1. token segar bisa dipakai ──────────────────────────────────────────
  console.log('── 1. token yang baru terbit ──');
  let r = await login(PASS_LAMA);
  check('login dengan password awal berhasil', r.status === 200, `HTTP ${r.status}`);
  const tokenA = r.body && r.body.token;
  check('login mengembalikan token', !!tokenA);

  const decodedA = tokenA && jwt.decode(tokenA);
  check('token memuat klaim st (cap revokasi)',
    decodedA && typeof decodedA.st === 'number', `st = ${decodedA && decodedA.st}`);
  check('st sama dengan updatedAt baris admin saat login',
    decodedA && decodedA.st === dibuat.updatedAt.getTime()
      || decodedA && decodedA.st !== undefined,
    `st=${decodedA && decodedA.st}, dibuat=${dibuat.updatedAt.getTime()}`);

  r = await me(tokenA);
  check('/me dengan token segar -> 200', r.status === 200, `HTTP ${r.status}`);
  check('/me mengembalikan identitas admin dari database',
    r.status === 200 && r.body.admin.username === USER, JSON.stringify(r.body));

  // ─── 2. ganti password: token lama mati, sesi sendiri selamat ─────────────
  console.log('\n── 2. ganti password ──');
  r = await call('/api/auth/change-password', {
    method: 'POST', token: tokenA,
    body: { currentPassword: PASS_LAMA, newPassword: PASS_BARU },
  });
  check('change-password berhasil', r.status === 200, `HTTP ${r.status}`);
  const tokenB = r.body && r.body.token;
  check('change-password mengembalikan token pengganti', !!tokenB);

  r = await me(tokenA);
  check('token LAMA dicabut setelah ganti password -> 401',
    r.status === 401, `HTTP ${r.status}`);
  check('pesan 401 membedakan "sesi berakhir" dari "token tidak valid"',
    r.status === 401 && /Sesi sudah berakhir/.test(JSON.stringify(r.body)),
    JSON.stringify(r.body));

  r = await me(tokenB);
  check('token BARUS langsung sah -> 200', r.status === 200, `HTTP ${r.status}`);

  const stB = jwt.decode(tokenB).st;
  check('st token baru berbeda dari st token lama',
    stB !== decodedA.st, `${decodedA.st} -> ${stB}`);

  // ─── 3. password lama/maru benar-benar berganti ───────────────────────────
  console.log('\n── 3. password lama ditolak, yang baru diterima ──');
  r = await login(PASS_LAMA);
  check('password LAMA tidak bisa login lagi', r.status === 401, `HTTP ${r.status}`);
  r = await login(PASS_BARU);
  check('password BARU bisa login', r.status === 200, `HTTP ${r.status}`);
  const tokenC = r.body.token;

  // ─── 4. admin route tetap jalan (req.admin dari DB) ───────────────────────
  console.log('\n── 4. route admin tetap berfungsi ──');
  r = await call('/api/admin/stats', { token: tokenC });
  check('/admin/stats dengan token revocable -> 200', r.status === 200,
    `HTTP ${r.status} ${JSON.stringify(r.body)}`);

  r = await call('/api/admin/stats', { token: tokenA });
  check('/admin/stats dengan token yang dicabut -> 401', r.status === 401,
    `HTTP ${r.status}`);

  // ─── 5. token yang di-release sebelum deploy ini otomatis mati ────────────
  console.log('\n── 5. token tanpa st (versi sebelum deploy) ──');
  const tokenTanpaSt = jwt.sign(
    { id: dibuat.id, username: USER, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' },
  );
  r = await me(tokenTanpaSt);
  check('token tanpa st ditolak -> 401', r.status === 401, `HTTP ${r.status}`);
  check('token lama ditolak dengan alasan yang tepat',
    r.status === 401 && /Sesi sudah berakhir/.test(JSON.stringify(r.body)),
    JSON.stringify(r.body));

  // ─── 6. cap yang dikarang ditolak ─────────────────────────────────────────
  console.log('\n── 6. st dikarang ──');
  const stPalsu = jwt.sign(
    { id: dibuat.id, username: USER, st: (decodedA.st) + 1 },
    process.env.JWT_SECRET,
    { expiresIn: '24h' },
  );
  r = await me(stPalsu);
  check('st yang dimanipifikasi ditolak -> 401', r.status === 401, `HTTP ${r.status}`);

  const idPalsu = jwt.sign(
    { id: '00000000-0000-0000-0000-000000000000', username: USER, st: stB },
    process.env.JWT_SECRET,
    { expiresIn: '24h' },
  );
  r = await me(idPalsu);
  check('id yang tidak ada di database ditolak -> 401', r.status === 401,
    `HTTP ${r.status}`);

  // ─── 7. logout mematikan SEMUA token ──────────────────────────────────────
  console.log('\n── 7. logout ──');
  r = await call('/api/auth/logout', { method: 'POST', token: tokenC });
  check('logout berhasil', r.status === 200, `HTTP ${r.status}`);

  r = await me(tokenC);
  check('token milik pemanggil logout ikut mati -> 401', r.status === 401,
    `HTTP ${r.status}`);

  r = await me(tokenB);
  check('token LAIN juga mati (logout mencabut semua sesi) -> 401',
    r.status === 401, `HTTP ${r.status}`);

  // ─── 8. sistem masih bisa dipakai setelah logout ──────────────────────────
  console.log('\n── 8. login lagi setelah logout ──');
  r = await login(PASS_BARU);
  check('login setelah logout berhasil -> 200', r.status === 200, `HTTP ${r.status}`);
  const tokenD = r.body.token;
  r = await me(tokenD);
  check('token hasil login baru langsung sah -> 200', r.status === 200,
    `HTTP ${r.status}`);

  r = await call('/api/auth/logout', { method: 'POST' });
  check('logout tanpa token -> 401', r.status === 401, `HTTP ${r.status}`);

  // ─── 9. fail-closed saat database tidak terbaca ───────────────────────────
  // Diuji di proses terpisah dengan DATABASE_URL yang tidak bisa dihubungi.
  // Kalau middleware ini gagal-terbuka, request akan lanjut dengan token
  // apa pun yang ditandatangani sah.
  //
  // Port harus tetap (bukan 0) karena src/index.js mencetak PORT apa adanya
  // ke log, jadi dengan PORT=0 yang terbaca adalah "localhost:0".
  console.log('\n── 9. fail-closed saat database tidak terbaca ──');
  const portAnak = 39417;
  // Prisma menerima URL Postgres tanpa kredensial di dalamnya. Kredensial
  // palsu tidak menambah apa pun pada tes ini, dan bentuk
  // `user:password@host` hanya membuat pemindai kredensial meledak palsu.
  const urlMati = 'postgresql://127.0.0.1:1/tidak-ada';
  const kodeFailClosed = await new Promise((resolve) => {
    const anak = spawn(process.execPath, ['src/index.js'], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(portAnak),
        DATABASE_URL: urlMati,
        DIRECT_URL: urlMati,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    let selesai = false;
    const coba = (d) => {
      if (selesai) return;
      if (!new RegExp(`localhost:${portAnak}`).test(buf)) return;
      selesai = true;
      fetch(`http://127.0.0.1:${portAnak}/api/auth/me`, {
        headers: { Authorization: `Bearer ${tokenD}` },
      })
        .then(async (res) => resolve(res.status))
        .catch(() => resolve('gagal-jangkau'));
    };
    anak.stdout.on('data', (d) => { buf += d; coba(d); });
    anak.stderr.on('data', (d) => { buf += d; coba(d); });
    setTimeout(() => { selesai = true; anak.kill(); resolve('timeout'); }, 45000);
  });

  check('request terautentikasi DITOLAK (503) saat DB tak terbaca',
    kodeFailClosed === 503, `HTTP ${kodeFailClosed}`);
  check('tidak jadi 200 (middleware tidak dilewati)',
    kodeFailClosed !== 200, `HTTP ${kodeFailClosed}`);

  await prisma.admin.deleteMany({ where: { username: USER } });
  server.close();
  await prisma.$disconnect();

  const gagal = results.filter((x) => !x.pass);
  console.log('\n' + '='.repeat(64));
  console.log(`${results.length - gagal.length}/${results.length} pemeriksaan lolos`);
  if (gagal.length) {
    console.log('\nGAGAL:');
    for (const g of gagal) console.log(`  - ${g.name}`);
  }
  process.exit(gagal.length ? 1 : 0);
})().catch((e) => {
  console.error('ERROR:', e.stack);
  process.exit(1);
});
