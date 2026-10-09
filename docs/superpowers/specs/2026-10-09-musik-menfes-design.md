# Desain: Musik di Menfess (Pilih Lagu Saat Submit)

Tanggal: 2026-10-09
Status: menunggu review
Repo: menfs/

## Konteks

User boleh menempelkan satu lagu ke menfess-nya saat mengirim. Lagu ini
**eksklusif untuk admin** — dipakai sebagai referensi saat review di
dashboard, dengan preview 30 detik. Feed publik dan Instagram TIDAK
menampilkan musik sama sekali.

Keputusan yang sudah disepakati:

- Library: **`ytmusic-api` (npm, v5.3.1)** — satu bahasa dengan backend
  (Node/Express), tanpa sidecar Python. Dipilih karena cakupan kebutuhan
  hanya search + metadata; library Python `ytmusicapi` tidak diperlukan.
- Library dipanggil **dari backend, bukan browser** — endpoint search jadi
  proxy, CORS/cookie tidak bocor ke klien.
- Playback preview memakai **YouTube IFrame resmi**
  (`youtube-nocookie.com/embed/...&end=30`), iframe dirender hanya saat
  tombol Putar diklik. Tidak ada streaming/download audio di sisi kita.
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
Admin dashboard: blok musik di detail kartu
   -> klik Putar -> iframe YouTube, berhenti sendiri di detik ke-30
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
  - daftar hasil: thumbnail + judul + artist + durasi; klik = pilih.
  - state terpilih: kartu "TERPILIH" + tombol Ganti/Hapus — pola blok
    Foto (Ganti/Hapus) dipakai ulang.
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
  thumbnail + judul + artist + tombol **Putar**.
- Klik Putar -> mount iframe
  `https://www.youtube-nocookie.com/embed/{videoId}?start=0&end=30&rel=0`
  (berhenti sendiri di detik ke-30). Tanpa autoplay; iframe dibuang saat
  blok ditutup/diganti agar tidak terus menyiarkan audio.
- Baris tanpa `music` tidak menampilkan blok apa pun.

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
- Frontend: verifikasi manual via browser (submit -> dashboard -> klik
  Putar -> preview berhenti di ~30 detik).

## Batasan (By Design)

- Tidak ada audio streaming sendiri, tidak ada download, tidak ada
  penyimpanan file lagu — hanya `videoId` + snapshot teks.
- Tidak ada autoplay.
- Search di belakang rate-limit global (tidak bisa dipakai untuk membanjir
  YouTube dari IP server).
- Library unofficial: bisa pecah kalo YouTube mengubah internal API;
  risiko diterima, mitigasi = endpoint terisolasi (`src/lib/ytmusic.js`)
  sehingga bisa diganti tanpa menyentuh controller.
