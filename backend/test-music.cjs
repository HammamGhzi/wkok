/**
 * Uji fitur lagu pilihan pengirim lewat HTTP nyata ke app lokal.
 *
 * Perilaku yang dijaga:
 *   1. GET /api/music/search?q=... -> 200 dengan minimal satu hasil berisi
 *      videoId 11 karakter + title + thumb (pencarian NYATA ke YouTube);
 *   2. q < 2 karakter -> 400;
 *   3. submit JSON dengan music valid -> 201, kolom music terisi snapshot;
 *   4. submit tanpa music -> 201, kolom music null (back-compat);
 *   5. videoId salah format -> 400, TIDAK ada baris baru;
 *   6. submit multipart (music sebagai string JSON) -> 201, kolom terisi;
 *   7. API publik GET /api/menfes TIDAK membawa field music;
 *   8. API admin GET /api/admin/menfes membawa field music;
 *   9. semua baris uji dibersihkan di finally.
 *
 * Butuh jaringan ke YouTube untuk kasus search. Tidak butuh Cloudinary.
 * DB: database yang sama dengan test lain (lokal/dev), bukan produksi.
 */

process.chdir(__dirname);
const path = require('path');

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'OK   ' : 'GAGAL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

// Snapshot lagu uji — videoId 11 karakter sah, thumb URL https yang benar.
const LAGU = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Judul Lagu Uji',
  artist: 'Artis Uji',
  duration: 213,
  thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg',
};
// Thumb dari host SEMBARANGAN: kalau diterima, <img src>-nya akan di-fetch
// browser admin setiap kali dashboard dibuka — beacon pelacakan (IP + waktu).
// Host thumbnail sah dibatasi ke properti Google (ytimg/ggpht/googleusercontent).
const LAGU_THUMB_LIAR = 'https://attacker.example.com/pixel.jpg';

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

  const USER = 'music-test-admin';
  const PASS = 'password-music-123';

  // Baca status awal situs SEBELUM try (read-only, tidak memutasi apa pun;
  // kalau bacaan ini gagal pun belum ada yang berubah untuk dipulihkan).
  // Dipulihkan di finally berdasarkan nilai ini.
  const statusAwal = await prisma.siteSetting.findUnique({ where: { id: 'utama' } });

  const idBuat = [];

  let n = 0;
  const ip = () => `10.99.0.${(n++ % 250) + 1}`;
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
    const r = await fetch(`${base}${path_}`, { method: 'POST', headers, body: form });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const formDengan = ({ message, senderName, music }) => {
    const form = new FormData();
    form.append('message', message);
    if (senderName) form.append('senderName', senderName);
    form.append('senderInfo', 'Template 1');
    if (music) form.append('music', JSON.stringify(music));
    return form;
  };

  try {
    // Kasus submit butuh situs terbuka (tanpa ini semua submit dibalas 403).
    // Pola yang sama dengan test-site.cjs: buka sementara hanya kalau perlu,
    // pulihkan persis keadaan awal (statusAwal, dibaca di atas) di finally.
    if (!statusAwal || !statusAwal.isOpen) {
      await prisma.siteSetting.upsert({
        where: { id: 'utama' },
        update: { isOpen: true },
        create: { id: 'utama', isOpen: true },
      });
    }
    // Admin uji dibuat di sini (bukan sebelum try) supaya finally yang
    // menghapusnya selalu berjalan walau setup gagal di tengah jalan.
    await prisma.admin.deleteMany({ where: { username: USER } });
    await prisma.admin.create({
      data: { username: USER, password: await bcrypt.hash(PASS, 10) },
    });

    console.log('── 1. login admin uji ──');
    let r = await reqJson('/api/auth/login', {
      method: 'POST',
      body: { username: USER, password: PASS },
    });
    const token = r.body?.token;
    check('login sukses (HTTP 200)', r.status === 200 && !!token, `HTTP ${r.status}`);

    // ─── 2. pencarian lagu sungguhan ─────────────────────────────────────────
    console.log('\n── 2. GET /api/music/search (jaringan nyata ke YouTube) ──');
    r = await reqJson('/api/music/search?q=tulus');
    check('search 200', r.status === 200, `HTTP ${r.status} ${r.body?.error || ''}`);
    const hasil = r.body?.data || [];
    check('ada minimal satu hasil', hasil.length > 0, `jumlah=${hasil.length}`);
    const pertama = hasil[0] || {};
    check('videoId 11 karakter sah', /^[A-Za-z0-9_-]{11}$/.test(pertama.videoId || ''), String(pertama.videoId));
    check('title terisi', typeof pertama.title === 'string' && pertama.title.length > 0, String(pertama.title));
    check('thumb URL http', typeof pertama.thumb === 'string' && pertama.thumb.startsWith('http'), String(pertama.thumb));

    // ─── 3. query terlalu pendek -> 400 ──────────────────────────────────────
    console.log('\n── 3. q < 2 karakter -> 400 ──');
    r = await reqJson('/api/music/search?q=a');
    check('q pendek -> 400', r.status === 400, `HTTP ${r.status}`);

    // ─── 4. submit JSON dengan lagu valid ────────────────────────────────────
    console.log('\n── 4. submit JSON + music valid ──');
    r = await reqJson('/api/menfes', {
      method: 'POST',
      body: { message: 'menfes uji membawa lagu', senderName: 'si-lagu', music: LAGU },
    });
    check('submit 201', r.status === 201, `HTTP ${r.status} ${r.body?.error || ''}`);
    const idLagu = r.body?.id;
    check('id diterima', !!idLagu, r.body?.error);
    if (idLagu) idBuat.push(idLagu);
    const rowLagu = idLagu ? await prisma.menfes.findUnique({ where: { id: idLagu } }) : null;
    check('kolom music terisi', !!rowLagu?.music, String(rowLagu?.music));
    check('videoId tersimpan persis', rowLagu?.music?.videoId === LAGU.videoId, String(rowLagu?.music?.videoId));
    check('judul snapshot ikut tersimpan', rowLagu?.music?.title === LAGU.title, String(rowLagu?.music?.title));

    // ─── 5. submit tanpa lagu -> kolom null (back-compat) ────────────────────
    console.log('\n── 5. submit tanpa music ──');
    r = await reqJson('/api/menfes', {
      method: 'POST',
      body: { message: 'menfes uji tanpa lagu sama sekali' },
    });
    check('submit 201', r.status === 201, `HTTP ${r.status} ${r.body?.error || ''}`);
    const idTanpa = r.body?.id;
    if (idTanpa) idBuat.push(idTanpa);
    const rowTanpa = idTanpa ? await prisma.menfes.findUnique({ where: { id: idTanpa } }) : null;
    check('kolom music null', rowTanpa?.music === null, String(rowTanpa?.music));

    // ─── 6. videoId salah format -> 400, tanpa baris baru ───────────────────
    console.log('\n── 6. videoId salah format -> 400 ──');
    const sebelumBaris = await prisma.menfes.count();
    r = await reqJson('/api/menfes', {
      method: 'POST',
      body: {
        message: 'menfes uji lagu rusak',
        music: { ...LAGU, videoId: 'ini-bukan-11-karakter' },
      },
    });
    check('videoId rusak -> 400', r.status === 400, `HTTP ${r.status}`);
    check('pesan error menyebut lagu/videoId',
      /lagu|videoId/i.test(r.body?.error || ''), r.body?.error);
    check('tidak ada baris baru untuk lagu rusak',
      (await prisma.menfes.count()) === sebelumBaris,
      `${sebelumBaris} -> ${await prisma.menfes.count()}`);

    // ─── 6b. thumb dari host bebas -> 400 (anti beacon pelacakan) ────────────
    console.log('\n── 6b. thumb host sembarangan -> 400 ──');
    r = await reqJson('/api/menfes', {
      method: 'POST',
      body: {
        message: 'menfes uji thumb liar',
        music: { ...LAGU, thumb: LAGU_THUMB_LIAR },
      },
    });
    check('thumb liar -> 400', r.status === 400, `HTTP ${r.status}`);
    check('tidak ada baris baru untuk thumb liar',
      (await prisma.menfes.count()) === sebelumBaris,
      `${sebelumBaris} -> ${await prisma.menfes.count()}`);

    // ─── 7. multipart: music sebagai string JSON ─────────────────────────────
    console.log('\n── 7. submit multipart + music (string JSON) ──');
    r = await reqForm('/api/menfes', formDengan({
      message: 'menfes uji multipart membawa lagu',
      senderName: 'si-lagu-form',
      music: LAGU,
    }));
    check('multipart + music 201', r.status === 201, `HTTP ${r.status} ${r.body?.error || ''}`);
    const idForm = r.body?.id;
    if (idForm) idBuat.push(idForm);
    const rowForm = idForm ? await prisma.menfes.findUnique({ where: { id: idForm } }) : null;
    check('kolom music terisi dari multipart', rowForm?.music?.videoId === LAGU.videoId, String(rowForm?.music?.videoId));

    // ─── 8. API publik TIDAK membawa music ───────────────────────────────────
    console.log('\n── 8. API publik tanpa field music ──');
    r = await reqJson(`/api/admin/menfes/${idLagu}/approve`, { method: 'PATCH', token });
    check('approve sukses (HTTP 200)', r.status === 200, `HTTP ${r.status}`);
    r = await reqJson('/api/menfes?page=1&limit=20');
    const barisPublik = (r.body?.data || []).find((m) => m.id === idLagu);
    check('baris uji tampil di feed publik', r.status === 200 && !!barisPublik, `HTTP ${r.status}`);
    check('field music TIDAK ikut di response publik',
      !!barisPublik && !('music' in barisPublik),
      Object.keys(barisPublik || {}).join(','));

    // ─── 9. API admin membawa music ──────────────────────────────────────────
    console.log('\n── 9. API admin membawa field music ──');
    r = await reqJson('/api/admin/menfes?limit=50', { token });
    const diAdmin = (r.body?.data || []).find((m) => m.id === idLagu);
    const tanpaLagu = (r.body?.data || []).find((m) => m.id === idTanpa);
    check('music ikut di response daftar admin',
      r.status === 200 && diAdmin?.music?.videoId === LAGU.videoId,
      `HTTP ${r.status}, videoId=${diAdmin?.music?.videoId}`);
    check('baris tanpa lagu bernilai null di admin',
      !!tanpaLagu && tanpaLagu.music === null, String(tanpaLagu?.music));
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
    if (idBuat.length) {
      await prisma.menfes.deleteMany({ where: { id: { in: idBuat } } });
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
  console.error('Test music error:', err);
  process.exit(1);
});
