## 5. Risiko Kredibilitas — untuk internal lu, jangan dipublish

Bagian ini **bukan** naskah post. Ini daftar yang harus lu tahu soal klaim yang ada di produk lu sekarang.

### 5.1 Klaim "anonim" di HomePage tidak sepenuhnya benar di kode

`frontend/src/pages/HomePage.jsx:292` membuat janji anonim tanpa syarat.

Tapi di `frontend/src/components/ExportModal.jsx:26`, template share default berisi:

```jsx
Dari: ${menfes?.senderName || 'Seseorang'}
```

Artinya: kalau pengirim memilih "nama sendiri", **nama aslinya ikut terbakar ke dalam gambar** yang justru dipakai untuk share. Ini bukan abstraksi — ini kode yang jalan.

**Kenapa ini penting sekarang:** kalau post lu konsisten bicara soal trust dan safety, ada yang akan membongkar ini lewat reverse engineering dan menemukaninya. Credibility loss jauh lebih besar daripada gains dari satu post bagus.

**Tiga opsi:**

1. Ubah default share template supaya `senderName` nggak masuk (fix di kode, sekitar 10 menit)
2. Ubah copy HomePage jadi conditional: "anonim **kalau kamu pilih anonim**"
3. Address langsung di post: "Kami punya satu celah, dan ini cara kami menutupnya"

Gw lean **opsi 1 atau 2**. Opsi 3 hanya kalau lu memang mau jadi lebih radikal dengan trust-first positioning.

### 5.2 README.md kosong

`README.md` di repo lu isinya cuma `HAHAHAHHAHAHAH`. Kalau Q5 (takedown policy) mau tayang, **rules harus ada di halaman yang bisa dibaca publik** — website lu atau bio IG. Tanpa itu, semua argumen "kami punya trigger yang jelas" jadi kosong.

Ini bukan content task — ini prasyarat sebelum content task.

### 5.3 Kapasitas follow-up

Q2 dan Q7 sama-sama mengakui: feedback anonim cuma berguna kalau ada yang merespons. Kalau lu tayang post itu tanpa ada mekanisme follow-up, existing followers akan merasa itu jadi **marketing, bukan policy**. Dan mereka akan benar.

---

## 6. Cara memotong jadi post

| Post | Q | Format | Slide count | Why |
|---|---|---|---|---|
| 1 | Q1 | Carousel | 8 | Hook: "kampus punya box saran. tapi kenapa nggak ada yang pakai?" |
| 2 | Q4 | Carousel | 6 | Safety-critical. Tone serius, no humor. |
| 3 | Q5 | Carousel | 9 | Trust-building. Post anchor paling penting untuk policy credibility. |
| 4 | Q7 | Carousel | 7 | Competitive positioning. |
| 5 | Q6 | Carousel | 6 | Legal. Short, factual, CTA = report bukan share. |
| 6 | Q2 | Carousel | 7 | Feature-length. Alternatif pembuka untuk post Q7. |
| 7 | Q3 | Carousel | 6 | Skeptical audience. Bagus untuk reply dari DM. |

**Urutan gw rekomendasikan: 1 → 4 → 3 → 7 → 6 → 5 → 2**

Alasan: mulai dari "kenapa ini penting" (murah, uncontroversial), interrupt dengan safety (bikin trust), baru masuk ke policy (mulai berat), close dengan positioning dan legal.

Jangan post semua 7 sekaligus. Satu per sekitar 3–4 hari, dan **jawab tiap komentar dengan argumen yang sama dengan yang ada di doc ini** — konsistensi itu yang bikin existing followers ngerti ini kebijakan, bukan campaign.

---

## 7. Yang belum ada, dan jujur harus lo akui

- **Belum ada rules yang tertulis publik.** → prasyarat, bukan konten
- **Belum ada mekanisme takedown yang operasional.** → Q5 butuh ini supaya nyata
- **Belum ada proses follow-up ke pengirim.** → Q2 jujur soal ini, tapi itu gap, bukan fitur
- **Belum ada data.** → jangan pernah sneak in "kampus kita menerima X menfes" kalau belum true
- **Celah `senderName` di share image.** → lihat 5.1

Post yang jujur soal lima hal di atas **lebih dipercaya daripada post yang terlihat punya semua jawaban**. Dan untuk existing followers yang sudah cukup bet staying, itu yang mereka cari.
