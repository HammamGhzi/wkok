import { useRef, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { TEMPLATES, getTemplateById, parseTemplateFromMenfes } from '../config/templates';
import { renderMenfessToCanvas, CANVAS_SIZE } from '../utils/drawMenfessCanvas';
import { adminAPI, urlAset } from '../api';

// Batas caption mengikut Instagram. Menyalin angka dari backend lebih baik
// daripada menebak: kalau backend yang menolak, admin sudah terlanjur mengetik
// 300 karakter sebelum tahu jawabannya.
const BATAS_CAPTION = 2200;

export default function ExportModal({ menfes, onClose, onPosted }) {
  const canvasRef = useRef(null);
  const controlsRef = useRef(null);
  const bodyRef = useRef(null);

  // Deteksi template awal dari data menfess
  const initialTemplateId = parseTemplateFromMenfes(menfes);
  const initialTemplate = getTemplateById(initialTemplateId);

  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId);
  const currentTemplate = getTemplateById(selectedTemplateId);

  // Rasio IKUT TEMPLATE, bukan pilihan user. Semua template memakai 4:5 dan
  // zona aman, posisi pesan, serta posisi sender di gambar sudah diukur untuk
  // rasio itu. Tombol rasio sebelumnya membiarkan 1:1 dipilih, dan di 1:1
  // cover-crop memotong tinggi gambar sehingga posisi label yang dibaked
  // bergeser ke bawah - nama lalu melayang jauh di atas labelnya. Menghapus
  // pilihan itu lebih jujur daripada menambal per-rasio di tiga template.
  const ratio = currentTemplate.defaultRatio || '4:5';
  const [fontSize, setFontSize] = useState(currentTemplate.defaultFontSize || 36);
  const [fontSizeName, setFontSizeName] = useState(currentTemplate.defaultFontSizeName || 28);
  const [downloading, setDownloading] = useState(false);
  // Unduh foto pengirim + penanda file hilang. Disk server ephemeral (Render),
  // jadi foto bisa raib setelah redeploy — section-nya harus jujur bilang
  // begitu, bukan error diam-diam.
  const [fotoDownloading, setFotoDownloading] = useState(false);
  const [fotoHilang, setFotoHilang] = useState(false);
  // Caption diisi dari igCaption supaya menfes yang gagal tayang dan mau dicoba
  // lagi tidak mengharuskan admin mengetik ulang teksnya.
  const [caption, setCaption] = useState(menfes?.igCaption || '');
  // Teks pesan yang dibakar ke gambar. Dipisah dari menfes.message supaya
  // admin boleh merapikan teks untuk export tanpa menimpa menfess asli di
  // database — edit ini hidup selama modal terbuka, tutup modal = hilang.
  const [pesan, setPesan] = useState(menfes?.message || '');
  const [posting, setPosting] = useState(false);
  const [bgStatus, setBgStatus] = useState('loading');
  const [posX, setPosX] = useState(currentTemplate.defaultSender.posX);
  const [posY, setPosY] = useState(currentTemplate.defaultSender.posY);
  const [rotate, setRotate] = useState(currentTemplate.defaultSender.rotate);

  // Posisi teks menfes — dipatok ke titik tengah blok, bukan kiri-atas,
  // supaya blok multi-baris tetap stabil dan rotasi berputar di sekitar pusat.
  const [msgX, setMsgX] = useState(currentTemplate.defaultMessage.posX);
  const [msgY, setMsgY] = useState(currentTemplate.defaultMessage.posY);
  const [msgRotate, setMsgRotate] = useState(currentTemplate.defaultMessage.rotate);

  // True setelah kolom controls di-scroll: preview HP mengecil jadi strip
  // supaya area slider tetap lega. Di desktop preview punya kolom sendiri
  // sehingga nilai ini tidak dipakai.
  const [compact, setCompact] = useState(false);

  // Ukuran area body modal (px), dibaca lewat ResizeObserver. Preview
  // dihitung dari sisa ruang di dalam body ini — bukan angka tetap — supaya
  // ikut sebesar mungkin tanpa menabrak kolom controls.
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Desktop mengikuti breakpoint `sm` (640px) lewat listener, bukan
  // window.innerWidth yang dibaca sekali saat render: kalau jendela di-resize
  // selagi modal terbuka, JS dan CSS harus sepakat breakpoint mana yang aktif.
  const [isDesktop, setIsDesktop] = useState(false);

  // Padding kolom preview (p-3) dan ruang minimum yang selalu disimpan untuk
  // controls: lebar di desktop (controls di samping), tinggi di mobile
  // (controls di bawah).
  const PREVIEW_PAD = 24;
  const MIN_CTRL_W = 360;
  const MIN_CTRL_H = 200;
  // Tinggi strip preview ketika mobile dalam mode compact.
  const COMPACT_H = 140;

  // Escape = tutup modal. Pelengkap tombol X: di desktop admin sering
  // langsung tekan Escape, dan kalau tombol X sempat tersembunyi di layar
  // yang sempit, selalu ada jalan keluar lain.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Switch template dan terapkan preset default template tersebut
  function handleSelectTemplate(tmplId) {
    const tmpl = getTemplateById(tmplId);
    setSelectedTemplateId(tmplId);
    setFontSize(tmpl.defaultFontSize);
    setFontSizeName(tmpl.defaultFontSizeName);
    setPosX(tmpl.defaultSender.posX);
    setPosY(tmpl.defaultSender.posY);
    setRotate(tmpl.defaultSender.rotate);
    setMsgX(tmpl.defaultMessage.posX);
    setMsgY(tmpl.defaultMessage.posY);
    setMsgRotate(tmpl.defaultMessage.rotate);
  }

  // Reset koordinat slider ke default template saat ini
  function handleResetPositions() {
    setPosX(currentTemplate.defaultSender.posX);
    setPosY(currentTemplate.defaultSender.posY);
    setRotate(currentTemplate.defaultSender.rotate);
    setFontSize(currentTemplate.defaultFontSize);
    setFontSizeName(currentTemplate.defaultFontSizeName);
    setMsgX(currentTemplate.defaultMessage.posX);
    setMsgY(currentTemplate.defaultMessage.posY);
    setMsgRotate(currentTemplate.defaultMessage.rotate);
    toast.success('Posisi direset ke default template.');
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isMounted = true;

    const render = () => {
      if (!isMounted) return;
      renderMenfessToCanvas(canvas, {
        template: currentTemplate,
        ratio,
        message: pesan,
        senderName: menfes?.senderName || '',
        isAnon: !menfes?.senderName,
        fontSize,
        fontSizeName,
        posX,
        posY,
        rotate,
        msgX,
        msgY,
        msgRotate,
        onStatusChange: setBgStatus,
      });
    };

    render();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (isMounted) render();
      });
    }

    return () => {
      isMounted = false;
    };
  }, [selectedTemplateId, ratio, fontSize, fontSizeName, menfes, pesan, posX, posY, rotate, msgX, msgY, msgRotate]);

  // Breakpoint listener (desktop vs mobile).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Ukur area body. Guard 1px mencegah loop: preview melebar → kolom
  // controls menyempit → body (lebarnya tetap) memicu callback lagi.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((prev) =>
        Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1
          ? prev
          : { w: width, h: height }
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Kolom controls = satu-satunya area scroll di modal ini. Preview cuma
  // menyusut di HP, jadi di desktop state ini tidak disentuh. Efek ini ikut
  // bergantung ke isDesktop supaya langsung menyinkronkan ulang saat window
  // di-cross melewati breakpoint.
  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;

    const sync = () => setCompact(!isDesktop && el.scrollTop > 40);

    sync();
    el.addEventListener('scroll', sync, { passive: true });
    return () => el.removeEventListener('scroll', sync);
  }, [isDesktop]);

  // Render ke canvas lalu jadi Blob. Dipisah karena dua tombol butuh hasil
  // yang sama persis: yang diunduh admin dan yang tayang di Instagram harus
  // gambar yang identik, bukan dua render yang mungkin berbeda.
  async function renderKeBlob() {
    const canvas = canvasRef.current;
    renderMenfessToCanvas(canvas, {
      template: currentTemplate,
      ratio,
      message: pesan,
      senderName: menfes?.senderName || '',
      isAnon: !menfes?.senderName,
      fontSize,
      fontSizeName,
      posX,
      posY,
      rotate,
      msgX,
      msgY,
      msgRotate,
    });
    await new Promise((r) => setTimeout(r, 300));

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error('Browser gagal mengubah canvas jadi gambar.')),
        'image/jpeg',
        0.95
      );
    });
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const blob = await renderKeBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `menfes-${currentTemplate.id}-${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Gambar template ${currentTemplate.name} berhasil diunduh.`);
    } catch (err) {
      toast.error('Gagal download gambar.');
      console.error(err);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadFoto() {
    setFotoDownloading(true);
    try {
      // Fetch dulu jadi blob: endpoint foto beda origin (Vercel ↔ Render),
      // dan atribut `download` biasa diabaikan browser untuk cross-origin —
      // hasilnya buka tab gambar, bukan mengunduh.
      const res = await fetch(urlAset(menfes.fotoUrl));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = menfes.fotoUrl.split('/').pop() || 'foto.jpg';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Foto pengirim berhasil diunduh.');
    } catch (err) {
      toast.error('Gagal download foto.');
      console.error(err);
    } finally {
      setFotoDownloading(false);
    }
  }

  async function handlePost() {
    if (caption.length > BATAS_CAPTION) {
      toast.error(`Caption ${caption.length} karakter, batas ${BATAS_CAPTION}.`);
      return;
    }
    setPosting(true);
    try {
      const blob = await renderKeBlob();

      // Content-Type sengaja tidak diisi. Browser yang memasang boundary
      // multipart; menyebut multipart/form-data secara manual tanpa boundary
      // membuat server tidak bisa mengurai body.
      const fd = new FormData();
      fd.append('image', blob, `menfes-${currentTemplate.id}.jpg`);
      fd.append('caption', caption);

      const hasil = await adminAPI.postInstagram(menfes.id, fd);
      toast.success('Tayang di Instagram.');
      // Carousel kadang berakhir "tayang tanpa foto" (foto gagal diproses IG
      // sebelum container induk jadi). Kartu tetap tayang — tapi admin harus
      // tahu, bukan mengira semuanya lengkap.
      if (hasil.data?.peringatan) {
        toast(hasil.data.peringatan, {
          icon: (
            <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          duration: 10000,
        });
      }
      onPosted?.(hasil.data);
    } catch (err) {
      // err.response null berarti gagalnya di jaringan atau timeout, bukan
      // di server, jadi pesannya sudah disiapkan di api/index.js.
      const pesan =
        err.response?.data?.error || err.message || 'Gagal memposting ke Instagram.';
      toast.error(pesan, { duration: 8000 });
      console.error(err);
    } finally {
      setPosting(false);
    }
  }

  // Menfes yang belum APPROVED tidak boleh tayang, jadi tombolnya dimatikan
  // di sini juga, bukan hanya ditolak server. Server tetap menjaganya; ini
  // cuma supaya admin tidak menunggu jawaban yang pasti 409.
  const belumDisetujui = menfes?.status !== 'APPROVED';
  const sudahTayang = menfes?.igStatus === 'PUBLISHED';
  const sibuk = downloading || posting;

  const { w, h } = CANVAS_SIZE[ratio] || CANVAS_SIZE['1:1'];

  // Lebar preview hanya untuk TAMPILAN. Resolusi canvas tetap CANVAS_SIZE
  // (lihat renderMenfessToCanvas), jadi membesar-/mengecilkan preview tidak
  // mengubah file download.
  //
  // Preview mengisi ruang yang tersisa di body modal:
  //   desktop → controls di samping, jadi preview dibatasi oleh TINGGI
  //   mobile  → controls di bawah, jadi preview dibatasi oleh LEBAR
  // Batas minimum controls (360px / 200px) yang dipakai untuk menyisakan ruang
  // dari dua sisi. Kalau body belum terukur (render pertama sebelum
  // ResizeObserver jalan), pakai fallback supaya canvas tidak nol.
  const availW = box.w - PREVIEW_PAD - (isDesktop ? MIN_CTRL_W : 0);
  const availH = box.h - PREVIEW_PAD - (isDesktop ? 0 : MIN_CTRL_H);
  const previewW = (() => {
    if (!box.w) return isDesktop ? 320 : 260; // body belum terukur
    // Rasio width/height dari canvas: 1 untuk 1:1, 0.8 untuk 4:5.
    const aspect = w / h;
    if (isDesktop) {
      // Preview di kiri, controls di kanan → tinggi yang membatasi.
      return Math.max(160, Math.floor(Math.min(availW, availH * aspect)));
    }
    // Mobile: kolom kontrol ada di bawah → lebar yang membatasi. Mode
    // compact dikunci ke COMPACT_H tinggi supaya area slider dapat ruang.
    const hLimit = compact ? COMPACT_H : availH;
    return Math.max(1, Math.floor(Math.min(availW, hLimit * aspect)));
  })();
  const previewH = Math.round((h / w) * previewW);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md pt-10 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Sheet dari bawah di mobile, dialog tengah di tablet/desktop.
          Tinggi = h-full terhadap overlay, dengan padding atas 40px yang
          menyisakan celah untuk tap-to-close. JANGAN pakai vh: di HP,
          vh mengikuti viewport besar (saat URL bar/keyboard tersembunyi)
          sehingga sheet jadi lebih tinggi dari layar yang terlihat dan
          header + tombol close terdorong keluar layar ke atas.
          Height tetap (bukan max-h) + flex column: preview dan footer jadi
          area non-scroll, hanya kolom controls yang scroll. */}
      <div className="bg-ink-700 border border-ink-600 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-[1280px] h-full flex flex-col overflow-hidden">
        {/* Handle bar mobile */}
        <div className="flex-none flex justify-center pt-3 pb-1 sm:hidden" aria-hidden="true">
          <div className="w-10 h-1 bg-ink-500 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex-none flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-ink-600">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-brand-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <h2 className="font-bold text-sm text-parchment-200 font-mono tracking-widest uppercase truncate">Export ke IG</h2>
          </div>
          {/* 44px (bukan 32px) supaya memenuhi standar target sentuh, dan
              warna parchment-300 supaya silangnya kontras di atas ink-700 —
              ink-300 lama terlalu gelap dan lolos pandang di layar HP. */}
          <button
            onClick={onClose}
            className="text-parchment-300 hover:text-parchment-100 hover:bg-ink-600 w-11 h-11 shrink-0 -mr-1.5 flex items-center justify-center rounded-lg transition-colors touch-manipulation"
            aria-label="Tutup"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — preview tidak pernah ikut scroll, hanya kolom controls.
            bodyRef diukur supaya preview bisa hitung sisa ruang (previewW). */}
        <div ref={bodyRef} className="flex-1 min-h-0 flex flex-col sm:flex-row">
          {/* Preview canvas — kolom kiri di desktop, strip atas di mobile.
              Di desktop lebarnya = previewW + padding (p-3), mengikuti hasil
              hitungan di atas supaya canvas dapat lebar penuhnya (maxWidth:100%
              tidak memotong), dan sm:self-start supaya kolom tidak ikut
              meninggi saat rasio 4:5.
              Di mobile kolom tetap full-width (default stretch) dan canvas
              di-center, supaya panel gelapnya tetap membentang penuh. */}
          <div
            className="flex-none flex items-center justify-center bg-ink-800 border-b sm:border-b-0 sm:border-r border-ink-600 p-3 sm:self-start"
            style={isDesktop ? { width: previewW + PREVIEW_PAD } : undefined}
          >
            <canvas
              ref={canvasRef}
              style={{
                width: previewW,
                height: previewH,
                borderRadius: 8,
                boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                maxWidth: '100%',
              }}
            />
          </div>

          {/* Controls — satu-satunya area scroll di modal ini.
              sm:min-w-[360px] menjaga agar kolom ini tidak tergerus oleh
              preview yang lebar (nilai yang sama dengan MIN_CTRL_W). */}
          <div
            ref={controlsRef}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 sm:min-w-[360px] space-y-4"
          >
          {/* Pemilih Template */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-mono font-semibold text-parchment-300 tracking-wider uppercase">
                Pilih Template Background:
              </label>
              <span className="text-[11px] font-mono text-brand-400 bg-brand-950/60 border border-brand-800/60 px-2 py-0.5 rounded-md">
                {currentTemplate.name}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((tmpl) => {
                const isActive = tmpl.id === selectedTemplateId;
                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => handleSelectTemplate(tmpl.id)}
                    className={`relative p-2 rounded-xl border text-left transition-all duration-200 flex flex-col items-center gap-1.5 ${
                      isActive
                        ? 'bg-ink-800 border-brand-500 shadow-md ring-2 ring-brand-500/40'
                        : 'bg-ink-800/60 border-ink-600 hover:border-ink-500 opacity-80 hover:opacity-100'
                    }`}
                  >
                    {/* Thumbnail preview */}
                    <div className="w-full aspect-[3/4] rounded-lg overflow-hidden bg-black/60 border border-ink-600 flex items-center justify-center">
                      <img
                        src={tmpl.thumbnail}
                        alt={tmpl.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          if (tmpl.fallbackSrc) e.target.src = tmpl.fallbackSrc;
                        }}
                      />
                    </div>
                    <div className="text-center w-full">
                      <p className={`text-xs font-mono font-bold truncate ${isActive ? 'text-parchment-100' : 'text-parchment-300'}`}>
                        {tmpl.badge}
                      </p>
                      <p className="text-[10px] text-parchment-400 font-mono truncate">{tmpl.tag}</p>
                    </div>
                    {isActive && (
                      <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-brand-600 text-white rounded-full flex items-center justify-center text-[10px]">
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status template background */}
          {bgStatus === 'error' && (
            <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl p-3 text-xs text-amber-400 font-mono">
              File template tidak ditemukan — beralih ke fallback render.
            </div>
          )}

          {/* Controls */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {/* Rasio — mengikuti template, read-only */}
            <div>
              <label className="block text-xs font-mono font-semibold text-parchment-400 mb-2 tracking-widest uppercase">
                Rasio IG
              </label>
              <div className="py-2 text-sm font-mono font-semibold rounded-lg border border-brand-700 bg-brand-700 text-parchment-100 text-center select-none">
                {ratio}
              </div>
              <p className="text-xs text-ink-200 mt-1 font-mono">
                {ratio === '1:1' ? '1080 × 1080 (Square)' : '1080 × 1350 (Portrait)'}
                <span className="block text-ink-300 mt-0.5">ikut template</span>
              </p>
            </div>

            {/* Font size pesan */}
            <div>
              <label className="block text-xs font-mono font-semibold text-parchment-400 mb-2 tracking-widest uppercase">
                Teks Pesan: {fontSize}px
              </label>
              <input
                type="range"
                min={20}
                max={56}
                step={2}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full accent-brand-600 mt-1 h-5"
              />
              <div className="flex justify-between text-xs text-ink-200 mt-0.5 font-mono">
                <span>Kecil</span>
                <span>Besar</span>
              </div>
            </div>
          </div>

          {/* Font size nama */}
          <div>
            <label className="block text-xs font-mono font-semibold text-parchment-400 mb-2 tracking-widest uppercase">
              Ukuran Nama Pengirim: {fontSizeName}px
            </label>
            <input
              type="range"
              min={14}
              max={44}
              step={2}
              value={fontSizeName}
              onChange={(e) => setFontSizeName(Number(e.target.value))}
              className="w-full accent-brand-600 h-5"
            />
            <div className="flex justify-between text-xs text-ink-200 mt-0.5 font-mono">
              <span>Kecil</span>
              <span>Besar</span>
            </div>
          </div>

          {/* Posisi Nama Pengirim */}
          <div className="bg-ink-800 border border-ink-600 rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono font-bold text-parchment-400 tracking-widest uppercase">
                Posisi Pengirim ({menfes.senderName?.trim() || 'Anonim'})
              </p>
              <button
                type="button"
                onClick={handleResetPositions}
                className="text-[10px] text-brand-400 hover:text-brand-300 font-mono underline"
              >
                ↺ Reset Default
              </button>
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-ink-200 mb-1">
                <span>Kiri ← X → Kanan</span>
                <span className="text-parchment-400">{posX}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={95}
                step={0.5}
                value={posX}
                onChange={(e) => setPosX(Number(e.target.value))}
                className="w-full accent-brand-600 h-5"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-ink-200 mb-1">
                <span>Atas ↑ Y ↓ Bawah</span>
                <span className="text-parchment-400">{posY}%</span>
              </div>
              <input
                type="range"
                min={20}
                max={95}
                step={0.5}
                value={posY}
                onChange={(e) => setPosY(Number(e.target.value))}
                className="w-full accent-brand-600 h-5"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-ink-200 mb-1">
                <span>Rotasi Teks ↺</span>
                <span className="text-parchment-400">{rotate}°</span>
              </div>
              <input
                type="range"
                min={-30}
                max={30}
                step={0.5}
                value={rotate}
                onChange={(e) => setRotate(Number(e.target.value))}
                className="w-full accent-brand-600 h-5"
              />
            </div>
          </div>

          {/* Posisi Teks Pesan */}
          <div className="bg-ink-800 border border-ink-600 rounded-xl p-3 space-y-3">
            <p className="text-[10px] font-mono font-bold text-parchment-400 tracking-widest uppercase">
              Posisi Teks Pesan
            </p>

            <div>
              <div className="flex justify-between text-xs font-mono text-ink-200 mb-1">
                <span>Kiri ← X → Kanan</span>
                <span className="text-parchment-400">{msgX}%</span>
              </div>
              <input
                type="range"
                min={25}
                max={75}
                step={0.5}
                value={msgX}
                onChange={(e) => setMsgX(Number(e.target.value))}
                className="w-full accent-brand-600 h-5"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-ink-200 mb-1">
                <span>Atas ↑ Y ↓ Bawah</span>
                <span className="text-parchment-400">{msgY}%</span>
              </div>
              <input
                type="range"
                min={25}
                max={75}
                step={0.5}
                value={msgY}
                onChange={(e) => setMsgY(Number(e.target.value))}
                className="w-full accent-brand-600 h-5"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-ink-200 mb-1">
                <span>Rotasi ↺</span>
                <span className="text-parchment-400">{msgRotate}°</span>
              </div>
              <input
                type="range"
                min={-15}
                max={15}
                step={0.5}
                value={msgRotate}
                onChange={(e) => setMsgRotate(Number(e.target.value))}
                className="w-full accent-brand-600 h-5"
              />
            </div>

            <p className="text-[10px] text-ink-200 font-mono">
              Diukur dari titik tengah blok teks, bukan tepi kiri. Teks boleh menjulur keluar
              kertas — naikkan "Teks Pesan" dulu kalau mau lebih kecil.
            </p>
          </div>

          {/* Pesan yang dibakar ke gambar. Diedit lokal saja: menfess asli di
              database tidak pernah ditimpa oleh kolom ini. */}
          <div className="bg-ink-800 border border-ink-600 rounded-xl p-3">
            <div className="flex justify-between items-baseline mb-1.5">
              <p className="text-[10px] font-mono font-bold text-ink-200 tracking-widest uppercase">Isi Pesan</p>
              <span
                className={`text-[10px] font-mono ${
                  pesan.trim().length < 5 || pesan.trim().length > 500
                    ? 'text-red-400'
                    : 'text-ink-200'
                }`}
              >
                {pesan.trim().length}/500
              </span>
            </div>
            <textarea
              value={pesan}
              onChange={(e) => setPesan(e.target.value.slice(0, 700))}
              rows={4}
              placeholder="Teks yang digambar ke gambar. Minimal 5, maksimal 500 karakter."
              className="w-full bg-ink-700 border border-ink-600 rounded-lg px-2.5 py-2 text-sm text-parchment-300 font-mono leading-relaxed resize-y focus:border-brand-500 focus:outline-none"
            />
            {pesan !== (menfes?.message || '') && (
              <button
                type="button"
                onClick={() => setPesan(menfes?.message || '')}
                className="mt-1.5 text-[10px] font-mono text-brand-500 hover:text-brand-400 underline underline-offset-2"
              >
                Reset ke teks asli
              </button>
            )}
          </div>

          {/* Foto pengirim — slide kedua carousel. Hanya muncul kalau menfes
              punya foto. Kalau filenya hilang di server, section ini jujur
              bilang begitu; post IG tetap jalan dengan fallback kartu-saja. */}
          {menfes?.fotoUrl && (
            <div className="bg-ink-800 border border-ink-600 rounded-xl p-3">
              <div className="flex justify-between items-baseline mb-1.5">
                <p className="text-[10px] font-mono font-bold text-ink-200 tracking-widest uppercase">
                  Foto Pengirim — Slide 2
                </p>
                <span className="text-[10px] font-mono text-brand-400 bg-brand-950/60 border border-brand-800/60 px-2 py-0.5 rounded-md">
                  CAROUSEL
                </span>
              </div>

              {fotoHilang ? (
                <p className="text-[11px] font-mono text-amber-400 leading-relaxed">
                  File foto tidak ditemukan di server. Post ke IG tetap bisa —
                  kartu tayang tanpa foto.
                </p>
              ) : (
                <>
                  <img
                    src={urlAset(menfes.fotoUrl)}
                    alt="Foto pengirim"
                    onError={() => setFotoHilang(true)}
                    className="w-full max-h-56 object-contain rounded-lg bg-ink-900 border border-ink-600"
                  />
                  <p className="text-[10px] text-ink-200 font-mono mt-1.5">
                    Ikut tayang sebagai slide kedua setelah kartu. Diunduh apa
                    adanya dari server buat post manual.
                  </p>
                  <button
                    type="button"
                    onClick={handleDownloadFoto}
                    disabled={fotoDownloading || sibuk}
                    className="mt-2 w-full btn-secondary font-mono text-xs flex items-center justify-center gap-2 py-2.5 touch-manipulation disabled:opacity-40"
                  >
                    {fotoDownloading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Mengunduh...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download Foto
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Caption Instagram */}
          <div className="bg-ink-800 border border-ink-600 rounded-xl p-3">
            <div className="flex justify-between items-baseline mb-1.5">
              <p className="text-[10px] font-mono font-bold text-ink-200 tracking-widest uppercase">
                Caption Instagram
              </p>
              <span
                className={`text-[10px] font-mono ${
                  caption.length > BATAS_CAPTION ? 'text-red-400' : 'text-ink-200'
                }`}
              >
                {caption.length}/{BATAS_CAPTION}
              </span>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, BATAS_CAPTION + 200))}
              rows={4}
              placeholder="Teks yang muncul di bawah gambar. Kosongkan kalau mau posting tanpa caption."
              className="w-full bg-ink-700 border border-ink-600 rounded-lg px-2.5 py-2 text-sm text-parchment-300 font-mono resize-y focus:border-brand-500 focus:outline-none"
            />
            <p className="text-[10px] text-ink-200 font-mono mt-1.5">
              Caption ditulis di sini, bukan di gambar. Musik tetap ditambahkan
              manual di aplikasi Instagram.
            </p>

            {/* Status publikasi. Satu-satunya tempat admin melihat apakah
                menfes ini sudah pernah tayang, supaya tidak ada alasan untuk
                menekan tombol yang sama dua kali. */}
            {menfes?.igStatus && (
              <p
                className={`text-[11px] font-mono mt-2 ${
                  sudahTayang ? 'text-green-400' : 'text-amber-400'
                }`}
              >
                {sudahTayang ? 'Sudah tayang' : 'Gagal tayang'}
                {menfes.igPermalink && (
                  <>
                    {' — '}
                    <a
                      href={menfes.igPermalink}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline hover:text-parchment-300"
                    >
                      lihat
                    </a>
                  </>
                )}
                {menfes.igError && !sudahTayang && ` — ${menfes.igError}`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Footer buttons container - the correct structure */}
        <div className="flex-none flex gap-3 px-4 sm:px-5 py-3 border-t border-ink-600">
          {/* Download Button */}
          <button
            onClick={handleDownload}
            disabled={sibuk}
            className="btn-secondary flex-1 font-mono text-sm flex items-center justify-center gap-2 py-3.5 sm:py-3 touch-manipulation whitespace-nowrap"
          >
            {downloading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Downloading...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download JPG
              </>
            )}
          </button>

          {/* Post Button */}
          <button
            onClick={handlePost}
            disabled={sibuk || belumDisetujui || sudahTayang}
            title={
              belumDisetujui
                ? 'Approve menfes ini dulu di dashboard.'
                : sudahTayang
                  ? 'Menfes ini sudah pernah tayang.'
                  : 'Publikasikan ke Instagram'
            }
            className="btn-primary flex-1 font-mono text-sm flex items-center justify-center gap-2 py-3.5 sm:py-3 touch-manipulation whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {posting ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Tayang...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {sudahTayang ? 'Sudah Tayang' : belumDisetujui ? 'Perlu Approve' : 'Post ke IG'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}