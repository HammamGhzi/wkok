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
  // PNG sudah berisi handle @harkatfess kecil di tepi ATAS panel krem;
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
    // Zona 743..954px (211px): 5 baris x 42px = 210px masih muat.
    defaultFontSize: 28,
    lineHeightMultiplier: 1.5,
    maxLines: 5,
    bounds: {
      // Panel krem screenshot baru: x 413..911, y 685..970. Handle baked
      // (bold 26px, bbox y 707..738) berakhir ~y=738, jadi zona mulai y=743.
      '4:5': { x: 0.382, y: 0.55, w: 0.462, h: 0.156, padX: 0.04, padY: 0.04 },
      // 1:1: crop aspect-fill (sy=135px), y dikurangi 135 lalu / 1080.
      '1:1': { x: 0.382, y: 0.563, w: 0.462, h: 0.194, padX: 0.04, padY: 0.04 },
    },
    defaultMessage: {
      posX: 61.3, // pusat panel x=662 (sama dengan handle baked)
      posY: 62.8, // pusat zona y 743..954
      '1:1': { posY: 66.0 }, // crop sy=135: pusat zona y 608..819
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
    // Zona 308..632px (324px): 6 baris x 54px = 324px pas muat.
    defaultFontSize: 36,
    lineHeightMultiplier: 1.5,
    maxLines: 6,
    bounds: {
      // Papan krem screenshot baru: x 51..884, y 244..689. Handle baked
      // (bold 36px, bbox y 257..296) berakhir ~y=296, jadi zona mulai y=308.
      // Papan gak center di x=50% (51..884) -> posX ikut 43.3%.
      '4:5': { x: 0.047, y: 0.228, w: 0.772, h: 0.24, padX: 0.04, padY: 0.04 },
      // 1:1: crop aspect-fill (sy=135px), y dikurangi 135 lalu / 1080.
      '1:1': { x: 0.047, y: 0.16, w: 0.772, h: 0.3, padX: 0.04, padY: 0.04 },
    },
    defaultMessage: {
      posX: 43.3, // pusat panel x=467.5 (sama dengan handle baked)
      posY: 34.8, // pusat zona y 308..632
      '1:1': { posY: 31.0 }, // crop sy=135: pusat zona y 173..497
      rotate: 0,
    },
  },
];

export function getDefaultMessage(template, ratio) {
  const base = template.defaultMessage;
  const override = base[ratio || template.defaultRatio];
  return override ? { ...base, ...override } : base;
}

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
