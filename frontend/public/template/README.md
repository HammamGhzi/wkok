# Template Menfess Harkat Nekatt

Folder ini menyimpan file background template yang dapat dipilih oleh pengguna saat mengirim menfess dan saat admin melakukan export ke Instagram feed:

## Daftar Template:

1. **Template 1 (`template-1.png` / `template 1.png`)**
   - Rasio rekomendasi: 4:5 (Portrait - 1080x1350 px)
   - Gaya: Langit biru cerah, awan, daun melayang, dan kartu frosted glass (glassmorphism)
   - Teks pesan: Warna putih (`#ffffff`), font clean modern (`Inter`)

2. **Template 2 (`template-2.png` / `template 2.png`)**
   - Rasio rekomendasi: 4:5 (Portrait - 1080x1350 px)
   - Gaya: Kertas putih bersih elegan & minimalis
   - Teks pesan: Warna hitam (`#111111`), font monospace / clean

3. **Template 3 (`template-3.png`)**
   - Rasio rekomendasi: 4:5 (Portrait - 1080x1350 px)
   - Gaya: Kertas scrapbook krem di atas dasar pink, tulisan tangan `@HARKATNEKATT`, lubang ring, dan hati biru
   - Teks pesan: Hitam kehangatan (`#2f2822`), font `DM Sans`
   - Hanya ada satu nama file (tanpa twin bergaya spasi seperti template 1 & 2), jadi `fallbackSrc` di config sengaja `null`
   - Label `Dikirim oleh:` sudah tercetak di gambar, jadi nama pengirim digambar di sebelah kanannya pada baseline yang sama

`logo.jpg` bukan template - itu favicon dan header logo aplikasi.

Catatan: urutan template di `src/config/templates.js` itu berarti. Entri pertama
menjadi default seluruh app, jadi template yang dihapus dari atas akan otomatis
menggantikan default.

## Cara Mengganti / Memperbarui:
Cukup replace file gambar yang sesuai di folder ini dengan nama file yang sama.
Refresh halaman web atau modal export untuk melihat pembaruan.
