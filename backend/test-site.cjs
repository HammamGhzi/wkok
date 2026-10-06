/**
 * Uji fitur buka/tutup menfess lewat HTTP nyata ke app lokal.
 *
 * Perilaku yang dijaga:
 *   1. GET /api/site/status publik dan selalu menyertakan jadwal jam buka;
 *   2. selama TERBUKA, submit menfes lolos (201);
 *   3. toggle admin menutup situs -> status publik ikut tertutup;
 *   4. selama TERTUTUP, submit menfes ditolak 403 berisi jadwal — inilah
 *      pengaman yang membuat layar tutup di halaman user tidak bisa
 *      ditembus lewat API langsung;
 *   5. toggle ditolak tanpa token (401) dan dengan tipe data salah (400);
 *   6. toggle membuka lagi -> submit kembali lolos.
 *
 * DB: database yang sama dengan test lain. Karena toggle menulis baris
 * SiteSetting di database itu, test mengambil status AWAL dulu dan
 * mengembalikannya persis di blok finally — termasuk menghapus barisnya
 * kembali kalau memang belum pernah ada, supaya keadaan admin tidak
 * pernah berubah gara-gara test ini.
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

  const USER = 'site-test-admin';
  const PASS = 'password-site-123';
  await prisma.admin.deleteMany({ where: { username: USER } });
  await prisma.admin.create({
    data: { username: USER, password: await bcrypt.hash(PASS, 10) },
  });

  // Status awal situs sebelum test menyentuhnya — dipulihkan di finally.
  const statusAwal = await prisma.siteSetting.findUnique({ where: { id: 'utama' } });

  let n = 0;
  const req = async (path_, { method = 'GET', body, token } = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.79.0.${(n++ % 250) + 1}`,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${base}${path_}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const buatMenfes = (pesan) =>
    req('/api/menfes', { method: 'POST', body: { message: pesan } });

  const idsMenfes = [];
  try {
    // ─── 1. status publik ────────────────────────────────────────────────────
    console.log('── 1. status publik ──');
    let r = await req('/api/site/status');
    check('GET status -> 200', r.status === 200, `HTTP ${r.status}`);
    check('field open berupa boolean', typeof r.body?.open === 'boolean', String(r.body?.open));
    check('jadwal jam buka ikut dikirim (3 slot)',
      Array.isArray(r.body?.jamBuka) && r.body.jamBuka.length === 3,
      JSON.stringify(r.body?.jamBuka));

    // ─── 2. submit saat terbuka ──────────────────────────────────────────────
    console.log('\n── 2. submit saat situs terbuka ──');
    // Paksa terbuka dulu supaya hasilnya tidak bergantung pada keadaan admin.
    r = await req('/api/auth/login', {
      method: 'POST',
      body: { username: USER, password: PASS },
    });
    const token = r.body?.token;
    check('login sukses (HTTP 200)', r.status === 200 && !!token, `HTTP ${r.status}`);

    r = await req('/api/admin/site', { method: 'PATCH', body: { open: true }, token });
    check('toggle admin buka -> 200', r.status === 200 && r.body?.open === true, `HTTP ${r.status}`);

    r = await buatMenfes('menfes uji saat situs terbuka');
    if (r.body?.id) idsMenfes.push(r.body.id);
    check('submit terbuka -> 201', r.status === 201, `HTTP ${r.status}`);

    // ─── 3. tutup lewat toggle admin ────────────────────────────────────────
    console.log('\n── 3. tutup lewat toggle admin ──');
    r = await req('/api/admin/site', { method: 'PATCH', body: { open: false }, token });
    check('toggle admin tutup -> 200', r.status === 200 && r.body?.open === false, `HTTP ${r.status}`);

    r = await req('/api/site/status');
    check('status publik ikut tertutup', r.body?.open === false, String(r.body?.open));

    // ─── 4. submit saat tertutup ditolak ────────────────────────────────────
    console.log('\n── 4. submit saat situs tertutup ──');
    r = await buatMenfes('menfes uji saat situs tertutup');
    check('submit tertutup -> 403', r.status === 403, `HTTP ${r.status}`);
    check('pesan menyebut sedang tutup',
      (r.body?.error || '').includes('tutup'), r.body?.error);
    check('pesan menyertakan jadwal jam buka',
      (r.body?.error || '').includes('Jam buka'), r.body?.error);
    check('menfes tertutup tidak masuk database', !r.body?.id, String(r.body?.id));

    // ─── 5. pengaman endpoint toggle ────────────────────────────────────────
    console.log('\n── 5. pengaman endpoint toggle ──');
    r = await req('/api/admin/site', { method: 'PATCH', body: { open: true } });
    check('toggle tanpa token -> 401', r.status === 401, `HTTP ${r.status}`);

    r = await req('/api/admin/site', { method: 'PATCH', body: { open: 'buka' }, token });
    check('toggle dengan tipe data salah -> 400', r.status === 400, `HTTP ${r.status}`);

    // ─── 6. buka lagi, submit kembali lolos ─────────────────────────────────
    console.log('\n── 6. buka lagi lewat toggle admin ──');
    r = await req('/api/admin/site', { method: 'PATCH', body: { open: true }, token });
    check('toggle admin buka lagi -> 200', r.status === 200 && r.body?.open === true, `HTTP ${r.status}`);

    r = await req('/api/site/status');
    check('status publik terbuka lagi', r.body?.open === true, String(r.body?.open));

    r = await buatMenfes('menfes uji setelah situs dibuka lagi');
    if (r.body?.id) idsMenfes.push(r.body.id);
    check('submit terbuka lagi -> 201', r.status === 201, `HTTP ${r.status}`);
  } finally {
    // ─── bersihkan: pulihkan keadaan situs persis seperti awal ──────────────
    if (statusAwal) {
      await prisma.siteSetting.upsert({
        where: { id: 'utama' },
        update: { isOpen: statusAwal.isOpen },
        create: { id: 'utama', isOpen: statusAwal.isOpen },
      });
    } else {
      // Belum pernah ada barisnya: hapus kembali supaya DB kembali seperti
      // sebelum test (bawaan "terbuka" tetap berlaku).
      await prisma.siteSetting.deleteMany({ where: { id: 'utama' } });
    }
    if (idsMenfes.length) {
      await prisma.menfes.deleteMany({ where: { id: { in: idsMenfes } } });
    }
    await prisma.admin.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  }

  const failed = results.filter((x) => !x.pass);
  console.log('\n============================================================');
  console.log(`${results.length - failed.length}/${results.length} lulus`);
  console.log('============================================================');
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('Test site error:', err);
  process.exit(1);
});
