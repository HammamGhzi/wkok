import { TEMPLATES } from '../config/templates';

export const CANVAS_SIZE = {
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
};

export function wrapText(ctx, text, maxWidth, maxLines = 10) {
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

  // Font harus sudah diset sebelum wrapText (wrapText pakai measureText)
  const lines = wrapText(ctx, text, maxTextW, maxLines || template.maxLines || 10);
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
  senderName = '',
  isAnon = true,
  fontSize = null,
  fontSizeName = null,
  posX = null,
  posY = null,
  rotate = null,
  msgX = null,
  msgY = null,
  msgRotate = null,
  onStatusChange = null,
}) {
  if (!canvas || !template) return;

  const actualRatio = ratio || template.defaultRatio || '1:1';
  const { w, h } = CANVAS_SIZE[actualRatio] || CANVAS_SIZE['1:1'];
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  const actualFontSize = fontSize || template.defaultFontSize || 36;
  const actualFontSizeName = fontSizeName || template.defaultFontSizeName || 28;
  const actualPosX = posX !== null && posX !== undefined ? posX : template.defaultSender.posX;
  const actualPosY = posY !== null && posY !== undefined ? posY : template.defaultSender.posY;
  const actualRotate = rotate !== null && rotate !== undefined ? rotate : template.defaultSender.rotate;
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
    });

    // 4. Nama Pengirim
    const hasCustomName = !isAnon && Boolean(senderName && senderName.trim());
    const rawName = hasCustomName ? senderName.trim() : 'Seseorang';
    const displayName = template.uppercaseSender ? rawName.toUpperCase() : rawName;
    const senderCfg = template.defaultSender;

    // Jika template memiliki teks anon bawaan dan ada nama kustom, tutupi dengan background yang cocok
    if (hasCustomName && template.hasBakedAnon && template.bakedCover) {
      ctx.save();
      const cov = template.bakedCover;
      ctx.fillStyle = cov.fill;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(w * cov.x, h * cov.y, w * cov.w, h * cov.h, 6);
        ctx.fill();
      } else {
        ctx.fillRect(w * cov.x, h * cov.y, w * cov.w, h * cov.h);
      }
      ctx.restore();
    }

    // Gambar nama jika bukan teks anon bawaan atau ada nama custom
    if (hasCustomName || !template.hasBakedAnon) {
      ctx.save();
      const tx = w * (actualPosX / 100);
      const ty = h * (actualPosY / 100);
      ctx.translate(tx, ty);
      ctx.rotate((actualRotate * Math.PI) / 180);

      // Auto-shrink nama. Anchor sender adalah TEPI KIRI (lihat fillText
      // di bawah), jadi nama melebar ke kanan; batas kanannya diambil dari
      // tepi aman kartu yang sama dengan blok pesan (bounds.x + bounds.w).
      // Yang dibandingkan adalah extent VISUAL setelah rotasi, bukan lebar
      // teks mentah: teks miring memakai lebar lebih besar di layar sehingga
      // nama yang "muat" secara aritmetika bisa tetap melewati tepi kartu.
      //
      // senderCfg.minFontScale (bukan `minFontScale`) punya lantai agar nama
      // tidak menyusut jadi tidak terbaca untuk nama yang luar biasa panjang.
      // Di atas lantai itu nama tetap meluber - tidak ada ukuran yang bisa
      // memuatnya dengan rapi, jadi lebih baik terlalu besar daripada
      // setipis benang.
      const nameFontFamily = senderCfg.fontFamily || template.fontFamily;
      const nameFontWeight = senderCfg.fontWeight || 'bold';
      const prefix = hasCustomName ? (senderCfg.prefix || '') : '';
      const nameText = `${prefix}${displayName}`;

      const nameRightEdge = bounds.x + bounds.w;
      const nameAvailPx = Math.max(0, (nameRightEdge - actualPosX / 100) * w);
      const nameRad = (actualRotate * Math.PI) / 180;
      const nameCos = Math.abs(Math.cos(nameRad));
      const nameSin = Math.abs(Math.sin(nameRad));

      let nameFontSize = actualFontSizeName;
      ctx.font = `${nameFontWeight} ${nameFontSize}px ${nameFontFamily}`;
      if (nameAvailPx > 0 && nameCos > 0) {
        // Cap height ~0.72 * fontSize: komponen teks yang tegak, yang ikut
        // menambah lebar horizontal begitu teks dimiringkan.
        const capH = nameFontSize * 0.72;
        const visualW = ctx.measureText(nameText).width * nameCos + capH * nameSin;
        if (visualW > nameAvailPx) {
          const floor = senderCfg.minFontScale ?? 0.6;
          nameFontSize = Math.max(
            actualFontSizeName * floor,
            (actualFontSizeName * nameAvailPx) / visualW,
          );
          ctx.font = `${nameFontWeight} ${nameFontSize}px ${nameFontFamily}`;
        }
      }

      ctx.fillStyle = senderCfg.color || '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      if (template.textShadow) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 1;
      }

      ctx.fillText(nameText, 0, 0);
      ctx.restore();
    }
  };

  img.onerror = () => {
    if (template.fallbackSrc && img.src !== template.fallbackSrc) {
      img.src = template.fallbackSrc;
      return;
    }
    if (onStatusChange) onStatusChange('error');
    drawFallback(ctx, w, h, template, {
      message,
      senderName,
      isAnon,
      fontSize: actualFontSize,
      fontSizeName: actualFontSizeName,
      msgX: actualMsgX,
      msgY: actualMsgY,
      msgRotate: actualMsgRotate,
    });
  };
}

// Area kertas untuk jalur fallback. Sengaja bukan bounds template: kalau
// background gagal dimuat, kita tetap menggambar kertas dengan proporsi
// yang selalu terlihat, bukan proporsi template yang mungkin tidak cocok.
const FALLBACK_BOUNDS = { x: 0.085, y: 0.24, w: 0.83, h: 0.54, padX: 0.08 };

function drawFallback(ctx, w, h, template, opts = {}) {
  const {
    message = '',
    senderName = '',
    isAnon = true,
    fontSize = 36,
    fontSizeName = 28,
    msgX = 50,
    msgY = 53,
    msgRotate = 0,
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

  ctx.fillStyle = template.id === 'template1' ? '#1e3a8a' : '#f0ebe3';
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
    textColor: template.id === 'template1' ? '#ffffff' : '#1a1a1a',
    maxLines: 8,
  });

  const displayName = !isAnon && senderName?.trim() ? senderName.trim() : 'Seseorang';
  ctx.font = `bold ${fontSizeName}px ${template.fontFamily}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'right';
  ctx.fillText(displayName, w * 0.89, h * 0.89);
}
