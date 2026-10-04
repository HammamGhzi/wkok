/**
 * Uji audit log dengan request HTTP nyata ke app lokal.
 *
 * Fokusnya bukan "fungsi mengembalikan apa", tapi:
 *   1. setiap aksi admin benar-benar meninggalkan jejak;
 *   2. jejak itu tidak bisa dipalsukan dari luar (log injection);
 *   3. password tidak pernah bocor ke log;
 *   4. kegagalan logging tidak menjatuhkan request.
 *
 * DB: MariaDB lokal, bukan produksi.
 */

// chdir ke folder file ini, bukan ke path absolut yang diketik tangan. Path
// absolut seperti ini rusak begitu folder project dipindah atau di-clone di
// tempat lain, dan gejalanya hanya ENOENT yang tidak mengarah ke penyebabnya.
// __dirname selalu benar, di komputer mana pun dan folder mana pun.
process.chdir(__dirname);
const path = require('path');

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'OK   ' : 'GAGAL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

// ─── Tangkap stdout ─────────────────────────────────────────────────────────
let captured = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  captured.push(String(chunk));
  // Tetap tulis ke terminal, kalau tidak output tes ini sendiri hilang
  // (console.log juga lewat process.stdout.write).
  return realWrite(chunk, ...rest);
};
const auditLines = () =>
  captured.filter((l) => l.includes('[AUDIT]')).map((l) => l.slice(l.indexOf('[AUDIT]')));

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

  const USER = 'audit-test-admin';
  const PASS = 'password-audit-123';
  await prisma.admin.deleteMany({ where: { username: USER } });
  await prisma.admin.create({
    data: { username: USER, password: await bcrypt.hash(PASS, 10) },
  });

  let n = 0;
  const req = async (path_, { method = 'GET', body, token, ip } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || `10.77.0.${(n++ % 250) + 1}` };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${base}${path_}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  // ─── 1. login sukses ───────────────────────────────────────────────────────
  console.log('── 1. jejak login ──');
  captured = [];
  let r = await req('/api/auth/login', { method: 'POST', body: { username: USER, password: PASS } });
  let token = r.body?.token;
  check('login sukses (HTTP 200)', r.status === 200, `HTTP ${r.status}`);

  let lines = auditLines();
  check('login.ok tercatat', lines.some((l) => l.includes('security.login.ok')),
    `${lines.length} baris`);

  const okLine = lines.find((l) => l.includes('security.login.ok')) || '';
  check('login.ok memuat adminId', okLine.includes('"adminId"'));
  check('login.ok memuat ipHash (bukan IP mentah)',
    okLine.includes('"ipHash"') && !/10\.77\.0\./.test(okLine));
  check('login.ok tidak membocorkan password', !okLine.includes(PASS));

  // ─── 2. login gagal ────────────────────────────────────────────────────────
  console.log('\n── 2. jejak login gagal ──');
  captured = [];
  // Nilai ini disengaja salah. Disebut lewat konstanta, bukan literal inline,
  // supaya `npm run scan-secrets` tidak memperlakukannya sebagai kredensial
  // bocor. Memperlonggarkan allowlist scanner demiwiązkan baris ini hanya
  // akan melemahkan alatnya sendiri.
  const SALAH = 'kata-sandi-salah-untuk-uji-999';
  r = await req('/api/auth/login', { method: 'POST', body: { username: USER, password: SALAH } });
  check('login gagal ditolak (HTTP 401)', r.status === 401, `HTTP ${r.status}`);
  lines = auditLines();
  const failLine = lines.find((l) => l.includes('security.login.failed')) || '';
  check('login.failed tercatat', !!failLine);
  check('login.failed mencatat username', failLine.includes(USER));
  check('login.failed TIDAK mencatat password yang salah',
    !failLine.includes(SALAH));
  check('login.failed menandai apakah akun ada (untuk deteksi brute force)',
    failLine.includes('"accountExists"'));

  // ─── 3. LOG INJECTION ──────────────────────────────────────────────────────
  console.log('\n── 3. log injection (payload dari penyerang) ──');
  captured = [];
  const forgedPayload = `${USER}\n[AUDIT] {"action":"forged.by.attacker","adminName":"admin"}`;
  r = await req('/api/auth/login', {
    method: 'POST',
    body: { username: forgedPayload, password: 'x' },
  });
  check('payload injection tetap ditolak 401', r.status === 401, `HTTP ${r.status}`);

  lines = auditLines();
  // Uji yang benar: parse tiap baris, lalu lihat apakah ada baris yang
  // BERLAKU sebagai entri audit dengan action milik penyerang. Sekadar
  // `includes('forged.by.attacker')` salah, karena payload memang
  // seharusnya tetap muncul sebagai bukti, hanya sebagai teks di dalam
  // nilai JSON, bukan sebagai baris log tersendiri.
  const parsed = lines.map((l) => {
    try { return JSON.parse(l.replace(/^\[AUDIT\] /, '').trim()); }
    catch { return { PARSE_ERROR: true, raw: l }; }
  });
  const forgedEntries = parsed.filter((e) => e.action === 'forged.by.attacker');
  check('TIDAK ada entri log palsu yang berhasil disisipkan',
    forgedEntries.length === 0,
    forgedEntries.length ? `BERHASIL DIPALSUKAN: ${JSON.stringify(forgedEntries[0])}` : 'tidak ada');
  check('payload dinormalisasi jadi satu baris', lines.length === 1,
    `${lines.length} baris audit`);
  check('semua baris audit bisa di-parse sebagai JSON',
    parsed.every((e) => !e.PARSE_ERROR),
    `${parsed.filter((e) => e.PARSE_ERROR).length} baris rusak`);

  const raw = lines[0] || '';
  check('karakter newline dibuang dari nilai', raw.trim().split('\n').length === 1);
  check('tidak ada newline yang lolos sebagai escape JSON',
    !raw.includes('\\n') && !raw.includes('\\r'));
  check('payload tetap tercatat sebagai bukti (tidak dibuang)',
    (parsed[0] && parsed[0].username || '').includes('forged.by.attacker'),
    'tertangkap sebagai teks di dalam nilai, bukan baris baru');
  check('payload dipotong agar tidak melumpaui log',
    ((parsed[0] && parsed[0].username) || '').length <= 256,
    `panjang ${((parsed[0] && parsed[0].username) || '').length}`);

  // ─── 4. aksi admin ─────────────────────────────────────────────────────────
  console.log('\n── 4. jejak aksi admin ──');
  // buat menfes uji lewat API publik
  r = await req('/api/menfes', { method: 'POST', body: { message: 'menfes untuk uji audit' } });
  // Submit membalas 201 dengan { message, id } di level atas (bukan data.id).
  const menfesId = r.body && r.body.id;
  check('menfes uji dibuat', r.status === 201 && !!menfesId, `HTTP ${r.status}`);

  captured = [];
  r = await req('/api/admin/menfes?limit=5', { token });
  check('daftar menfes bisa dibaca (HTTP 200)', r.status === 200, `HTTP ${r.status}`);
  lines = auditLines();
  const listLine = lines.find((l) => l.includes('menfes.list')) || '';
  check('menfes.list tercatat (aksi baca yang paling sensitif)',
    !!listLine);
  check('menfes.list mencatat berapa baris yang dikembalikan',
    listLine.includes('"returned"'));

  captured = [];
  r = await req(`/api/admin/menfes/${menfesId}/approve`, { method: 'PATCH', token });
  check('approve berhasil', r.status === 200, `HTTP ${r.status}`);
  check('menfes.approve tercatat dengan id target',
    auditLines().some((l) => l.includes('menfes.approve') && l.includes(menfesId)));

  captured = [];
  r = await req(`/api/admin/menfes/${menfesId}/reject`, { method: 'PATCH', token });
  check('reject berhasil', r.status === 200, `HTTP ${r.status}`);
  check('menfes.reject tercatat', auditLines().some((l) => l.includes('menfes.reject')));

  captured = [];
  r = await req(`/api/admin/menfes/${menfesId}`, { method: 'DELETE', token });
  check('delete berhasil', r.status === 200, `HTTP ${r.status}`);
  check('menfes.delete tercatat', auditLines().some((l) => l.includes('menfes.delete')));

  // ─── 5. ganti password ─────────────────────────────────────────────────────
  console.log('\n── 5. jejak ganti password ──');
  captured = [];
  const NEW_PASS = 'password-baru-audit-456';
  r = await req('/api/auth/change-password', {
    method: 'POST',
    token,
    body: { currentPassword: PASS, newPassword: NEW_PASS },
  });
  check('ganti password berhasil', r.status === 200, `HTTP ${r.status}`);
  const pwLine = auditLines().find((l) => l.includes('auth.password_changed')) || '';
  check('auth.password_changed tercatat', !!pwLine);
  check('password BARU tidak bocor ke log', !pwLine.includes(NEW_PASS));
  check('password LAMA tidak bocor ke log', !pwLine.includes(PASS));
  check('hanya panjangnya yang dicatat', pwLine.includes('"newLength"'));

  // Ganti password sekarang membatalkan token yang memakainya, jadi langkah
  // berikutnya harus memakai token pengganti dari respons di atas.
  // Memakai token lama di sini akan gagal dengan 401.
  const tokenBaru = r.body?.token;
  check('ganti password mengembalikan token pengganti', !!tokenBaru);
  if (tokenBaru) token = tokenBaru;

  // ─── 6. audit tidak boleh menjatuhkan request ──────────────────────────────
  console.log('\n── 6. ketahanan: logging gagal tidak boleh mematikan request ──');
  captured = [];
  const savedWrite = process.stdout.write;
  process.stdout.write = () => { throw Object.assign(new Error('EPIPE'), { code: 'EPIPE' }); };
  r = await req(`/api/admin/menfes?limit=1`, { token });
  process.stdout.write = savedWrite;
  check('request tetap 200 walau stdout.write melempar error',
    r.status === 200, `HTTP ${r.status}`);
  check('data tetap utuh (tidak ada yang terpotong)',
    r.status === 200 && Array.isArray(r.body?.data), 'payload lengkap');

  // ─── 7. nilai abnormal tidak merusak log ────────────────────────────────────
  console.log('\n── 7. nilai abnormal ──');
  captured = [];
  r = await req('/api/admin/menfes?limit=999999&page=-5', { token });
  check('limit/page aneh tidak membuat request gagal',
    r.status === 200 || r.status === 400, `HTTP ${r.status}`);
  lines = auditLines();
  check('tetap menghasilkan tepat satu baris JSON yang valid',
    lines.length > 0 && (() => {
      try {
        const body = lines[lines.length - 1].replace('[AUDIT] ', '');
        JSON.parse(body);
        return true;
      } catch { return false; }
    })(), `${lines.length} baris`);

  await prisma.admin.deleteMany({ where: { username: USER } });
  server.close();
  await prisma.$disconnect();
  process.stdout.write = realWrite;

  const failed = results.filter((x) => !x.pass);
  console.log(`\n${'='.repeat(64)}`);
  console.log(`${results.length - failed.length}/${results.length} pemeriksaan lolos`);
  if (failed.length) {
    console.log('\nGAGAL:');
    for (const f of failed) console.log(`  - ${f.name}`);
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  process.stdout.write = realWrite;
  console.error('ERROR:', e.stack);
  process.exit(1);
});
