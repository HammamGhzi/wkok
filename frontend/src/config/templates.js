/**
 * Konfigurasi Template Menfess Harkat Nekatt
 * Mendukung template 1 (Blue Sky), template 2 (White Minimalist), dan
 * template 3 (Pink Scrapbook).
 *
 * CATATAN: entri pertama di TEMPLATES adalah default seluruh app - dipakai
 * getTemplateById() saat id tidak dikenal dan parseTemplateFromMenfes() saat
 * senderInfo tidak cocok. Menghapus atau mengurutkan ulang entri ini akan
 * diam-diam mengganti template default.
 */

// Cache busting parameter agar browser selalu memuat file gambar terbaru saat diganti
const CACHE_KEY = Date.now();

export const TEMPLATES = [
  {
    id: 'template1',
    name: 'Template 1',
    badge: 'Template 1',
    tag: 'Blue Sky Glass',
    description: 'Awan biru cerah & kartu glassmorphism',
    src: `/template/template 1.png?v=${CACHE_KEY}`,
    fallbackSrc: `/template/template-1.png?v=${CACHE_KEY}`,
    thumbnail: `/template/template 1.png?v=${CACHE_KEY}`,
    defaultRatio: '4:5',
    themeColor: '#0284c7', // sky
    accentColor: '#38bdf8',
    textColor: '#ffffff',
    textShadow: '0 2px 10px rgba(0,0,0,0.3)',
    fontFamily: "'Poppins', sans-serif",
    fontWeight: '600',
    defaultFontSize: 38,
    defaultFontSizeName: 28,
    lineHeightMultiplier: 1.5,
    maxLines: 10,
    bounds: {
      '4:5': { x: 0.13, y: 0.28, w: 0.74, h: 0.48, padX: 0.04, padY: 0.04 },
      '1:1': { x: 0.13, y: 0.25, w: 0.74, h: 0.50, padX: 0.04, padY: 0.04 },
    },
    defaultSender: {
      posX: 27.5,
      posY: 82.5,
      rotate: 0,
      color: '#ffffff',
      fontFamily: "'Poppins', sans-serif",
      fontWeight: '600',
      prefix: '',
      hasBakedAnon: false,
    },
    // Posisi blok teks pesan, dalam persen dari canvas penuh dan diukur dari
    // titik tengah blok (bukan tepi kiri). Semua template punya kertas yang
    // terpusat di x=50%, jadi angka ini cocok untuk semuanya - tapi tetap
    // per-template supaya tiap template bisa disetel sendiri nanti.
    defaultMessage: {
      posX: 50,
      posY: 53,
      rotate: 0,
    },
  },
  {
    id: 'template2',
    name: 'Template 2',
    badge: 'Template 2',
    tag: 'White Minimalist',
    description: 'Kertas putih bersih, modern & rapi',
    src: `/template/template 2.png?v=${CACHE_KEY}`,
    fallbackSrc: `/template/template-2.png?v=${CACHE_KEY}`,
    thumbnail: `/template/template 2.png?v=${CACHE_KEY}`,
    defaultRatio: '4:5',
    themeColor: '#475569', // slate
    accentColor: '#94a3b8',
    textColor: '#0f172a',
    fontFamily: "'Helvetica Neue', Helvetica, Arial, 'DM Sans', sans-serif",
    fontWeight: '600',
    defaultFontSize: 36,
    defaultFontSizeName: 26, // Ukuran pas 26px agar cap height persis 19px sama seperti 'DIKIRIIM OLEH'
    uppercaseSender: true, // Huruf kapital selaras dengan 'DIKIRIIM OLEH'
    lineHeightMultiplier: 1.5,
    maxLines: 12,
    bounds: {
      '4:5': { x: 0.22, y: 0.24, w: 0.56, h: 0.56, padX: 0.04, padY: 0.04 },
      '1:1': { x: 0.22, y: 0.20, w: 0.56, h: 0.58, padX: 0.04, padY: 0.04 },
    },
    defaultSender: {
      posX: 38.8,
      posY: 84.6,
      rotate: 0,
      color: '#0f172a',
      fontFamily: "'Helvetica Neue', Helvetica, Arial, 'DM Sans', sans-serif",
      fontWeight: '700',
      prefix: '',
      hasBakedAnon: false,
    },
    defaultMessage: {
      posX: 50,
      posY: 53,
      rotate: 0,
    },
  },
  {
    id: 'template3',
    name: 'Template 3',
    badge: 'Template 3',
    tag: 'Pink Scrapbook',
    description: 'Kertas scrapbook pink, tulisan tangan & lubang ring',
    // Hanya ada satu file untuk template ini - 'template-3.png', tanpa twin
    // bergaya spasi seperti template 1 & 2. fallbackSrc sengaja null: kalau
    // diisi URL yang sama dengan src, img.onerror di ExportModal akan
    // menunjuk-src ulang ke URL itu sendiri dan loop tanpa henti.
    src: `/template/template-3.png?v=${CACHE_KEY}`,
    fallbackSrc: null,
    thumbnail: `/template/template-3.png?v=${CACHE_KEY}`,
    defaultRatio: '4:5',
    // Sama seperti template 1 & 2, themeColor/accentColor belum dipakai UI -
    // diisi biar tiap template punya palet seragam.
    themeColor: '#e98fb4', // pink
    accentColor: '#89c1e6', // hati biru
    textColor: '#2f2822', // core tulisan baked di kertas ini hitam pekat
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: '600',
    defaultFontSize: 34,
    // Slider ukuran nama mentok di 44px, jadi 40 = batas atas yang masih muat
    // di kanan label tanpa keluar kertas. Label 'Dikirim oleh:' sendiri punya
    // tinggi huruf ~67px canvas (tulisan brush), jadi ukurannya memang tidak
    // bisa dicocokkan seperti di template 2 - 40px dipakai supaya nama terbaca
    // sebagai kelanjutan label, bukan saingannya.
    defaultFontSizeName: 40,
    lineHeightMultiplier: 1.5,
    maxLines: 10,
    bounds: {
      // x dibatasi 0.27 karena lubang ring di tepi kiri kertas tembus sampai
      // x=0.258. Rentang y 0.22..0.74 mengikuti zona aman kertas di antara
      // tulisan @HARKATNEKATT dan hati biru.
      '4:5': { x: 0.27, y: 0.22, w: 0.52, h: 0.52, padX: 0.04, padY: 0.04 },
      // 1:1 memotong lebih banyak tinggi gambar, jadi zona aman naik ke y=0.12
      // dan lebarnya mengikuti rasio 1080/1111.
      '1:1': { x: 0.28, y: 0.12, w: 0.53, h: 0.52, padX: 0.04, padY: 0.04 },
    },
    defaultSender: {
      // BEDA dengan msgX/msgY: posX/posY di sini adalah tepi kiri + baseline
      // teks, dan rotasi ikut berputar di anchor itu juga (translate lalu
      // fillText(name, 0, 0)), bukan di pusat teks. Karena itu rotasi -9deg
      // menaikkan ujung kanan nama sekitar 30px dari ujung kiri - efek
      // tulisan tangan yang disengaja untuk gaya scrapbook.
      // Label 'Dikirim oleh:' di gambar berakhir di x=0.527 dengan baseline
      // y=0.82; posY 79.5 membiarkan nama sedikit di atas baseline label.
      posX: 54,
      posY: 79.5,
      rotate: -9,
      color: '#2f2822',
      fontFamily: "'DM Sans', sans-serif",
      fontWeight: '700',
      prefix: '',
      hasBakedAnon: false,
      // Auto-shrink (lihat drawMenfessCanvas). Penting di template ini:
      // anchor nama di x=54% dan tepi aman kartu di 79% menyisakan hanya
      // 270px, jadi nama 40px mentok di ~15 karakter. Di bawah 0.6 (24px)
      // nama jadi terlalu kecil untuk dibaca dan paragraf pesan (34px)
      // terlihat lebih besar daripada namanya - jadi lantai di sini, sisanya
      // tetap meluber dan itu memang batas template ini.
      minFontScale: 0.6,
    },
    defaultMessage: {
      // msgX/posY diukur dari TITIK TENGAH blok teks (lihat hint di
      // ExportModal), jadi rotasi -4deg hanya memiringkan tiap baris tanpa
      // menggeser pusat blok dari zona aman.
      posX: 53, // titik tengah zona aman x 0.27..0.79
      posY: 48, // titik tengah zona aman y 0.22..0.74
      rotate: -4,
    },
  },
];

export function getTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}

export function parseTemplateFromMenfes(menfes) {
  if (!menfes) return TEMPLATES[0].id;

  const info = (menfes.senderInfo || '').toLowerCase();
  if (info.includes('template 1') || info.includes('template1') || info.includes('blue sky')) {
    return 'template1';
  }
  if (info.includes('template 2') || info.includes('template2') || info.includes('white')) {
    return 'template2';
  }
  if (info.includes('template 3') || info.includes('template3') || info.includes('scrapbook')) {
    return 'template3';
  }
  // Menfes lama yang senderInfo-nya 'Classic Dark' jatuh ke sini dan
  // sengaja dipetakan ke template pertama, bukan diabaikan.

  return TEMPLATES[0].id;
}
