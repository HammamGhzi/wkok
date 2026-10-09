# Desain: Musik di Menfess (Pilih Lagu Saat Submit)

Tanggal: 2026-10-09
Status: menunggu review
Repo: menfs/

## Konteks

User boleh menempelkan satu lagu ke menfess-nya saat mengirim. Lagu ini
**eksklusif untuk admin** — dipakai sebagai referensi saat review di
dashboard, dengan pemutaran lagu utuh lewat embed YouTube. Feed publik dan
Instagram TIDAK menampilkan musik sama sekali.

Keputusan yang sudah disepakati:

- Library: **`ytmusic-api` (npm, v5.3.1)** — satu bahasa dengan backend
  (Node/Express), tanpa sidecar Python. Dipilih karena cakupan kebutuhan
  hanya search + metadata; library Python `ytmusicapi` tidak diperlukan.
- Library dipanggil **dari backend, bukan browser** — endpoint search jadi
  proxy, CORS/cookie tidak bocor ke klien.
- Playback memakai **YouTube IFrame resmi**
  (`youtube-nocookie.com/embed/...?autoplay=1&start=<posisi>`) yang selalu
  dirender **tersembunyi (`sr-only`)** — TIDAK PERNAH ada wujud player
  YouTube yang terlihat, jadi tampilan tidak pernah "berubah jadi
  player". Satu implementasi untuk semua pemutar:
  **`src/hooks/usePreviewLagu.jsx`** (jeda/lanjut, posisi, timer
  berhenti di `duration` snapshot) dipakai MusicPicker (step 4 user)
  dan blok Lagu Pilihan di ExportModal (admin). Lagu **diputar utuh
  (tanpa `end`)**; kalau `duration` null → tanpa auto-stop. Tidak ada
  streaming/download audio di sisi kita.
  (Revisi: batas preview 30 detik DITINGGALKAN atas permintaan user —
  "1 lagu utuh", berlaku untuk step 4 user DAN dashboard admin.)
- Urutan wizard: **step 4 = Musik (opsional), step 5 = Foto (opsional)**.
- Tidak di-push ke origin sampai user bilang push.

## Alur

```
User: step 1-3 (template, pesan, identitas) -> step 4 Musik (opsional)
   -> step 5 Foto (opsional) -> KIRIM
        |
        v
Backend: validasi format videoId + sanitasi judul/artist
        -> simpan snapshot di kolom JSON `music`
        |
        v
Admin dashboard: blok musik = INFO saja di detail kartu
   -> buka Export IG -> kartu Lagu Pilihan -> klik icon putar
      -> suara dari iframe tersembunyi, utuh dari awal (tanpa UI YouTube)
Feed publik / IG: tanpa jejak musik (kolom tidak di-select)
```

## Backend

### 1. Endpoint search baru

- `GET /api/music/search?q=<query>` — publik, ikut rate-limit global.
- Query minimal 2 karakter, maksimal 100; balas maksimal 10 hasil:
  `{ videoId, title, artist, duration, thumb }` diambil dari
  `ytmusic-api.searchSongs()`.
- Client `ytmusic-api` di-`initialize()` LAZY (saat pencarian pertama, hasilnya
  di-cache sebagai promise) — server tetap bisa start walau YouTube tidak
  terjangkau, dan kegagalan initialize melempar error yang dibalas 502 ramah
  (diperbarui dari rancangan awal "sekali saat server start")
  (tanpa cookies — search publik tidak butuh login).
- Ke-gagalan dari YouTube (timeout/5xx) -> `502` dengan pesan
  "Pencarian lagu sedang gangguan, coba lagi." — jangan bocorkan detail
  error internal ke klien.

### 2. Submit menfes

- Field baru opsional `music: { videoId, title, artist, thumb }` (boleh
  tidak dikirim sama sekali = tanpa lagu).
- Validasi `videoId`: tepat 11 karakter `[A-Za-z0-9_-]` -> selain itu
  `400`. `title`/`artist`/`thumb` di-truncate (100 / 100 / 500 karakter)
  — **snapshot dari klien, tidak diambil ulang dari YouTube**, supaya
  submit tidak pernah gantung saat YouTube mati.
- Tidak ada perubahan perilaku lama: tanpa field `music`, jalurnya
  identik (back-compat).

### 3. Pembatasan bocoran

- API publik `getApprovedMenfes`: **kolom `music` tidak di-select**
  (sama seperti `fotoUrl`).
- API admin: `music` ikut di-select.
- `igPublish.js` dan export modal: tidak disentuh — caption/kartu IG tidak
  pernah membaca `music`.

## Database

Prisma: tambah `music Json?` di model `Menfes` — **nullable, tanpa
default, tanpa migrasi data** (`ADD COLUMN` saja, aman untuk DB shared).
Snapshot metadata murni tampilan admin, tidak pernah di-query/filter,
jadi satu kolom JSON (bukan 4 kolom terpisah).

## Frontend (HomePage.jsx)

- `stepTitles`: `4: 'Musik — Opsional'`, `5: 'Foto — Opsional'`
  (foto bergeser dari 4 ke 5).
- Widget baru **MusicPicker** di step 4:
  - input search dengan debounce 400ms -> `GET /api/music/search`.
  - daftar hasil: thumbnail + judul + artist + durasi; klik = pilih
    **langsung bunyi**, klik lagu lain = ganti (tanpa tombol Ganti).
  - **Daftar hasil tidak pernah digantikan tampilan player YouTube.**
    Pilihan tampil sebagai strip tipis di atas input: thumbnail 48px
    (overlay icon SVG play/pause), judul/artist/durasi, tombol **Hapus**;
    baris terpilih di daftar di-highlight.
  - Audio bunyi dari iframe `youtube-nocookie` yang dirender **tersembunyi
    (`sr-only`, bukan `display:none`)** selama state `putar` aktif:
    `autoplay=1&start=<posisi>&rel=0` — **tanpa `end`, lagu diputar
    utuh**. Pause = buang iframe + simpan posisi di ref; lanjut = mount
    ulang `start=<posisi>`; timer internal (deps `[putar, value]`)
    berhenti di `duration` snapshot sehingga icon balik ke "putar" dan
    posisi direset saat durasi habis — kalau `duration` null, tanpa
    auto-stop (user jeda sendiri). **berhenti — iframe dibuang — saat
    user tinggali step 4** lewat prop `aktif={step === 4}` di HomePage,
    supaya audio tidak terus menyiarkan dari container yang tersembunyi
    CSS.
  - Tombol **Hapus** hanya membuang pilihan; query + hasil sengaja
    dipertahankan supaya user tinggal klik lagu lain.
  - Logika bunyi (jeda/lanjut, posisi, timer, render iframe) diangkat ke
    hook `src/hooks/usePreviewLagu.jsx` — dipakai bareng ExportModal
    supaya cuma ada satu implementasi.
  - ke-gagalan search -> pesan "lagu lagi gangguan" tanpa merusak form.
  - step opsional: boleh dilewati tanpa konsekuensi.
- Wizard mobile: dot `[1..5]`, "Lanjut" sampai `step < 5`, tombol KIRIM
  tampil di step 5.
- Info privasi (sekarang `step === 3 || step === 4`) -> tampil di
  `step === 3 || step === 4 || step === 5`.
- `handleSubmit` menyertakan `music` (atau tidak, kalo kosong);
  `handleReset` me-reset pilihan lagu.

## Admin Dashboard

- Blok musik di **area detail kartu** (bukan input caption IG):
  **MURNI INFO** — thumbnail + judul + artist + durasi. Tanpa tombol,
  tanpa iframe/player (revisi user: "yang di luarnya ... info aja").
- **Pemutaran pindah ke dalam ExportModal** (modul export IG): kartu
  "Lagu Pilihan" di kolom controls, tepat sebelum blok Caption
  Instagram, dengan **tampilan yang sama persis** (thumb + judul +
  artist + durasi) + satu icon putar/jeda 44px. Bunyi dari iframe
  YouTube tersembunyi (`sr-only`, hook `usePreviewLagu`) — tanpa UI
  player YouTube — lagu utuh, jeda/lanjut menyimpan posisi, tutup
  modal -> komponen unmount -> audio mati.
- Musik **tidak pernah ikut** ke caption, gambar, maupun post IG.
- Baris tanpa `music` tidak menampilkan blok apa pun (di kartu maupun
  di modal).

## Error Handling

| Kondisi | Perilaku |
| --- | --- |
| YouTube search gagal / timeout | 502 pesan friendly; frontend tampilkan "lagu lagi gangguan" |
| `q` < 2 karakter | 400 (client seharusnya tidak mengirim) |
| `videoId` tidak valid di submit | 400, pesan field jelas |
| Kolom `music` null | semua tampilan diam-diam tanpa blok (old rows) |
| Embed diblokir YouTube | iframe normal menampilkan player error — tidak ditangani khusus |

## Testing

- `backend/test-music.cjs` (pola test lain, HTTP nyata):
  1. `GET /api/music/search?q=...` -> 200 berisi `videoId` 11
     karakter + `title` + `thumb` (query nyata ke YouTube).
  2. search `q` pendek -> 400.
  3. submit menfes dengan `music` valid -> 201, kolom terisi.
  4. submit tanpa `music` -> 201, kolom null (back-compat).
  5. submit `videoId` salah format -> 400, baris tidak dibuat.
  6. API publik `getApprovedMenfes` **tidak** membawa field `music`.
  7. API admin membawa field `music`.
  8. baris uji dibersihkan di `finally`.
- Frontend: verifikasi manual via browser (klik lagu -> **daftar tetap
  tampil** + audio bunyi dari iframe tersembunyi dan jalan utuh sampai
  durasi habis -> jeda/lanjut via icon thumbnail (`start=<posisi>`) ->
  klik lagu lain ganti dari nol -> Hapus -> pindah step bunyi mati ->
  submit -> kartu admin berupa info saja (tanpa tombol) -> buka Export
  IG -> klik icon putar di kartu Lagu Pilihan (tanpa UI YouTube, utuh)
  -> tutup modal bunyi mati).

## Batasan (By Design)

- Tidak ada audio streaming sendiri, tidak ada download, tidak ada
  penyimpanan file lagu — hanya `videoId` + snapshot teks.
- Autoplay **hanya di step 4 sisi user** dan dibuang saat tinggalkan
  step 4. Playback **utuh tanpa batas 30 detik** (revisi user); detik
  berhenti otomatis dihitung dari `duration` snapshot (fallback: tanpa
  auto-stop). Dashboard admin tetap tanpa autoplay — klik Putar manual.
- UI sisi user: **daftar lagu selalu tampil** — tidak pernah ada player
  YouTube hitam yang menggantikannya; tidak ada tombol Ganti (klik lagu
  lain = ganti).
- Satu-satunya tempat memutar lagu: step 4 user dan kartu Lagu Pilihan
  di dalam ExportModal — dua-duanya lewat iframe tersembunyi, jadi
  tampilan tidak pernah berubah jadi player YouTube.
- Search di belakang rate-limit global (tidak bisa dipakai untuk membanjir
  YouTube dari IP server).
- Library unofficial: bisa pecah kalo YouTube mengubah internal API;
  risiko diterima, mitigasi = endpoint terisolasi (`src/lib/ytmusic.js`)
  sehingga bisa diganti tanpa menyentuh controller.
