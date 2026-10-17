import { chunkLines } from './splitLines';

export const CANVAS_SIZE = {
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
};

// `maxLines` opsional: default Infinity = semua baris diambil tanpa dipotong.
// Semua pemanggil lama selalu mengirim nilai eksplisit (`maxLines ||
// template.maxLines || 10`), jadi perilaku lama tidak berubah — mode tanpa
// batas ini dipakai fitur multicard untuk menghitung kartu.
export function wrapText(ctx, text, maxWidth, maxLines = Infinity) {
  if (!text) return [];
  const paragraphs = text.split('\n');
  const allLines = [];

  for (const para of paragraphs) {
    const words = para.split(' ');
    let current = '';

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        allLines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) allLines.push(current);
  }

  return allLines.slice(0, maxLines);
}

/**
 * Hitung jumlah kartu untuk sebuah pesan (fitur multicard).
 *
 * Langkah measure-nya SAMA PERSIS dengan drawMessage(): font diset dulu
 * sebelum wrapText (wrapText pakai measureText), `maxTextW` dihitung dari
 * bounds kertas yang sama. Kalau meleset, jumlah baris bisa beda dan kartu
 * terakhir jadi kepanjangan.
 *
 * Pemilihan chunk mana yang dirender BUKAN urusan fungsi ini — pemanggil
 * (TemplatePreview/ExportModal) memilih `chunks[partIndex]` lalu
 * mengirimkannya sebagai `partLines` ke renderMenfessToCanvas.
 *
 * `ctx` hanya dipakai sementara (save/restore) — state canvas tidak berubah.
 */
export function hitungKartu(ctx, template, ratio, message) {
  const actualRatio = ratio || template.defaultRatio || '1:1';
  const { w } = CANVAS_SIZE[actualRatio] || CANVAS_SIZE['1:1'];
  const bounds = template.bounds[actualRatio] || template.bounds['1:1'];

  const fontSize = template.defaultFontSize || 36;
  const paperW = w * bounds.w;
  const padX = paperW * (bounds.padX || 0.06);
  const maxTextW = paperW - padX * 2;

  ctx.save();
  ctx.font = `${template.fontWeight || '600'} ${fontSize}px ${template.fontFamily}`;
  const allLines = wrapText(ctx, message, maxTextW);
  ctx.restore();

  const chunks = chunkLines(allLines, template.maxLines || 10);
  return { totalParts: chunks.length, chunks };
}

/**
 * Gambar pesan menfes, dipatok ke TITIK TENGAH blok teks.
 *
 * Kenapa titik tengah dan bukan tepi kiri-atas seperti implementasi lama:
 *   - blok multi-baris tidak bergeser sendiri saat isi atau ukuran berubah
 *   - slider rotasi memutar teks di sekitar pusatnya, bukan pojok
 *
 * `bounds` hanya dipakai untuk menentukan lebar area wrap. Posisi absolut
 * datang dari msgX/msgY, jadi fungsi ini tidak perlu tahu di mana kertasnya.
 * Dipakai oleh renderMenfessToCanvas() dan drawFallback() supaya kedua jalur
 * tidak punya salinan logika yang bisa melenceng.
 *
 * `textColor` / `fontFamily` / `maxLines` bisa dioverride karena jalur
 * fallback sengaja memakai nilai yang berbeda dari template aslinya.
 *
 * `partLines` (opsional): baris yang sudah di-wrap sebelumnya. Diisi = gambar
 * baris ini mentah tanpa wrap ulang pesan (dipakai fitur multicard).
 * `null` = perilaku lama, selalu wrap dari `text`.
 */
function drawMessage(ctx, w, h, {
  template,
  bounds,
  text,
  fontSize,
  msgX,
  msgY,
  msgRotate,
  textColor,
  fontFamily,
  maxLines,
  partLines = null,
}) {
  const paperW = w * bounds.w;
  const padX = paperW * (bounds.padX || 0.06);
  const maxTextW = paperW - padX * 2;

  ctx.save();
  ctx.font = `${template.fontWeight || '600'} ${fontSize}px ${fontFamily || template.fontFamily}`;
  ctx.fillStyle = textColor || template.textColor || '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  if (template.textShadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
  }

  // Font harus sudah diset sebelum wrapText (wrapText pakai measureText).
  // partLines non-null = baris hasil wrap fitur multicard, digambar mentah.
  const lines = partLines !== null
    ? partLines
    : wrapText(ctx, text, maxTextW, maxLines || template.maxLines || 10);
  const lineHeight = fontSize * (template.lineHeightMultiplier || 1.55);
  const totalTextH = lines.length * lineHeight;

  ctx.translate(w * (msgX / 100), h * (msgY / 100));
  ctx.rotate((msgRotate * Math.PI) / 180);

  const startX = -maxTextW / 2;
  const startY = -totalTextH / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, startX, startY + i * lineHeight);
  });
  ctx.restore();
}

/**
 * Render template menfess ke HTML5 canvas dengan background gambar asli
 */
export function renderMenfessToCanvas(canvas, {
  template,
  ratio = null,
  message = '',
  fontSize = null,
  msgX = null,
  msgY = null,
  msgRotate = null,
  onStatusChange = null,
  partLines = null, // string[] | null: baris siap gambar (multicard), null = wrap pesan
  partIndex = 0, // int: nomor kartu ini (0-based), hanya untuk badge "n/N"
  totalParts = 1, // int: jumlah kartu, 1 = tanpa badge (perilaku lama persis)
}) {
  if (!canvas || !template) return;

  // Clamp parameter multicard: totalParts minimal 1, partIndex di
  // [0, totalParts-1]. Default netral (0/1) → tanpa badge → perilaku lama.
  const safeTotalParts = Number.isFinite(totalParts) && totalParts >= 1
    ? Math.floor(totalParts)
    : 1;
  const safePartIndex = Number.isFinite(partIndex)
    ? Math.min(Math.max(0, Math.floor(partIndex)), safeTotalParts - 1)
    : 0;

  const actualRatio = ratio || template.defaultRatio || '1:1';
  const { w, h } = CANVAS_SIZE[actualRatio] || CANVAS_SIZE['1:1'];
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  const actualFontSize = fontSize || template.defaultFontSize || 36;
  const actualMsgX = msgX !== null && msgX !== undefined ? msgX : template.defaultMessage.posX;
  const actualMsgY = msgY !== null && msgY !== undefined ? msgY : template.defaultMessage.posY;
  const actualMsgRotate = msgRotate !== null && msgRotate !== undefined ? msgRotate : template.defaultMessage.rotate;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = template.src;

  img.onload = async () => {
    if (onStatusChange) onStatusChange('ok');

    // Pastikan Google Fonts (Poppins, Plus Jakarta Sans, dll) sudah selesai termuat di browser
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // fallback jika browser tidak support font loading API
      }
    }

    // 1. Gambar background gambar asli dengan aspect-fill crop
    const imgAspect = img.width / img.height;
    const canvasAspect = w / h;
    let sx, sy, sw, sh;
    if (imgAspect > canvasAspect) {
      sh = img.height;
      sw = img.height * canvasAspect;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = img.width / canvasAspect;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

    // 2. Area teks pesan
    const bounds = template.bounds[actualRatio] || template.bounds['1:1'];

    const displayMsg = message && message.trim()
      ? message.trim()
      : 'Tulis pesan menfess kamu di sini...';

    // 3. Tulis Pesan
    drawMessage(ctx, w, h, {
      template,
      bounds,
      text: displayMsg,
      fontSize: actualFontSize,
      msgX: actualMsgX,
      msgY: actualMsgY,
      msgRotate: actualMsgRotate,
      partLines,
    });

    // Badge nomor kartu (multicard); no-op kalau totalParts <= 1.
    drawPartBadge(ctx, w, h, template, safePartIndex, safeTotalParts);
  };

  img.onerror = () => {
    if (template.fallbackSrc && img.src !== template.fallbackSrc) {
      img.src = template.fallbackSrc;
      return;
    }
    if (onStatusChange) onStatusChange('error');
    drawFallback(ctx, w, h, template, {
      message,
      fontSize: actualFontSize,
      msgX: actualMsgX,
      msgY: actualMsgY,
      msgRotate: actualMsgRotate,
      partLines,
    });
    // Badge tetap digambar di jalur fallback supaya kartu multicard
    // konsisten walau background gagal dimuat.
    drawPartBadge(ctx, w, h, template, safePartIndex, safeTotalParts);
  };
}

/**
 * Badge nomor kartu "n/N" di pojok kanan-atas (fitur multicard).
 * Hanya digambar bila totalParts > 1; kartu tunggal = tanpa badge,
 * jadi perilaku lama (TemplatePreview/ExportModal) persis tidak berubah.
 * Selalu dibungkus save/restore supaya state canvas tidak bocor.
 */
function drawPartBadge(ctx, w, h, template, partIndex, totalParts) {
  if (totalParts <= 1) return;

  ctx.save();
  ctx.font = `bold ${w * 0.028}px ${template.fontFamily}`;
  ctx.fillStyle = template.textColor || '#1a1a1a';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';

  if (template.textShadow) {
    // Ikuti pola shadow di drawMessage: ringan, cuma biar kontras.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
  }

  ctx.fillText(`${partIndex + 1}/${totalParts}`, w * 0.94, h * 0.06);
  ctx.restore();
}

// Area kertas untuk jalur fallback. Sengaja bukan bounds template: kalau
// background gagal dimuat, kita tetap menggambar kertas dengan proporsi
// yang selalu terlihat, bukan proporsi template yang mungkin tidak cocok.
const FALLBACK_BOUNDS = { x: 0.085, y: 0.24, w: 0.83, h: 0.54, padX: 0.08 };

function drawFallback(ctx, w, h, template, opts = {}) {
  const {
    message = '',
    fontSize = 36,
    msgX = 50,
    msgY = 53,
    msgRotate = 0,
    partLines = null,
  } = opts;

  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${w * 0.05}px 'Courier New', Courier, monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('MENFESS HARKAT NEKATT', w / 2, h * 0.12);

  ctx.font = `${w * 0.025}px 'Courier New', Courier, monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(template.name.toUpperCase(), w / 2, h * 0.16);

  const paperX = w * FALLBACK_BOUNDS.x;
  const paperY = h * FALLBACK_BOUNDS.y;
  const paperW = w * FALLBACK_BOUNDS.w;
  const paperH = h * FALLBACK_BOUNDS.h;

  // Kertas fallback netral; teks maroon kontras (template lite semua krem).
  ctx.fillStyle = '#f0ebe3';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(paperX, paperY, paperW, paperH, 12);
  } else {
    ctx.rect(paperX, paperY, paperW, paperH);
  }
  ctx.fill();

  drawMessage(ctx, w, h, {
    template,
    bounds: FALLBACK_BOUNDS,
    text: message || 'Tulis pesan menfess kamu...',
    fontSize,
    msgX,
    msgY,
    msgRotate,
    textColor: '#7a1f2b',
    maxLines: 8,
    partLines,
  });
}
