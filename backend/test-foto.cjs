/**
 * Uji submit menfes BERTAMPILAN FOTO lewat HTTP nyata ke app lokal.
 *
 * Perilaku yang dijaga:
 *   1. jalur JSON lama tetap utuh (fotoUrl tetap null) — back-compat;
 *   2. multipart dengan foto valid -> 201, fotoUrl terisi URL Cloudinary
 *      absolut, asetnya TERJANGKAU lewat jaringan dan isinya byte yang sama
 *      persis dengan yang dikirim;
 *   3. field teks multipart (senderName) terbaca sama dengan jalur JSON;
 *   4. multipart TANPA file foto -> 201, fotoUrl null (form input kosong);
 *   5. tipe selain JPG/PNG -> 400, tidak ada baris dan tidak ada aset;
 *   6. file 0 byte -> 400;
 *   7. file > 5 MB -> 400 (batas aplikasi, parser mentah 6 MB masih lolos);
 *   8. file > 6 MB -> 413 (diblokir parser sebelum sampai controller);
 *   9. daftar admin menampilkan fotoUrl;
 *  10. delete menfes membuang aset fotonya dari Cloudinary.
 *
 * Butuh CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET di environment: unggahan
 * jujur ke Cloudinary sungguhan (PNG 1x1, dan asetnya dibersihkan di finally).
 * DB: database yang sama dengan test lain (lokal/dev), bukan produksi.
 */

process.chdir(__dirname);
const path = require('path');

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'OK   ' : 'GAGAL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

// PNG 1x1 yang valid — cukup untuk lolos validasi tipe dan utuh di Cloudinary.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

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
  const cloudinary = require('./src/lib/cloudinary');
  const prisma = new PrismaClient();

  const USER = 'foto-test-admin';
  const PASS = 'password-foto-123';
  await prisma.admin.deleteMany({ where: { username: USER } });
  await prisma.admin.create({
    data: { username: USER, password: await bcrypt.hash(PASS, 10) },
  });

  // Semua id yang dibuat uji ini, dibersihkan di blok finally.
  const idBuat = [];
  // URL Cloudinary dari unggahan uji ini, dibuang di finally kalau ujinya
  // berhenti sebelum kasus delete sempat membuangnya sendiri.
  const fotoDariUji = [];

  let n = 0;
  const ip = () => `10.88.0.${(n++ % 250) + 1}`;
  const reqJson = async (path_, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${base}${path_}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const reqForm = async (path_, form, token) => {
    const headers = { 'X-Forwarded-For': ip() };
    if (token) headers.Authorization = `Bearer ${token}`;
    // Content-Type TIDAK diisi manual: Node yang memasang boundary.
    const r = await fetch(`${base}${path_}`, { method: 'POST', headers, body: form });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const formDengan = ({ message, senderName, foto }) => {
    const form = new FormData();
    form.append('message', message);
    if (senderName) form.append('senderName', senderName);
    form.append('senderInfo', 'Template 1');
    if (foto) form.append('foto', foto.file, foto.name);
    return form;
  };

  try {
    console.log('── 1. login admin uji ──');
    let r = await reqJson('/api/auth/login', {
      method: 'POST',
      body: { username: USER, password: PASS },
    });
    const token = r.body?.token;
    check('login sukses (HTTP 200)', r.status === 200 && !!token, `HTTP ${r.status}`);

    // ─── 2. jalur JSON lama: tanpa foto, tetap 201 dan fotoUrl null ─────────
    console.log('\n── 2. back-compat: submit JSON tanpa foto ──');
    r = await reqJson('/api/menfes', {
      method: 'POST',
      body: { message: 'menfes uji tanpa foto sama sekali', senderName: 'anon-json' },
    });
    check('JSON submit tetap 201', r.status === 201, `HTTP ${r.status}`);
    check('id dikembalikan', !!r.body?.id, r.body?.error);
    if (r.body?.id) idBuat.push(r.body.id);
    const rowJson = r.body?.id
      ? await prisma.menfes.findUnique({ where: { id: r.body.id } })
      : null;
    check('fotoUrl null pada jalur JSON', rowJson?.fotoUrl === null, String(rowJson?.fotoUrl));
    check('senderName terbaca dari JSON', rowJson?.senderName === 'anon-json', String(rowJson?.senderName));

    // ─── 3. multipart dengan foto valid ─────────────────────────────────────
    console.log('\n── 3. submit multipart dengan foto PNG valid ──');
    r = await reqForm(
      '/api/menfes',
      formDengan({
        message: 'menfes uji membawa foto',
        senderName: 'si-foto',
        foto: { file: new Blob([PNG_1X1], { type: 'image/png' }), name: 'kirim.png' },
      })
    );
    check('multipart submit 201', r.status === 201, `HTTP ${r.status} ${r.body?.error || ''}`);
    const idFoto = r.body?.id;
    check('id foto diterima', !!idFoto, r.body?.error);
    if (idFoto) idBuat.push(idFoto);

    const rowFoto = idFoto
      ? await prisma.menfes.findUnique({ where: { id: idFoto } })
      : null;
    check('fotoUrl terisi', !!rowFoto?.fotoUrl, String(rowFoto?.fotoUrl));
    check(
      'fotoUrl absolut di Cloudinary',
      !!rowFoto?.fotoUrl && rowFoto.fotoUrl.startsWith('https://res.cloudinary.com/'),
      String(rowFoto?.fotoUrl)
    );
    check('senderName terbaca dari multipart', rowFoto?.senderName === 'si-foto', String(rowFoto?.senderName));

    // Aset benar-benar bisa diunduh dari jaringan dan isinya byte yang sama.
    if (rowFoto?.fotoUrl) fotoDariUji.push(rowFoto.fotoUrl);
    if (rowFoto?.fotoUrl) {
      let ada = false;
      let isiSama = false;
      try {
        const res = await fetch(rowFoto.fotoUrl);
        const buf = Buffer.from(await res.arrayBuffer());
        ada = res.ok;
        isiSama = buf.equals(PNG_1X1);
      } catch { /* tetap false */ }
      check('foto terunduh dari Cloudinary', ada, rowFoto.fotoUrl);
      check('isi foto identik dengan yang dikirim', isiSama);
    } else {
      check('foto terunduh dari Cloudinary', false, 'fotoUrl kosong');
      check('isi foto identik dengan yang dikirim', false, 'fotoUrl kosong');
    }

    // ─── 4. multipart tanpa field foto (input file kosong) ──────────────────
    console.log('\n── 4. multipart tanpa field foto ──');
    r = await reqForm('/api/menfes', formDengan({ message: 'menfes uji form tanpa file' }));
    check('tanpa file tetap 201', r.status === 201, `HTTP ${r.status} ${r.body?.error || ''}`);
    if (r.body?.id) idBuat.push(r.body.id);
    const rowTanpaFoto = r.body?.id
      ? await prisma.menfes.findUnique({ where: { id: r.body.id } })
      : null;
    check('fotoUrl null tanpa file', rowTanpaFoto?.fotoUrl === null, String(rowTanpaFoto?.fotoUrl));

    // ─── 5. tipe file ditolak (GIF bukan JPG/PNG) ───────────────────────────
    console.log('\n── 5. tipe file ditolak ──');
    const sebelumBaris = await prisma.menfes.count();
    r = await reqForm(
      '/api/menfes',
      formDengan({
        message: 'menfes uji file bergaya aneh',
        foto: { file: new Blob([PNG_1X1], { type: 'image/gif' }), name: 'aneh.gif' },
      })
    );
    check('file GIF -> 400', r.status === 400, `HTTP ${r.status}`);
    check('pesan error menyebut JPG/PNG', (r.body?.error || '').includes('JPG'), r.body?.error);
    check('tidak ada baris baru untuk file ditolak',
      (await prisma.menfes.count()) === sebelumBaris,
      `${sebelumBaris} -> ${await prisma.menfes.count()}`);

    // ─── 6. file 0 byte -> 400 ──────────────────────────────────────────────
    console.log('\n── 6. file 0 byte ──');
    r = await reqForm(
      '/api/menfes',
      formDengan({
        message: 'menfes uji file kosong',
        foto: { file: new Blob([], { type: 'image/jpeg' }), name: 'kosong.jpg' },
      })
    );
    check('file kosong -> 400', r.status === 400, `HTTP ${r.status}`);
    check('tidak ada baris baru untuk file kosong',
      (await prisma.menfes.count()) === sebelumBaris);

    // ─── 7. file > 5 MB -> 400 (batas aplikasi) ─────────────────────────────
    console.log('\n── 7. file 5,5 MB (melewati batas aplikasi) ──');
    r = await reqForm(
      '/api/menfes',
      formDengan({
        message: 'menfes uji file kegedean',
        foto: { file: new Blob([Buffer.alloc(5 * 1024 * 1024 + 512 * 1024, 1)], { type: 'image/jpeg' }), name: 'gede.jpg' },
      })
    );
    check('file 5,5 MB -> 400', r.status === 400, `HTTP ${r.status}`);
    check('pesan error menyebut batas 5 MB', (r.body?.error || '').includes('5 MB'), r.body?.error);
    check('tidak ada baris baru untuk file kegedean',
      (await prisma.menfes.count()) === sebelumBaris);

    // ─── 8. file > 6 MB -> 413 (diblokir parser mentah) ─────────────────────
    console.log('\n── 8. file 6,5 MB (melewati parser mentah) ──');
    r = await reqForm(
      '/api/menfes',
      formDengan({
        message: 'menfes uji melewati parser',
        foto: { file: new Blob([Buffer.alloc(6 * 1024 * 1024 + 512 * 1024, 2)], { type: 'image/jpeg' }), name: 'gede-banget.jpg' },
      })
    );
    check('file 6,5 MB -> 413', r.status === 413, `HTTP ${r.status}`);
    check('tidak ada baris baru untuk file kegedean banget',
      (await prisma.menfes.count()) === sebelumBaris);

    // ─── 9. daftar admin menampilkan fotoUrl ────────────────────────────────
    console.log('\n── 9. daftar admin membawa fotoUrl ──');
    r = await reqJson('/api/admin/menfes?limit=50', { token });
    const adaDiList = (r.body?.data || []).find((m) => m.id === idFoto);
    check('fotoUrl ikut di response daftar admin',
      r.status === 200 && adaDiList?.fotoUrl === rowFoto?.fotoUrl,
      `HTTP ${r.status}, fotoUrl=${adaDiList?.fotoUrl}`);

    // ─── 10. delete membuang aset foto ─────────────────────────────────────
    console.log('\n── 10. delete menfes membuang aset foto ──');
    check('prasyarat: aset foto ada sebelum delete',
      !!rowFoto?.fotoUrl && await cloudinary.adaAset(rowFoto.fotoUrl), String(rowFoto?.fotoUrl));
    r = await reqJson(`/api/admin/menfes/${idFoto}`, { method: 'DELETE', token });
    check('delete sukses (HTTP 200)', r.status === 200, `HTTP ${r.status}`);

    // Penghapusan jalan best-effort di belakang response delete, jadi poll
    // sebentar. Ditanya lewat Admin API, bukan URL-nya: salinan CDN bisa
    // bertahan setelah destroy dan bikin GET ke URL tetap 200.
    let asetHilang = false;
    for (let coba = 0; coba < 10 && !asetHilang; coba++) {
      await new Promise((res) => setTimeout(res, 500));
      asetHilang = !(await cloudinary.adaAset(rowFoto.fotoUrl));
    }
    check('aset foto terhapus dari Cloudinary', asetHilang, String(rowFoto?.fotoUrl));
    const hilang = idFoto ? await prisma.menfes.findUnique({ where: { id: idFoto } }) : {};
    check('baris terhapus dari database', hilang === null);
  } finally {
    // ─── bersihkan ─────────────────────────────────────────────────────────
    if (idBuat.length) {
      await prisma.menfes.deleteMany({ where: { id: { in: idBuat } } });
    }
    for (const f of fotoDariUji) {
      try { await cloudinary.hapusFoto(f); } catch { /* mungkin sudah terhapus delete */ }
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
  console.error('Test foto error:', err);
  process.exit(1);
});
