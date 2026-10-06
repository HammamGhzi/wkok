/**
 * Uji guard approve/reject menfes lewat HTTP nyata ke app lokal.
 *
 * Perilaku yang dijaga:
 *   1. PENDING -> APPROVED boleh (jalur normal);
 *   2. REJECTED -> APPROVED boleh (koreksi admin, fitur approve ulang);
 *   3. APPROVED -> APPROVED tetap 409, supaya dobel klik tidak menulis
 *      ulang approvedAt dan membalas 200 dua kali;
 *   4. approve ulang menyegarkan approvedAt;
 *   5. field igStatus tidak tersentuh oleh approve, jadi tidak ada
 *      jalur republish otomatis.
 *
 * DB: database yang sama dengan test lain (lokal/dev), bukan produksi.
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

  const USER = 'approve-test-admin';
  const PASS = 'password-approve-123';
  await prisma.admin.deleteMany({ where: { username: USER } });
  await prisma.admin.create({
    data: { username: USER, password: await bcrypt.hash(PASS, 10) },
  });

  let n = 0;
  const req = async (path_, { method = 'GET', body, token } = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.78.0.${(n++ % 250) + 1}`,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${base}${path_}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  let menfesId = null;
  try {
    // ─── 1. login ────────────────────────────────────────────────────────────
    console.log('── 1. login admin uji ──');
    let r = await req('/api/auth/login', {
      method: 'POST',
      body: { username: USER, password: PASS },
    });
    const token = r.body?.token;
    check('login sukses (HTTP 200)', r.status === 200 && !!token, `HTTP ${r.status}`);

    // ─── 2. menfes PENDING -> APPROVED ───────────────────────────────────────
    console.log('\n── 2. approve jalur normal (PENDING) ──');
    r = await req('/api/menfes', {
      method: 'POST',
      body: { message: 'menfes uji approve ulang' },
    });
    menfesId = r.body?.id;
    check('menfes uji dibuat (HTTP 201)', r.status === 201 && !!menfesId, `HTTP ${r.status}`);

    r = await req(`/api/admin/menfes/${menfesId}/approve`, { method: 'PATCH', token });
    check('PENDING diapprove -> 200', r.status === 200, `HTTP ${r.status}`);
    check('status jadi APPROVED', r.body?.data?.status === 'APPROVED', r.body?.data?.status);
    const approvedAtPertama = r.body?.data?.approvedAt;
    check('approvedAt terisi', !!approvedAtPertama);

    // ─── 3. APPROVED -> APPROVED tetap 409 ──────────────────────────────────
    console.log('\n── 3. proteksi dobel approve ──');
    r = await req(`/api/admin/menfes/${menfesId}/approve`, { method: 'PATCH', token });
    check('approve ulang yang sudah APPROVED -> 409', r.status === 409, `HTTP ${r.status}`);
    check('pesan menyebut sudah diapprove',
      (r.body?.error || '').includes('sudah diapprove'), r.body?.error);

    r = await req(`/api/admin/menfes/${menfesId}/approve`, { method: 'PATCH', token });
    check('approvedAt tidak berubah oleh klik kedua',
      r.status === 409, `HTTP ${r.status}`);

    // ─── 4. REJECTED -> APPROVED (fitur approve ulang) ──────────────────────
    console.log('\n── 4. approve ulang menfess yang ditolak ──');
    r = await req(`/api/admin/menfes/${menfesId}/reject`, { method: 'PATCH', token });
    check('menfes direject (HTTP 200)', r.status === 200, `HTTP ${r.status}`);

    r = await req(`/api/admin/menfes/${menfesId}/approve`, { method: 'PATCH', token });
    check('REJECTED diapprove -> 200', r.status === 200, `HTTP ${r.status}`);
    check('status jadi APPROVED', r.body?.data?.status === 'APPROVED', r.body?.data?.status);

    const approvedAtKedua = r.body?.data?.approvedAt;
    check('approvedAt diisi saat approve ulang', !!approvedAtKedua);
    check('approvedAt lebih baru dari approve pertama',
      new Date(approvedAtKedua).getTime() >= new Date(approvedAtPertama).getTime(),
      `${approvedAtPertama} -> ${approvedAtKedua}`);

    // Klik cepat kedua setelah approve ulang: harus tetap 409.
    r = await req(`/api/admin/menfes/${menfesId}/approve`, { method: 'PATCH', token });
    check('approve ulang kedua tetap 409', r.status === 409, `HTTP ${r.status}`);

    // ─── 5. approve tidak menyentuh field Instagram ─────────────────────────
    console.log('\n── 5. approve tidak mengubah status publikasi IG ──');
    const sebelum = await prisma.menfes.findUnique({ where: { id: menfesId } });
    check('igStatus tetap null setelah approve',
      sebelum.igStatus === null, String(sebelum.igStatus));
    check('igMediaId tetap null setelah approve',
      sebelum.igMediaId === null, String(sebelum.igMediaId));
  } finally {
    // ─── bersihkan ─────────────────────────────────────────────────────────
    if (menfesId) {
      await prisma.menfes.deleteMany({ where: { id: menfesId } });
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
  console.error('Test approve error:', err);
  process.exit(1);
});
