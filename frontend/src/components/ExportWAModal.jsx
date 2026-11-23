import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { getTemplateById, parseTemplateFromMenfes } from '../config/templates';
import { renderMenfessToCanvas, hitungKartu } from '../utils/drawMenfessCanvas';
import { adminAPI } from '../api';

// Export WA = render kartu yang SAMA seperti Export IG, tapi tanpa field caption.
// Tombol yang ada: Download JPG dan Kirim ke WA. Media lampiran (foto/video)
// diambil backend dari DB menfes, bukan dari sini.
export default function ExportWAModal({ menfes, onClose }) {
  const canvasRef = useRef(null);
  const template = getTemplateById(parseTemplateFromMenfes(menfes));
  const ratio = template.defaultRatio || '4:5';
  const kodeUnik = (menfes?.id || '').slice(0, 8) || 'tanpa-id';
  // Trim sekali; string yang sama dipakai untuk hitungKartu dan render supaya
  // jumlah baris tidak meleset (alasan sama dengan ExportModal).
  const pesan = (menfes?.message || '').trim();

  const [sibuk, setSibuk] = useState(false);
  const [jumlahKartu, setJumlahKartu] = useState(1);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !sibuk) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sibuk]);

  // Hitung kartu sekali saat modal dibuka supaya admin tahu berapa gambar
  // yang bakal dikirim. Pakai font yang sudah siap seperti ExportModal.
  useEffect(() => {
    let batal = false;
    (async () => {
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch { /* abaikan */ }
      }
      if (batal || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      const hasil = hitungKartu(ctx, template, ratio, pesan);
      if (!batal) setJumlahKartu(hasil.totalParts);
    })();
    return () => { batal = true; };
  }, [template, ratio, pesan]);

  async function renderSemuaBlob() {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error('Canvas tidak siap.');
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch { /* abaikan */ }
    }
    const ctx = canvas.getContext('2d');
    const { totalParts, chunks } = hitungKartu(ctx, template, ratio, pesan);
    const multicard = totalParts > 1;
    const blobs = [];
    for (let i = 0; i < totalParts; i++) {
      // Fungsi render mengembalikan promise yang selesai setelah latar dan
      // font benar-benar tergambar. Tanpa await, toBlob mengunci canvas
      // kosong dan kartu yang terkirim jadi hitam.
      await renderMenfessToCanvas(canvas, {
        template,
        ratio,
        message: pesan,
        partLines: multicard ? chunks[i] : null,
        partIndex: i,
        totalParts,
      });
      blobs.push(
        await new Promise((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Browser gagal mengubah canvas jadi gambar.'))),
            'image/jpeg',
            0.95
          );
        })
      );
      if (i < totalParts - 1) await new Promise((r) => setTimeout(r, 100));
    }
    return blobs;
  }

  async function handleDownload() {
    setSibuk(true);
    try {
      const blobs = await renderSemuaBlob();
      blobs.forEach((blob, i) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `menfes-${kodeUnik}-kartu-${i + 1}-dari-${blobs.length}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
      toast.success(`${blobs.length} kartu diunduh.`);
    } catch (err) {
      toast.error(err.message || 'Gagal download gambar.');
    } finally {
      setSibuk(false);
    }
  }

  async function handleKirimWa() {
    setSibuk(true);
    try {
      const blobs = await renderSemuaBlob();
      const fd = new FormData();
      blobs.forEach((blob, i) => {
        fd.append('images', blob, `menfes-${kodeUnik}-kartu-${i + 1}.jpg`);
      });
      const hasil = await adminAPI.postWa(menfes.id, fd);
      const gagal = hasil.data?.gagal || [];
      if (gagal.length) {
        toast.error(`Terkirim ${hasil.data?.terkirim || 0} media. Gagal: ${gagal.join('; ')}`, {
          duration: 10000,
        });
      } else {
        toast.success(`Terkirim ${hasil.data?.terkirim || 0} media ke WhatsApp.`);
      }
      onClose();
    } catch (err) {
      const pesanError = err.response?.data?.error || err.message || 'Gagal kirim ke WA.';
      toast.error(pesanError, { duration: 8000 });
    } finally {
      setSibuk(false);
    }
  }

  const lampiran = (menfes?.fotoUrls?.length || 0) + (menfes?.videoUrl ? 1 : 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6">
      <div className="w-full max-w-sm rounded-2xl border border-ink-500 bg-ink-800 p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-mono font-semibold text-parchment-100">Export WA</h2>
          <button
            onClick={onClose}
            disabled={sibuk}
            className="text-ink-200 hover:text-parchment-100 disabled:opacity-40"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

        <p className="text-xs font-mono text-ink-200 mb-3">
          {jumlahKartu} kartu menfes
          {lampiran > 0 ? ` + ${lampiran} lampiran dari pengirim` : ''} akan dikirim ke grup WA.
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleDownload}
            disabled={sibuk}
            className="w-full rounded-lg bg-ink-600 hover:bg-ink-500 text-parchment-100 font-mono text-xs py-2.5 disabled:opacity-50"
          >
            {sibuk ? 'Memproses...' : 'Download JPG'}
          </button>
          <button
            onClick={handleKirimWa}
            disabled={sibuk}
            className="w-full rounded-lg bg-green-700 hover:bg-green-600 text-white font-mono text-xs py-2.5 disabled:opacity-50"
          >
            {sibuk ? 'Mengirim...' : 'Kirim ke WA'}
          </button>
          <button
            onClick={onClose}
            disabled={sibuk}
            className="w-full rounded-lg text-ink-200 hover:text-parchment-100 font-mono text-xs py-1.5 disabled:opacity-40"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  );
}
