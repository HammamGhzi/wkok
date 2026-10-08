# Rencana Implementasi: Fitur Musik di Menfess

Spec: `docs/superpowers/specs/2026-10-09-musik-menfes-design.md` (sudah di-approve)

Ringkasan: user memilih lagu saat submit menfess (step 4; foto digeser ke step 5),
lagu disimpan sebagai snapshot di kolom JSON `music`, dan **hanya dashboard admin**
yang menampilkannya — dengan preview embed YouTube resmi yang berhenti sendiri di
detik ke-30. Feed publik dan Instagram tidak menyentuh kolom ini.

## Aturan main (baca dulu)

1. **JANGAN `git push`** — commit lokal saja, push hanya kalau user bilang push.
2. **DB lokal dan produksi memakai database Supabase yang sama.** Migrasi yang
   dipakai di sini wajib ADDITIVE (tambah kolom nullable). Kalau `prisma migrate
   dev` sampai menawarkan reset/drift resolution → **batal, jangan terima**.
3. `npm run test:all` gagal di `test:admin-perf` itu **pre-existing** (DB dev
   punya >500 baris APPROVED), bukan regresi dari pekerjaan ini. Jangan
   "memperbaikinya" di sini.
4. Tiap task diakhiri SATU commit (pesan bahasa Indonesia, pola repo:
   `feat:`/`test:`/`docs:`).
5. Test suite yang ditulis di Task 1 sengaja ditulis **dulu** (RED), lalu
   dikejar lulus bertahap per task (prinsip TDD).
6. Shell Windows/PowerShell: kutip argumen yang mengandung `@`/`$`; jangan
   pakai heredoc; kalau baris `node -e` mengandung `$`, tulis file `.cjs`
   sementara di `C:\Users\AcerAG14\AppData\Local\Temp\opencode\` saja.

## Peta file

| Aksi | File |
| --- | --- |
| baru | `backend/test-music.cjs` |
| baru | `backend/src/lib/ytmusic.js` |
| baru | `backend/src/routes/music.js` |
| baru | `backend/src/controllers/musicController.js` |
| baru | `frontend/src/components/MusicPicker.jsx` |
| edit | `backend/package.json` (script test) |
| edit | `backend/prisma/schema.prisma` (kolom `music`) |
| edit | `backend/src/index.js` (mount route `/api/music`) |
| edit | `backend/src/controllers/menfesController.js` (validasi + simpan) |
| edit | `backend/src/controllers/adminController.js` (select `music`) |
| edit | `frontend/src/api/index.js` (`musicAPI.cari`) |
| edit | `frontend/src/pages/HomePage.jsx` (step swap + submit music) |
| edit | `frontend/src/pages/AdminDashboardPage.jsx` (blok lagu + player) |

---

## Task 1 — Test suite dulu (expected RED)

**File baru: `menfs/backend/test-music.cjs`**

Kerangka (helpers `check`/`reqJson`/`reqForm`/`formDengan`, blok `finally`,
cetak skor akhir) mengikuti pola persis `test-foto.cjs`. Isi lengkap:

```js
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
  await prisma.admin.deleteMany({ where: { username: USER } });
  await prisma.admin.create({
    data: { username: USER, password: await bcrypt.hash(PASS, 10) },
  });

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
    // ─── bersihkan ──────────────────────────────────────────────────────────
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
```

**Edit `menfs/backend/package.json`:**

- Tambah script (sejajar `test:foto`):
  ```json
  "test:music": "node test-music.cjs",
  ```
- Sambungkan ke `test:all`: ubah tail-nya menjadi
  `... && npm run test:site && npm run test:foto && npm run test:music`.

**Verifikasi:** `cd menfs/backend && npm run test:music` → sebagian besar
`GAGAL` (endpoint 404, kolom belum ada). Itu RED yang diharapkan — jangan
dibiarkan mengganggu: lanjut task berikutnya.

**Commit:** `test: skenario uji fitur lagu menfess (belum lulus)`

---

## Task 2 — Install `ytmusic-api` + wrapper

**Jalankan:** `cd menfs/backend && npm i ytmusic-api`
(v5.3.1; `module.exports = exports.default` → kelas `YTMusic` langsung bisa
`require`, tanpa `.default`).

**File baru: `menfs/backend/src/lib/ytmusic.js`**

```js
// ── Akses YouTube Music (unofficial) ─────────────────────────────────────────
// Wrapper tipis di sekitar `ytmusic-api` (scraper komunitas, tak resmi).
// Sengaja dipisah di satu file: kalau library ini pecah karena YouTube
// mengubah API internalnya, cukup ganti isi file ini — controller dan route
// tidak tersentuh.
//
// initialize() dibuat LAZY (saat pencarian pertama) dan hasilnya di-cache
// sebagai promise, supaya:
//   - server tetap bisa start walau YouTube sedang tidak terjangkau;
//   - dua pencarian pertama yang berbarengan tidak memicu dua initialize;
//   - kegagalan initialize melempar error yang bisa ditangkap endpoint dan
//     dibalaskan sebagai 502 (bukan crash saat boot).
const YTMusic = require('ytmusic-api');

const ytm = new YTMusic();
let initSekali = null;

function siapkan() {
  if (!initSekali) {
    initSekali = ytm
      .initialize()
      .then((hasil) => {
        if (!hasil) {
          initSekali = null; // biarkan percobaan berikutnya mengulang dari nol
          throw new Error('ytmusic-api initialize() mengembalikan undefined');
        }
        return hasil;
      })
      .catch((err) => {
        initSekali = null;
        throw err;
      });
  }
  return initSekali;
}

/**
 * Cari lagu di YouTube Music berdasarkan kata kunci (tanpa login/cookies).
 * @returns {Promise<Array<{videoId: string, name: string,
 *   artist: {name: string}, duration: number|null,
 *   thumbnails: Array<{url: string}>}>>}
 */
async function cariLagu(kueri) {
  await siapkan();
  return ytm.searchSongs(kueri);
}

module.exports = { cariLagu };
```

**Verifikasi (probe jaringan nyata):** dari `menfs/backend`:

```
node -e "require('./src/lib/ytmusic').cariLagu('tulus manusia baik').then(r=>{console.log(r.slice(0,3).map(s=>({videoId:s.videoId,name:s.name,artist:s.artist.name,duration:s.duration,thumb:(s.thumbnails[s.thumbnails.length-1]||{}).url})));process.exit(0)}).catch(e=>{console.error('GAGAL:',e.message);process.exit(1)})"
```

Harus mencetak ≤3 entri berisi `videoId` 11 karakter + nama + thumb.

**Commit:** `feat: wrapper ytmusic-api dengan initialize lazy`

---

## Task 3 — Kolom `music` + migrasi additive

**Edit `menfs/backend/prisma/schema.prisma`** — di model `Menfes`, tepat
setelah `fotoUrl String?` (dan sebelum `@@index`):

```prisma
  // ── Lagu pilihan pengirim (opsional) ───────────────────────────────────────
  // Snapshot metadata hasil pencarian: { videoId, title, artist, duration,
  // thumb }. HANYA dibaca dashboard admin (preview embed YouTube resmi 30
  // detik); TIDAK PERNAH ikut response API publik maupun caption/postingan
  // Instagram. NULL = tanpa lagu (semua baris lama).
  music Json?
```

**Jalankan migrasi** dari `menfs/backend`:

```
npx prisma migrate dev --name add_menfes_music
```

Harusnya menghasilkan `prisma/migrations/<timestamp>_add_menfes_music/migration.sql`
berisi satu baris `ALTER TABLE "Menfes" ADD COLUMN "music" JSONB;` dan otomatis
`prisma generate`. **Kalau CLI menawarkan reset/drift → batal (Ctrl+C), jangan
lanjut** (DB shared).

Catatan: DB lokal = DB produksi, jadi kolom langsung ada di produksi — aman,
karena kode produksi lama tidak pernah menyentuh kolom tak dikenal dan baris
lama otomatis NULL.

**Verifikasi:**

1. Buka file hasil migrasi
   `prisma/migrations/<timestamp>_add_menfes_music/migration.sql` — isinya
   persis satu statement `ALTER TABLE "Menfes" ADD COLUMN "music" JSONB;`
   (tanpa UPDATE/DELETE apa pun).
2. Tulis file sementara `menfs/backend/_tmp-cek-music.cjs`
   (`node -e` TIDAK dipakai di sini karena `$queryRawUnsafe` akan dimakan
   PowerShell sebagai variabel):

```js
// sementara — hapus setelah verifikasi
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.$queryRawUnsafe(
  'SELECT count(*) AS total, count(*) FILTER (WHERE "music" IS NOT NULL) AS ada_lagu FROM "Menfes"'
)
  .then((r) => {
    console.log(r);
    return p.$disconnect();
  })
  .then(() => process.exit(0));
```

   Jalankan `node _tmp-cek-music.cjs` → harus `ada_lagu = 0` dan `total` =
   jumlah baris sekarang (692-an). Hapus filenya setelah itu.

Catatan deploy: karena DB lokal dan produksi SATU database, kolom sudah ada di
produksi sejak task ini — deploy kode nanti hanya butuh `prisma generate`
(bawaan script `build`), tanpa perlu `migrate deploy` di Render.

**Commit:** `feat: kolom music (Json) di model Menfes`

---

## Task 4 — Endpoint `GET /api/music/search`

**File baru: `menfs/backend/src/controllers/musicController.js`**

```js
const { cariLagu } = require('../lib/ytmusic');

// Batas query & hasil sengaja kecil: pencarian hanya perlu membantu pengirim
// menemukan SATU lagu, bukan menjelajahi katalog.
const Q_MIN = 2;
const Q_MAKS = 100;
const HASIL_MAKS = 10;
const TIMEOUT_MS = 8000;

// Race melawan batas waktu supaya YouTube yang menggantung tidak menahan
// request sampai timeout axios di klien (10 detik) yang memutus duluan.
function kedaluwarsa(ms, pesan) {
  return new Promise((_, tolak) => {
    const t = setTimeout(() => tolak(new Error(pesan)), ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

/**
 * GET /api/music/search?q=...
 * Pencarian lagu untuk step musik di form menfess (publik, kena
 * globalLimiter di src/index.js — 100 request / 15 menit / IP).
 */
async function cariMusik(req, res) {
  const q = String(req.query.q || '').trim();
  if (q.length < Q_MIN || q.length > Q_MAKS) {
    return res.status(400).json({ error: `Kata kunci minimal ${Q_MIN} karakter.` });
  }

  try {
    const hasil = await Promise.race([cariLagu(q), kedaluwarsa(TIMEOUT_MS, 'pencarian lambat')]);
    res.json({
      data: hasil
        .filter((s) => s && typeof s.videoId === 'string' && typeof s.name === 'string')
        .slice(0, HASIL_MAKS)
        .map((s) => ({
          videoId: s.videoId,
          title: s.name,
          artist: s.artist?.name || 'Tanpa artis',
          duration: Number.isFinite(s.duration) ? s.duration : null,
          // thumbnails diurutkan besar -> kecil; yang terakhir paling ringan
          // untuk kartu thumbnail di form maupun dashboard.
          thumb: Array.isArray(s.thumbnails) && s.thumbnails.length
            ? s.thumbnails[s.thumbnails.length - 1].url
            : null,
        })),
    });
  } catch (err) {
    // Detail (URL internal YouTube, stack) cukup untuk log server; ke klien
    // hanya pesan ramah — 502 = "gangguan di sisi layanan".
    console.error('Cari musik error:', err);
    res.status(502).json({ error: 'Pencarian lagu sedang gangguan. Coba lagi.' });
  }
}

module.exports = { cariMusik };
```

**File baru: `menfs/backend/src/routes/music.js`**

```js
const express = require('express');
const { cariMusik } = require('../controllers/musicController');

const router = express.Router();

// GET /api/music/search — cari lagu (publik). Ikut globalLimiter yang dipasang
// di src/index.js SEBELUM route dipasang, jadi otomatis 100 req/15 menit/IP —
// endpoint ini tidak bisa dipakai membanjir YouTube dari IP server.
router.get('/search', cariMusik);

module.exports = router;
```

**Edit `menfs/backend/src/index.js`:**

- Tambah require (sejajar route lain, sekitar baris 11):
  ```js
  const musicRoutes = require('./routes/music');
  ```
- Mount setelah `app.use('/api/site', siteRoutes);` (baris ~115):
  ```js
  app.use('/api/music', musicRoutes);
  ```

**Verifikasi:** jalankan `npm run test:music` — kasus search (200 + isi
hasil, q pendek 400) sudah lulus; kasus lain masih RED karena controller submit
belum diubah.

**Commit:** `feat: endpoint GET /api/music/search (proxy ytmusic-api)`

---

## Task 5 — Submit menyimpan lagu + daftar admin membawa `music`

**Edit `menfs/backend/src/controllers/menfesController.js`:**

1. Setelah konstanta `TIPE_FOTO` (sekitar baris 18), tambah:

```js
// ── Lagu pilihan pengirim (opsional) ─────────────────────────────────────────
// Metadata lagu diterima SEBAGAI SNAPSHOT dari klien (bukan ditarik ulang dari
// YouTube) supaya submit tidak pernah gantung saat YouTube mati. Yang dijaga
// ketat hanya videoId — tautan playback satu-satunya — dan panjang teksnya.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const potong = (v, maks) => (typeof v === 'string' ? v.trim().substring(0, maks) : null);

function normalisasiMusic(mentah) {
  // Bentuk objek (request JSON) maupun string (FormData) sama-sama diterima.
  let m = mentah;
  if (typeof m === 'string') {
    try {
      m = JSON.parse(m);
    } catch {
      return { salah: 'Lagu tidak valid.' };
    }
  }
  if (!m || typeof m !== 'object') return { salah: 'Lagu tidak valid.' };
  if (!VIDEO_ID.test(String(m.videoId || ''))) return { salah: 'videoId lagu tidak valid.' };
  return {
    music: {
      videoId: String(m.videoId),
      title: potong(m.title, 100) || 'Tanpa judul',
      artist: potong(m.artist, 100) || 'Tanpa artis',
      thumb:
        typeof m.thumb === 'string' && m.thumb.startsWith('https://')
          ? m.thumb.substring(0, 500)
          : null,
      duration: Number.isFinite(m.duration) && m.duration >= 0 ? Math.round(m.duration) : null,
    },
  };
}
```

2. Di `submitMenfes`, setelah `const { message, senderName, senderInfo } = fields;`
   (baris ~68), tambah — **sebelum** upload Cloudinary dan pembuatan baris,
   supaya input rusak membalas 400 tanpa aset sampah (prinsip yang sama dengan
   periksaGambar):

```js
    // Lagu opsional — dinormalisasi SEBELUM upload foto dan pembuatan baris.
    let music = null;
    if (fields.music !== undefined && fields.music !== null && fields.music !== '') {
      const hasil = normalisasiMusic(fields.music);
      if (hasil.salah) return res.status(400).json({ error: hasil.salah });
      music = hasil.music;
    }
```

3. Di `prisma.menfes.create({ data: {...} })`, setelah `fotoUrl: urlFoto,`:

```js
          // Tanpa lagu: kolomnya TIDAK disentuh sama sekali (nullable JSON —
          // meng-omit lebih aman daripada menulis null eksplisit ke kolom Json).
          ...(music ? { music } : {}),
```

**Edit `menfs/backend/src/controllers/adminController.js`** — di `select`
daftar admin, setelah `fotoUrl: true,` (baris ~101):

```js
          // Lagu pilihan pengirim — hanya di sini (dashboard). API publik
          // sengaja tidak memilih kolom ini sama sekali.
          music: true,
```

**Verifikasi:**

```
cd menfs/backend && npm run test:music
```

Target: **SEMUA LULUS** (9 blok). Lalu regresi jalur lama:

```
npm run test:foto && npm run test:site
```

Keduanya harus tetap lulus seperti sebelumnya.

**Commit:** `feat: simpan lagu pilihan pengirim dan tampilkan di daftar admin`

---

## Task 6 — Frontend: API client, MusicPicker, geser step (musik 4, foto 5)

### 6a. `menfs/frontend/src/api/index.js`

Tambahkan setelah blok `menfesAPI` (sekitar baris 42):

```js
// ─── Musik (lagu pilihan pengirim) ───────────────────────────────────────────
export const musicAPI = {
  // Pencarian lewat backend (proxy ytmusic-api): browser tidak bicara langsung
  // ke YouTube, jadi tanpa CORS dan library cukup hidup di satu tempat. Ikut
  // globalLimiter (100 req/15 menit/IP) seperti route lain.
  cari: (q) => api.get('/music/search', { params: { q } }),
};
```

### 6b. File baru `menfs/frontend/src/components/MusicPicker.jsx`

```jsx
import { useEffect, useRef, useState } from 'react';
import { musicAPI } from '../api';

function fmtDurasi(d) {
  if (typeof d !== 'number' || !Number.isFinite(d)) return null;
  return `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
}

// ── Step "Musik" pada wizard menfess ─────────────────────────────────────────
// Cari lagu lewat backend, pilih satu hasil. Lagu TIDAK diputar di sini:
// pilihan ini murni referensi admin di dashboard, dan preview-nya memakai
// embed resmi YouTube di sana (berhenti sendiri di detik ke-30).
export default function MusicPicker({ value, onChange, disabled = false }) {
  const [q, setQ] = useState('');
  const [hasil, setHasil] = useState([]);
  const [cari, setCari] = useState(false);
  const [gagal, setGagal] = useState(false);
  const [kosong, setKosong] = useState(false);
  const seq = useRef(0);

  // Debounce 400ms: mengetik "tulus manusia baik" cukup memicu SATU request
  // (yang terakhir), bukan satu per ketukan. `seq` menjamin respons
  // pencarian lama yang tiba belakangan tidak menimpa yang baru.
  useEffect(() => {
    const kata = q.trim();
    if (kata.length < 2) {
      setHasil([]);
      setKosong(false);
      setGagal(false);
      return undefined;
    }
    const nomor = ++seq.current;
    const timer = setTimeout(async () => {
      setCari(true);
      setGagal(false);
      setKosong(false);
      try {
        const res = await musicAPI.cari(kata);
        if (nomor !== seq.current) return; // respons basi
        // axios menaruh body di res.data; body endpoint itu { data: [...] },
        // jadi daftar hasilnya di res.data.data (bukan res.data).
        const data = (res.data && res.data.data) || [];
        setHasil(data);
        setKosong(data.length === 0);
      } catch {
        if (nomor !== seq.current) return;
        setGagal(true);
      } finally {
        if (nomor === seq.current) setCari(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [q]);

  const durasi = value ? fmtDurasi(value.duration) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-700 dark:text-parchment-300 font-mono uppercase tracking-widest">
          Musik — Opsional
        </p>
        <span className="text-[10px] font-mono text-ink-500 dark:text-ink-200 border border-parchment-300 dark:border-ink-600 px-2 py-0.5 rounded-md">
          {value ? 'TERPILIH' : 'BOLEH DILEWATI'}
        </span>
      </div>

      <p className="text-[11px] text-ink-500 dark:text-parchment-400 font-mono leading-relaxed">
        Pilih satu lagu sebagai referensi admin. Cuma judul dan thumbnail yang
        disimpan — tidak ada audio yang diunggah ke server.
      </p>

      {value ? (
        <div className="rounded-xl border border-parchment-300 dark:border-ink-600 overflow-hidden">
          <div className="flex items-center gap-3 p-2.5 bg-parchment-100 dark:bg-ink-800">
            {value.thumb ? (
              <img
                src={value.thumb}
                alt=""
                className="w-12 h-12 rounded-lg object-cover bg-parchment-200 dark:bg-ink-900"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-parchment-200 dark:bg-ink-900" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-900 dark:text-parchment-100 truncate">
                {value.title}
              </p>
              <p className="text-xs text-ink-500 dark:text-parchment-400 truncate">
                {value.artist}
                {durasi ? ` · ${durasi}` : ''}
              </p>
            </div>
          </div>
          <div className="flex gap-2 p-2 bg-parchment-100 dark:bg-ink-800 border-t border-parchment-300 dark:border-ink-600">
            {/* Ganti: kembali ke daftar hasil dengan query yang masih ada. */}
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled}
              className="flex-1 text-xs font-mono font-semibold py-2 rounded-lg border border-parchment-300 dark:border-ink-600 text-ink-700 dark:text-parchment-300 hover:bg-parchment-200 dark:hover:bg-ink-700 transition-colors"
            >
              Ganti
            </button>
            {/* Hapus: bersihkan pilihan SEKALIGUS query dan hasil. */}
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setQ('');
                setHasil([]);
              }}
              disabled={disabled}
              className="flex-1 text-xs font-mono font-semibold py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            >
              Hapus
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            id="music-cari"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari lagu, mis. tulus manusia baik"
            disabled={disabled}
            maxLength={100}
            autoComplete="off"
            className="input-field font-mono text-sm"
          />

          {gagal && (
            <p className="text-xs font-mono text-red-500 dark:text-red-400">
              Lagu lagi gangguan. Coba lagi beberapa saat.
            </p>
          )}
          {cari && (
            <p className="text-xs font-mono text-ink-400 dark:text-parchment-400">Mencari...</p>
          )}
          {!cari && !gagal && kosong && (
            <p className="text-xs font-mono text-ink-400 dark:text-parchment-400">
              Lagu tidak ditemukan. Coba kata kunci lain.
            </p>
          )}

          <ul className="space-y-1.5 max-h-56 overflow-y-auto">
            {hasil.map((s) => (
              <li key={s.videoId}>
                <button
                  type="button"
                  onClick={() => onChange(s)}
                  disabled={disabled}
                  className="w-full flex items-center gap-3 p-2 rounded-lg border border-parchment-300 dark:border-ink-600 text-left hover:border-brand-500 hover:bg-parchment-200/50 dark:hover:bg-ink-700/50 transition-colors"
                >
                  {s.thumb ? (
                    <img
                      src={s.thumb}
                      alt=""
                      className="w-10 h-10 rounded-md object-cover bg-parchment-200 dark:bg-ink-900 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-parchment-200 dark:bg-ink-900 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-ink-900 dark:text-parchment-100 truncate">
                      {s.title}
                    </span>
                    <span className="block text-[11px] text-ink-500 dark:text-parchment-400 truncate">
                      {s.artist}
                      {fmtDurasi(s.duration) ? ` · ${fmtDurasi(s.duration)}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

Catatan desain: saat memilih lagu, `q`/`hasil` sengaja TIDAK dibersihkan —
supaya tombol "Ganti" langsung menampilkan daftar hasil sebelumnya.

### 6c. `menfs/frontend/src/pages/HomePage.jsx` (8 edit)

1. **Import** — tambah baris baru setelah import `TemplatePreview`:
   `import MusicPicker from '../components/MusicPicker';`
   (`musicAPI` TIDAK ikut diimpor di sini — pemanggilannya hanya ada di
   dalam MusicPicker; import yang menganggur bisa kena lint.)

2. **State** — setelah `const [step, setStep] = useState(1);`:

```js
  // Lagu pilihan pengirim (step 4). Null = tanpa lagu — fieldnya tidak ikut
  // dikirim, server menyimpan kolom music sebagai NULL.
  const [music, setMusic] = useState(null);
```

3. **Judul step** — ganti seluruh objek `stepTitles` (sekitar baris 360):

```js
  const stepTitles = {
    1: 'Pilih Template',
    2: 'Isi Pesan',
    3: 'Tampil Sebagai',
    4: 'Musik — Opsional',
    5: 'Foto — Opsional',
  };
```

4. **Dot wizard mobile** — `{[1, 2, 3, 4].map((s) => (` → `{[1, 2, 3, 4, 5].map((s) => (`

5. **Sisipkan step Musik + geser Foto ke 5** — ganti blok yang diawali komentar
   `{/* 5. Foto — opsional, jadi slide kedua di post IG */}`:

```jsx
              {/* 4. Musik — opsional, cuma referensi admin di dashboard */}
              <div className={`space-y-3 ${step === 4 ? '' : 'hidden sm:block'}`}>
                <MusicPicker value={music} onChange={setMusic} disabled={submitting} />
              </div>

              {/* 5. Foto — opsional, jadi slide kedua di post IG */}
              <div className={`space-y-3 ${step === 5 ? '' : 'hidden sm:block'}`}>
```

   (blok isi Foto di bawahnya tidak berubah sama sekali)

6. **Navigasi mobile** — `{step < 4 && (` → `{step < 5 && (`

7. **Info privasi** — `${step === 3 || step === 4 ? '' : 'hidden sm:block'}`
   → `${step === 3 || step === 4 || step === 5 ? '' : 'hidden sm:block'}`

8. **Tombol KIRIM** — pada baris `btn-primary w-full ...`:
   `${step === 4 ? '' : 'hidden sm:block'}` → `${step === 5 ? '' : 'hidden sm:block'}`

9. **`handleSubmit`** — di jalur FormData, setelah
   `form.append('foto', foto, foto.name);`:

```js
        // Lagu dikirim sebagai string JSON (FormData hanya menyimpan teks).
        if (music) form.append('music', JSON.stringify(music));
```

   di jalur JSON:

```js
        await menfesAPI.submit({
          message: trimmed,
          senderName: isAnon ? null : senderName.trim(),
          senderInfo: selectedTemplate.name,
          // Lagu hanya ikut kalau dipilih; tanpa pilihan, field tidak dikirim.
          ...(music ? { music } : {}),
        });
```

10. **`handleReset`** — tambah `setMusic(null);` sebelum `setStep(1);`

**Verifikasi:** dari `menfs/frontend`:

```
npm run build
```

Build lolos tanpa error ESLint/JSX.

**Commit:** `feat: step musik di form menfess (musik ke-4, foto ke-5)`

---

## Task 7 — Dashboard admin: blok lagu + preview 30 detik

**Edit `menfs/frontend/src/pages/AdminDashboardPage.jsx`:**

1. Tambah komponen helper sebelum `export default function AdminDashboardPage()`
   (sejajar `StatusBadge`):

```jsx
// ── Lagu pilihan pengirim ────────────────────────────────────────────────────
// Tampil hanya kalau menfess membawa lagu. Preview memakai embed YouTube resmi
// dengan parameter end=30: player BERHENTI SENDIRI di detik ke-30 — yang
// terdengar cuma preview, dan tidak ada audio yang lewat server kita.
// Iframe dirender HANYA saat tombol Putar ditekan (dan dibuang saat
// dihentikan): tanpa autoplay, tanpa player yang terus berbunyi saat scroll.
function BlokMusik({ music }) {
  const [putar, setPutar] = useState(false);
  const durasi =
    typeof music.duration === 'number' && Number.isFinite(music.duration)
      ? `${Math.floor(music.duration / 60)}:${String(music.duration % 60).padStart(2, '0')}`
      : null;

  return (
    <div className="bg-ink-800 border border-ink-600 rounded-lg p-2.5 sm:p-3 space-y-2.5">
      <div className="flex items-start gap-3">
        {putar ? (
          <iframe
            className="w-40 h-24 sm:w-56 sm:h-32 rounded-lg border border-ink-600 bg-ink-900 shrink-0"
            src={`https://www.youtube-nocookie.com/embed/${music.videoId}?start=0&end=30&rel=0`}
            title={`Preview ${music.title}`}
            allow="accelerometer; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          music.thumb && (
            <img
              src={music.thumb}
              alt=""
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover border border-ink-600 bg-ink-900 shrink-0"
            />
          )
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono font-bold text-ink-200 tracking-widest uppercase mb-0.5">
            Lagu Pilihan
          </p>
          <p className="text-xs sm:text-sm text-parchment-200 font-semibold truncate">
            {music.title}
          </p>
          <p className="text-[11px] text-ink-300 truncate">
            {music.artist}
            {durasi ? ` · ${durasi}` : ''}
          </p>
          <p className="text-[10px] text-ink-400 font-mono mt-0.5">
            Preview 30 detik · embed YouTube
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPutar((p) => !p)}
        className="flex items-center gap-1.5 text-[11px] font-mono font-semibold px-3 py-1.5 rounded-lg border border-brand-600 text-brand-400 hover:bg-brand-600/10 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        {putar ? 'Hentikan' : 'Putar'}
      </button>
    </div>
  );
}
```

2. Render di kartu — setelah blok Foto pengirim (yang diawali
   `{/* Foto pengirim — slide kedua di post IG; ... */}`, sekitar baris 553-573),
   sebelum `{/* Info pengirim & Template */}`:

```jsx
                    {/* Lagu pilihan pengirim — referensi admin saja, tidak
                        pernah ikut ke feed publik maupun Instagram. */}
                    {item.music && <BlokMusik music={item.music} />}
```

Catatan: `state` `putar` ikut unmount saat list re-render/tab ganti/dihapus —
player berhenti otomatis tanpa logika tambahan.

**Verifikasi:** `cd menfs/frontend && npm run build` → lolos.

**Commit:** `feat: preview lagu 30 detik di dashboard admin`

---

## Task 8 — Verifikasi menyeluruh + E2E (TANPA push)

**8a. Suite backend** (dari `menfs/backend`):

```
npm run test:music
npm run test:foto
npm run test:site
```

Ketiganya harus lulus penuh. (Jangan pakai `test:all` sebagai gerbang —
`test:admin-perf` gagal karena kondisi DB dev yang sudah >500 baris, pre-existing.)

**8b. Build frontend:** `cd menfs/frontend && npm run build` → lolos.

**8c. E2E browser (lokal):**

1. Nyalakan backend `npm run dev` (:3001) dan frontend `npm run dev` (:5173)
   di dua shell terpisah.
2. Buka `http://localhost:5173`, isi menfess, maju ke **step 4**, cari lagu
   (mis. "tulus"), pilih satu → badge `TERPILIH`, lanjut **step 5**, kirim.
3. Login admin `http://localhost:5173/4613a76adb4fb2dc` (admin/admin123) →
   kartu terbaru memuat blok **Lagu Pilihan** (thumbnail + judul + artist).
4. Klik **Putar** → iframe `youtube-nocookie.com/embed/...&end=30` muncul;
   biarkan sampai ~30 detik → player berhenti sendiri. Klik **Hentikan** →
   iframe hilang, audio mati.
5. Cek feed publik: `GET /api/menfes` (via jaringan di browser) → response
   baris manapun TIDAK punya key `music`.
6. Ulangi submit TANPA memilih lagu → kartu admin tanpa blok lagu.
7. Bersihkan baris uji lewat tombol Hapus di dashboard (aset tidak terkait
   foto jadi tidak ada yang perlu dibersihkan di Cloudinary).

Catatan agent-browser: kutip argumen ber-`@` di PowerShell, tanpa heredoc,
`wait --timeout` dalam ms, textarea via `click` + `keyboard inserttext`,
dialog hapus = `div.fixed.inset-0` (Batal/Hapus), IntroLoader 2.4 detik.

**8d. Laporan akhir ke user:** daftar commit lokal (N commit), hasil test,
hasil E2E. **Jangan push.** Tunggu perintah push dari user.

## Risiko yang diketahui (diterima)

- **Library unofficial** (`ytmusic-api`): bisa pecah kalau YouTube mengubah
  API internalnya → terisolasi di `src/lib/ytmusic.js`, endpoint membalas 502
  ramah, form menfess tetap jalan tanpa lagu.
- **Admin cache 10 detik** (`adminCache`): setelah submit baru, kartu lagu
  bisa muncul maksimal ~10 detik kemudian kalau daftar sempat dibaca duluan —
  perilaku yang sama sudah ada untuk `fotoUrl`.
- **Search di rate limit global** (100/15 menit/IP): user mengetik beberapa
  karakter punya debounce 400ms, jadi wajar-wajar saja; kalau kena 429,
  MusicPicker menampilkan "lagu lagi gangguan".
