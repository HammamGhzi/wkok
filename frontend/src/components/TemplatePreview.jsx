import { useRef, useEffect, useState } from 'react';
import { renderMenfessToCanvas, hitungKartu, CANVAS_SIZE } from '../utils/drawMenfessCanvas';

export default function TemplatePreview({
  template,
  message,
  className = '',
}) {
  const canvasRef = useRef(null);
  const ratio = template.defaultRatio || '1:1';
  const { w, h } = CANVAS_SIZE[ratio] || CANVAS_SIZE['1:1'];

  // Trim SEKALI di sini, string yang sama dikirim ke hitungKartu dan
  // renderMenfessToCanvas — hindari selisih whitespace antara hitung & render.
  const msg = (message || '').trim();

  const [part, setPart] = useState(0); // 0-based, kartu aktif
  const [chunks, setChunks] = useState(null); // null = belum dihitung
  const totalParts = chunks ? chunks.length : 1;

  // Hitung jumlah kartu + chunk barisnya.
  // Wajib sesudah document.fonts.ready: sebelum font siap, wrapText bisa
  // meleset ±1 baris dan kartu jadi salah hitung.
  useEffect(() => {
    let isMounted = true;

    // Pesan/template berubah → kembali ke kartu pertama, chunk lama dibuang
    // dulu supaya render sementara memakai jalur lama (wrap sendiri) dengan
    // isi pesan yang baru, bukan baris lama yang basi.
    setPart(0);
    setChunks(null);

    const hitung = () => {
      if (!isMounted) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // ctx cuma dipakai untuk measureText (save/restore ada di dalam
      // hitungKartu) — measure harus di canvas beneran, jangan tanpa canvas.
      const { chunks: hasil } = hitungKartu(ctx, template, ratio, msg);
      if (!isMounted) return;

      setChunks(hasil);
      // Clamp: pesan dipendekkan → totalParts turun → part bisa di luar range.
      setPart((p) => Math.min(p, hasil.length - 1));
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(hitung);
    } else {
      // Fallback browser tanpa Font Loading API
      hitung();
    }

    return () => {
      isMounted = false;
    };
  }, [template, ratio, message]); // `msg` hasil trim dari `message`

  // Render canvas. `chunks` ikut di dependency karena state hasil hitung —
  // begitu chunk siap, kartu aktif harus digambar ulang.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isMounted = true;

    const render = () => {
      if (!isMounted) return;
      const safePart = Math.min(part, totalParts - 1);
      // Pesan kosong → kirim null supaya placeholder lama tampil persis
      // seperti sebelumnya (hitungKartu('') menghasilkan chunk kosong).
      const partLines = chunks && msg ? (chunks[safePart] || null) : null;
      renderMenfessToCanvas(canvas, {
        template,
        ratio,
        message: msg,
        partLines,
        partIndex: safePart,
        totalParts,
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
  }, [template, ratio, message, part, chunks, totalParts]); // `msg` hasil trim dari `message`

  // Rasio aspek untuk styling container canvas
  const aspectRatioClass = ratio === '4:5' ? 'aspect-[4/5]' : 'aspect-square';

  return (
    <div className={`relative flex flex-col items-center ${className}`}>
      {/* Kartu preview fisik */}
      <div className="w-full max-w-[320px] sm:max-w-[360px] bg-white dark:bg-ink-900 border border-parchment-300 dark:border-ink-600/80 rounded-2xl p-3 shadow-2xl space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-mono font-bold text-ink-900 dark:text-parchment-200 tracking-wider">
              {template.name}
            </span>
          </div>
          <span className="text-[10px] font-mono text-ink-500 dark:text-ink-200 bg-parchment-100 dark:bg-ink-800 border border-parchment-300 dark:border-ink-600 px-2 py-0.5 rounded-full">
            {ratio === '4:5' ? '4:5 Portrait' : '1:1 Square'}
          </span>
        </div>

        {/* Canvas Display */}
        <div className={`w-full ${aspectRatioClass} rounded-xl overflow-hidden bg-parchment-200 dark:bg-black/60 shadow-inner border border-parchment-300 dark:border-ink-700/60 flex items-center justify-center relative`}>
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain"
            style={{ display: 'block' }}
          />

          {/* Navigasi multicard — dirender HANYA kalau totalParts > 1,
              supaya preview 1 kartu identik dengan versi lama. */}
          {totalParts > 1 && (
            <>
              <button
                type="button"
                onClick={() => setPart((p) => Math.max(0, p - 1))}
                disabled={part <= 0}
                aria-label="Kartu sebelumnya"
                className={`absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-lg font-bold leading-none text-white shadow-lg hover:bg-black/75 focus:outline-none focus:ring-2 focus:ring-white/60 ${
                  part <= 0
                    ? 'pointer-events-none opacity-30'
                    : 'opacity-90'
                }`}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setPart((p) => Math.min(totalParts - 1, p + 1))}
                disabled={part >= totalParts - 1}
                aria-label="Kartu berikutnya"
                className={`absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-lg font-bold leading-none text-white shadow-lg hover:bg-black/75 focus:outline-none focus:ring-2 focus:ring-white/60 ${
                  part >= totalParts - 1
                    ? 'pointer-events-none opacity-30'
                    : 'opacity-90'
                }`}
              >
                ›
              </button>
            </>
          )}
        </div>

        {/* Indikator kartu di bawah canvas — juga hanya untuk multicard */}
        {totalParts > 1 && (
          <p className="text-center text-[10px] font-mono text-ink-500 dark:text-ink-200 bg-parchment-100 dark:bg-ink-800 border border-parchment-300 dark:border-ink-600 mx-auto w-fit px-2 py-0.5 rounded-full">
            {part + 1} / {totalParts}
          </p>
        )}

        <p className="text-[10px] text-center text-ink-500 dark:text-ink-200 font-mono">
          Pratinjau langsung sesuai hasil export Instagram
        </p>
      </div>
    </div>
  );
}
