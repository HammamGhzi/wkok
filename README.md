# Menfes HarkatNekatt

Web menfes anonim buat komunitas Harkat Nekatt. User nulis pesan, pilih template
kartu, tambah musik/foto (opsional). Admin review di dashboard, lalu terbitkan ke
Instagram @harkatnekatt — pesan panjang otomatis jadi beberapa kartu (carousel).

## Struktur

Dua app terpisah, dua `package.json`, dua proses:

```
menfs/
├── frontend/   # React + Vite, deploy ke static hosting
└── backend/    # Express + Prisma + PostgreSQL, deploy ke Render
```

## Menjalankan

```bash
# backend (Node >= 20, butuh .env: DATABASE_URL, IG_*, JWT_SECRET, dsb.)
cd backend
npm install
npm run dev          # nodemon, port 4000 (default)

# frontend (proxy Vite ke backend lewat vite.config)
cd frontend
npm install
npm run dev          # vite, port 5173
```

## Test

```bash
cd frontend && npm test                 # node --test (util murni: pagination, chunkLines)

cd backend
npm run test:ig-publish                 # service igPublish, mock fetch, tanpa DB/IG
npm run test:ig-route                   # route admin publish, mock Prisma + service
```

## Alur terbit ke Instagram

1. User kirim menfess (`POST /api/menfess`) → status PENDING.
2. Admin approve di dashboard → dijadwalkan otomatis atau dipublish manual.
3. Backend merender kartu via endpoint template, unggah ke container IG,
   lalu publish — 1 kartu = post biasa, >1 kartu = carousel
   (kartu berurutan, foto pengirim sebagai slide terakhir, maks 10 anak).
4. Pesan panjang dipecah per `maxLines` template; preview menampilkan semua
   kartu dengan navigasi `‹ ›`.

## Template

Kartu dirender dari PNG template (4:5, 1080×1350) dengan area teks ber-coordinates
`bounds` di `frontend/src/config/templates.js`:

- `template4` (fess), `template5` (tuyul), `template6` (kelas) — variant lite,
  handle `@harkatnekatt` di tepi atas panel.
- PNG sumber ada di `frontend/public/template/`, hasil render dari project
  `templatemaker/` di root repo (Canvas 2D, bukan image editor).

## Keputusan desain yang gampang dilupakan

- Fitur pengirim (nama pengirim) sudah dihapus total — anonimitas mutlak.
  Kolom `senderName` di DB dibiarkan buat data historis, hanya ditampilkan.
- Field upload lama `image` sudah diganti `images[]`; backend menolak `image`
  dengan 400 agar tidak ada dua jalur upload yang hidup berdampingan.
- Foto pengirim dipasangi bingkai (krem + handle) di browser saat user memilih —
  foto asli tidak pernah disimpan, semua yang sampai server sudah berbingkai.
- Foto user rasio aslinya dipertahankan (tidak dipaksa 4:5), cuma diskalakan.
