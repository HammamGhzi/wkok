/**
 * Konfigurasi Template Menfess Harkat Nekatt
 * Template 1 (Blue Sky), 2 (White Minimalist), 3 (Pink Scrapbook) sudah
 * DIBUANG; tersisa tiga template lite: 4 (fess), 5 (tuyul), 6 (kelas).
 *
 * CATATAN: entri pertama di TEMPLATES adalah default seluruh app - dipakai
 * getTemplateById() saat id tidak dikenal dan parseTemplateFromMenfes() saat
 * senderInfo tidak cocok. Menghapus atau mengurutkan ulang entri ini akan
 * diam-diam mengganti template default.
 *
 * CATATAN: fitur pengirim sudah dihapus total - tidak ada lagi field
 * defaultSender/defaultFontSizeName/uppercaseSender di entri manapun.
 */

// Cache busting parameter agar browser selalu memuat file gambar terbaru saat diganti
const CACHE_KEY = Date.now();

export const TEMPLATES = [
  // ── Template lite (4:5, 1080x1350) ──────────────────────────────────────
  // PNG sudah berisi handle @harkatnekatt kecil di tepi ATAS panel krem;
  // panel bawah kosong = zona teks pesan. bounds['4:5'] adalah panel krem
  // MINUS pad (zona mulai DI BAWAH handle baked, jadi handle gak ketimpa).
  {
    id: 'template4',
    name: 'Template 4',
    badge: 'Template 4',
    tag: 'Fess Lite',
    description: 'Laptop di meja kayu, layar krem untuk pesan',
    src: `/template/fess-lite.png?v=${CACHE_KEY}`,
    fallbackSrc: null, // satu file saja - lihat catatan template3
    thumbnail: `/template/fess-lite.png?v=${CACHE_KEY}`,
    defaultRatio: '4:5',
    themeColor: '#7a1f2b', // maroon dinding
    accentColor: '#e9b04a', // amber cahaya jendela
    textColor: '#7a1f2b', // maroon kontras di krem #F6EFDD (sejajar handle baked)
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: '600',
    // Zona 442..854px (412px): 7 baris x 54px = 378px masih muat.
    defaultFontSize: 36,
    lineHeightMultiplier: 1.5,
    maxLines: 7,
    bounds: {
      // Layar laptop: x 194.2..885.8, y 375.6..871.9 (dari fess.js: lidW 760,
      // deskY 980). Handle baked (bold 30px, baseline y=419.6) berakhir
      // ~y=426, jadi padY atas = 442-375.6 = 66px. Sisanya pad 18-26px.
      '4:5': { x: 0.204, y: 0.327, w: 0.592, h: 0.305, padX: 0.03, padY: 0.03 },
      // 1:1: crop aspect-fill (sy=135px), y dikurangi 135 lalu / 1080.
      '1:1': { x: 0.204, y: 0.284, w: 0.592, h: 0.381, padX: 0.03, padY: 0.03 },
    },
    defaultMessage: {
      posX: 50, // pusat zona x 220.2..859.8
      posY: 48, // pusat zona y 442..854
      rotate: 0,
    },
  },
  {
    id: 'template5',
    name: 'Template 5',
    badge: 'Template 5',
    tag: 'Tuyul Lite',
    description: 'Bus Elf di jalan senja, jendela krem untuk pesan',
    src: `/template/tuyul-lite.png?v=${CACHE_KEY}`,
    fallbackSrc: null,
    thumbnail: `/template/tuyul-lite.png?v=${CACHE_KEY}`,
    defaultRatio: '4:5',
    themeColor: '#7a1f2b', // maroon senja
    accentColor: '#e9b04a', // amber lampu gedung
    textColor: '#7a1f2b',
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: '600',
    // Zona 770..987px (217px): 5 baris x 42px = 210px masih muat.
    defaultFontSize: 28,
    lineHeightMultiplier: 1.5,
    maxLines: 5,
    bounds: {
      // textWindow(BUS) di drawTuyul.js: x 410..908.15, y 713.3..1001
      // (BUS {x:40,y:640,w:1000,h:560}). Handle baked (bold 26px, baseline
      // y=753.7) berakhir ~y=759, jadi zona mulai y=770.
      '4:5': { x: 0.394, y: 0.57, w: 0.432, h: 0.161, padX: 0.04, padY: 0.04 },
      // 1:1: crop aspect-fill (sy=135px), y dikurangi 135 lalu / 1080.
      '1:1': { x: 0.394, y: 0.588, w: 0.432, h: 0.201, padX: 0.04, padY: 0.04 },
    },
    defaultMessage: {
      posX: 61, // pusat zona x 426..892
      posY: 65.1, // pusat zona y 770..987
      rotate: 0,
    },
  },
  {
    id: 'template6',
    name: 'Template 6',
    badge: 'Template 6',
    tag: 'Kelas Lite',
    description: 'Papan tulis kelas, permukaan krem untuk pesan',
    src: `/template/kelas-lite.png?v=${CACHE_KEY}`,
    fallbackSrc: null,
    thumbnail: `/template/kelas-lite.png?v=${CACHE_KEY}`,
    defaultRatio: '4:5',
    themeColor: '#7a1f2b', // maroon dinding kelas
    accentColor: '#e9b04a', // amber pin kertas
    textColor: '#7a1f2b',
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: '600',
    // Zona 385..730px (345px): 6 baris x 54px = 324px masih muat.
    defaultFontSize: 36,
    lineHeightMultiplier: 1.5,
    maxLines: 6,
    bounds: {
      // Permukaan papan (BOARD {x:110,y:300,w:750,h:470, frame:20} di
      // kelas.js): x 130..840, y 320..750. Handle baked (bold 36px,
      // baseline y=360) berakhir ~y=368, jadi zona mulai y=385.
      // Papan gak center di x=50% (110..860) -> posX ikut 44.9%.
      '4:5': { x: 0.143, y: 0.285, w: 0.613, h: 0.256, padX: 0.04, padY: 0.04 },
      // 1:1: crop aspect-fill (sy=135px), y dikurangi 135 lalu / 1080.
      '1:1': { x: 0.143, y: 0.231, w: 0.613, h: 0.319, padX: 0.04, padY: 0.04 },
    },
    defaultMessage: {
      posX: 44.9, // pusat zona x 154..816
      posY: 41.3, // pusat zona y 385..730
      rotate: 0,
    },
  },
];

export function getTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}

/**
 * Pilih template dari data menfes lewat senderInfo (yang diisi HomePage
 * dengan nama template saat submit). Flow ini MASIH HIDUP: ExportModal dan
 * AdminDashboardPage memakai hasilnya, jadi fungsi ini dipertahankan apa
 * adanya - hanya keyword template baru yang ditambahkan.
 */
export function parseTemplateFromMenfes(menfes) {
  if (!menfes) return TEMPLATES[0].id;

  const info = (menfes.senderInfo || '').toLowerCase();
  // Menfes lama berisi nama template 1/2/3 (sudah dibuang) sengaja jatuh ke
  // TEMPLATES[0], bukan diabaikan.
  if (info.includes('template 4') || info.includes('template4') || info.includes('fess')) {
    return 'template4';
  }
  if (info.includes('template 5') || info.includes('template5') || info.includes('tuyul')) {
    return 'template5';
  }
  if (info.includes('template 6') || info.includes('template6') || info.includes('kelas')) {
    return 'template6';
  }
  // Menfes lama yang senderInfo-nya tidak dikenal ('Classic Dark', nama
  // template lama) jatuh ke sini dan dipetakan ke template pertama.

  return TEMPLATES[0].id;
}
