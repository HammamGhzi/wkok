import { useRef, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { TEMPLATES, getTemplateById, parseTemplateFromMenfes } from '../config/templates';
import { renderMenfessToCanvas, CANVAS_SIZE, hitungKartu } from '../utils/drawMenfessCanvas';
import { adminAPI, urlAset } from '../api';
import usePreviewLagu from '../hooks/usePreviewLagu';

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

  // Kode unik per menfes untuk nama file unduhan. Sebelumnya nama file hanya
  // memuat id template, jadi dua menfes dengan template sama menghasilkan nama
  // persis sama dan browser menamainya "(1)". Delapan karakter awal id sudah
  // cukup unik sekaligus masih bisa dilacak balik ke baris database.
  const kodeUnik = (menfes?.id || '').slice(0, 8) || 'tanpa-id';

  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId);
  const currentTemplate = getTemplateById(selectedTemplateId);

  // Rasio IKUT TEMPLATE, bukan pilihan user. Semua template memakai 4:5 dan
  // zona aman serta posisi pesan di gambar sudah diukur untuk rasio itu.
  // Tombol rasio sebelumnya membiarkan 1:1 dipilih, dan di 1:1 cover-crop
  // memotong tinggi gambar sehingga zona aman yang dibaked bergeser.
  // Menghapus pilihan itu lebih jujur daripada menambal per-rasio di tiap
  // template.
  const ratio = currentTemplate.defaultRatio || '4:5';
  // Font ukuran pesan TIDAK punya slider: selalu template.defaultFontSize.
  // Alasan: multicard harus sinkron dengan hitungKartu (yang memakai default),
  // dan font besar di 1 kartu bisa memotong teks diam-diam karena wrap tetap
  // dibatasi maxLines. Posisi/rotasi tetap bisa diatur di bawah.
  const [downloading, setDownloading] = useState(false);
  // Unduh foto pengirim + penanda file hilang. Disk server ephemeral (Render),
  // jadi foto bisa raib setelah redeploy — section-nya harus jujur bilang
  // begitu, bukan error diam-diam.
  const [fotoDownloading, setFotoDownloading] = useState(false);
  const [fotoHilang, setFotoHilang] = useState(false);
  // Video pengirim: unduh manual + penanda file hilang, alasannya sama dengan
  // foto. URL-nya sudah MP4 berframe hasil Cloudinary.
  const [videoDownloading, setVideoDownloading] = useState(false);
  const [videoHilang, setVideoHilang] = useState(false);
  // Caption diisi dari igCaption supaya menfes yang gagal tayang dan mau dicoba
  // lagi tidak mengharuskan admin mengetik ulang teksnya.
  const [caption, setCaption] = useState(menfes?.igCaption || '');
  // Teks pesan yang dibakar ke gambar. Dipisah dari menfes.message supaya
  // admin boleh merapikan teks untuk export tanpa menimpa menfess asli di
  // database — edit ini hidup selama modal terbuka, tutup modal = hilang.
  const [pesan, setPesan] = useState(menfes?.message || '');
  const [posting, setPosting] = useState(false);
  const [bgStatus, setBgStatus] = useState('loading');

  // Posisi teks menfes — dipatok ke titik tengah blok, bukan kiri-atas,
  // supaya blok multi-baris tetap stabil dan rotasi berputar di sekitar pusat.
  const [msgX, setMsgX] = useState(currentTemplate.defaultMessage.posX);
  const [msgY, setMsgY] = useState(currentTemplate.defaultMessage.posY);
  const [msgRotate, setMsgRotate] = useState(currentTemplate.defaultMessage.rotate);

  // Navigasi multicard di preview live: kartu aktif + baris per kartu.
  // Chunk dihitung sendiri di efek preview (bukan dipinjam dari handlePost)
  // supaya selalu sinkron dengan pesan yang sedang diketik admin.
  const [part, setPart] = useState(0); // 0-based, kartu aktif
  const [chunks, setChunks] = useState(null); // null = belum dihitung
  const totalParts = chunks ? chunks.length : 1;

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
    setMsgX(tmpl.defaultMessage.posX);
    setMsgY(tmpl.defaultMessage.posY);
    setMsgRotate(tmpl.defaultMessage.rotate);
  }

  // Reset slider ke default template saat ini
  function handleResetPositions() {
    setMsgX(currentTemplate.defaultMessage.posX);
    setMsgY(currentTemplate.defaultMessage.posY);
    setMsgRotate(currentTemplate.defaultMessage.rotate);
    toast.success('Posisi direset ke default template.');
  }

  // Hitung jumlah kartu + chunk barisnya buat preview live. Wajib SETELAH
  // document.fonts.ready (sama seperti hitungDariPesan): sebelum font siap,
  // wrapText bisa meleset ±1 baris. Chunk preview dan chunk export sama-sama
  // hasil hitungKartu dengan font default template, jadi yang dilihat admin
  // = yang keluar di file.
  useEffect(() => {
    let isMounted = true;

    // Pesan/template berubah → kembali ke kartu pertama, chunk lama dibuang
    // dulu supaya render sementara memakai jalur lama dengan pesan yang baru.
    setPart(0);
    setChunks(null);

    const hitung = () => {
      if (!isMounted) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { chunks: hasil } = hitungKartu(ctx, currentTemplate, ratio, pesanUntukExport());
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
  }, [selectedTemplateId, ratio, pesan]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isMounted = true;

    const render = () => {
      if (!isMounted) return;
      const safePart = Math.min(part, totalParts - 1);
      // Multicard: gambar chunk aktif + badge n/N. Kartu tunggal: tanpa
      // partLines = render lama. Font SELALU default template (tanpa param
      // fontSize) supaya preview = hasil export.
      const multicard = totalParts > 1;
      renderMenfessToCanvas(canvas, {
        template: currentTemplate,
        ratio,
        message: pesan,
        msgX,
        msgY,
        msgRotate,
        partLines: multicard && chunks ? (chunks[safePart] || null) : null,
        partIndex: safePart,
        totalParts,
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
  }, [selectedTemplateId, ratio, menfes, pesan, msgX, msgY, msgRotate, part, chunks, totalParts]);

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

  // Pesan di-trim SEKALI di sini, hasilnya dipakai identik untuk hitungKartu
  // dan untuk render — kalau dua jalur trim/prepare sendiri-sendiri, jumlah
  // baris bisa beda dan kartu terakhir jadi kepanjangan.
  function pesanUntukExport() {
    return (pesan || '').trim();
  }

  // Hitung jumlah kartu + chunk-nya. Wajib SETELAH document.fonts.ready:
  // hitungKartu pakai ctx.measureText, dan kalau font belum termuat hasil
  // wrap-nya meleset dari render yang menunggu font sendiri.
  async function hitungDariPesan() {
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // Browser tanpa Font Loading API: lanjut, render juga fallback sama.
      }
    }
    const msg = pesanUntukExport();
    const ctx = canvasRef.current.getContext('2d');
    // `msg` ikut dikembalikan supaya render memakai string yang SAMA dengan
    // hitung — trim hanya sekali per handler.
    return { ...hitungKartu(ctx, currentTemplate, ratio, msg), msg };
  }

  // Render ke canvas lalu jadi Blob — SATU blob per kartu. Dipisah karena
  // dua tombol butuh hasil yang sama persis: yang diunduh admin dan yang
  // tayang di Instagram harus gambar yang identik, bukan dua render yang
  // mungkin berbeda.
  //
  // `kartu` boleh diisi hasil hitungDariPesan() yang sudah dipanggil pemanggil
  // (handlePost butuh jumlah kartu untuk guard batas 10 SEBELUM render);
  // tanpa argumen, fungsi ini hitung sendiri — tetap sekali per handler.
  async function renderSemuaBlob(kartu = null) {
    const canvas = canvasRef.current;
    const { totalParts, chunks, msg } = kartu || (await hitungDariPesan());

    const multicard = totalParts > 1;

    const blobs = [];
    for (let i = 0; i < totalParts; i++) {
      renderMenfessToCanvas(canvas, {
        template: currentTemplate,
        ratio,
        message: msg,
        msgX,
        msgY,
        msgRotate,
        partLines: multicard ? chunks[i] : null,
        partIndex: i,
        totalParts,
      });
      // Render canvas ini async (img.onload + fonts.ready di dalam
      // renderMenfessToCanvas), jadi tunggu pola 300ms yang sama seperti
      // kode lama sebelum mengunci hasilnya jadi blob.
      await new Promise((r) => setTimeout(r, 300));

      blobs.push(
        await new Promise((resolve, reject) => {
          canvas.toBlob(
            (b) =>
              b
                ? resolve(b)
                : reject(new Error('Browser gagal mengubah canvas jadi gambar.')),
            'image/jpeg',
            0.95
          );
        })
      );

      // Jeda antar kartu: kasih waktu event loop + decode sebelum canvas
      // ditimpa render berikutnya.
      if (i < totalParts - 1) await new Promise((r) => setTimeout(r, 100));
    }
    return blobs;
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const blobs = await renderSemuaBlob();
      const n = blobs.length;
      // Unduh berurutan, satu anchor click per blob. Jeda 400ms antar click
      // supaya browser tidak menolak/menunda unduhan yang datang terlalu
      // cepat (batas 10 kartu HANYA untuk upload, download bebas).
      for (let i = 0; i < n; i++) {
        const url = URL.createObjectURL(blobs[i]);
        const a = document.createElement('a');
        a.href = url;
        a.download = `menfes-${currentTemplate.id}-${kodeUnik}-kartu-${i + 1}-dari-${n}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
        if (i < n - 1) await new Promise((r) => setTimeout(r, 400));
      }
      toast.success(`${n} gambar berhasil diunduh`);
    } catch (err) {
      toast.error('Gagal download gambar.');
      console.error(err);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadFoto() {
    const urls = menfes?.fotoUrls || [];
    setFotoDownloading(true);
    let gagal = 0;
    try {
      // Satu per satu, bukan Promise.all: browser membatasi unduhan serentak
      // dan nama file berurutan lebih mudah dicocokkan dengan slide carousel.
      for (let i = 0; i < urls.length; i++) {
        try {
          // Fetch dulu jadi blob: endpoint foto beda origin (Vercel ↔ Render),
          // dan atribut `download` biasa diabaikan browser untuk cross-origin —
          // hasilnya buka tab gambar, bukan mengunduh.
          const res = await fetch(urlAset(urls[i]));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const ext = (urls[i].split('.').pop() || 'jpg').toLowerCase();
          a.download = `menfes-${kodeUnik}-foto-${i + 1}.${ext}`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          gagal += 1;
          console.error(err);
        }
        if (i < urls.length - 1) await new Promise((r) => setTimeout(r, 400));
      }
      if (!urls.length || gagal === urls.length) {
        toast.error('Gagal download foto.');
      } else if (gagal) {
        toast.error(`${gagal} dari ${urls.length} foto gagal diunduh.`);
      } else {
        toast.success(
          urls.length > 1
            ? `${urls.length} foto berhasil diunduh.`
            : 'Foto pengirim berhasil diunduh.'
        );
      }
    } finally {
      setFotoDownloading(false);
    }
  }

  async function handleDownloadVideo() {
    setVideoDownloading(true);
    try {
      // Fetch dulu jadi blob, alasannya sama dengan foto: endpoint aset beda
      // origin (Vercel ↔ Cloudinary), dan atribut `download` diabaikan browser
      // untuk URL cross-origin.
      const res = await fetch(urlAset(menfes.videoUrl));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `menfes-${kodeUnik}-video.mp4`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Video pengirim berhasil diunduh.');
    } catch (err) {
      toast.error('Gagal download video.');
      console.error(err);
    } finally {
      setVideoDownloading(false);
    }
  }

  async function handlePost() {
    if (caption.length > BATAS_CAPTION) {
      toast.error(`Caption ${caption.length} karakter, batas ${BATAS_CAPTION}.`);
      return;
    }
    setPosting(true);
    try {
      // Guard batas Instagram SEBELUM render/upload: pesan 11+ kartu harus
      // ditolak di sini, jadi admin tidak menunggu 11 render percuma.
      // hitungKartu dipanggil sekali di handler ini; hasilnya dipakai lagi
      // oleh renderSemuaBlob supaya tidak dihitung dobel.
      const kartu = await hitungDariPesan();
      // Lampiran pengirim (foto dan/atau video) ikut jadi anak carousel, jadi
      // jumlah anak = kartu + tiap foto + video. Guard-nya di sini juga, bukan
      // hanya jumlah kartu — lebih jujur menolak daripada memotong lampiran.
      const jumlahAnak =
        kartu.totalParts +
        (menfes?.fotoUrls?.length || 0) +
        (menfes?.videoUrl ? 1 : 0);
      if (jumlahAnak > 10) {
        toast.error(
          `Instagram feed maksimal 10 slide — ${kartu.totalParts} kartu + ` +
            `${(menfes?.fotoUrls?.length || 0) + (menfes?.videoUrl ? 1 : 0)} lampiran. ` +
            'Pangkas pesan atau kurangi lampiran.'
        );
        return;
      }
      const blobs = await renderSemuaBlob(kartu);

      // Content-Type sengaja tidak diisi. Browser yang memasang boundary
      // multipart; menyebut multipart/form-data secara manual tanpa boundary
      // membuat server tidak bisa mengurai body.
      //
      // Field `images` (array), bukan `image` lagi: backend Task 5 menerima
      // array kartu. Kartu tunggal tetap dikirim sebagai array berisi 1 —
      // kontraknya array di semua jumlah kartu.
      const fd = new FormData();
      blobs.forEach((blob, i) => {
        fd.append('images', blob, `menfes-${currentTemplate.id}-${kodeUnik}-kartu-${i + 1}.jpg`);
      });
      fd.append('caption', caption);

      // Video butuh waktu proses lebih lama di Instagram (transcode + cek
      // status), jadi batas tunggu admin diperpanjang hanya untuk jalur ini.
      const hasil = await adminAPI.postInstagram(
        menfes.id,
        fd,
        menfes?.videoUrl ? 300000 : undefined
      );
      toast.success(
        blobs.length > 1
          ? `${blobs.length} kartu tayang di Instagram.`
          : 'Tayang di Instagram.'
      );
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

  // ── Lagu pilihan ──────────────────────────────────────────────────────────
  // Pemutar tanpa UI player: bunyi dari iframe tersembunyi (hook yang sama
  // dengan MusicPicker). Komponen unmount saat modal ditutup -> audio ikut
  // mati. Lagu TIDAK ikut ke caption/gambar/post IG — blok ini cuma layar.
  const durasiLagu =
    menfes?.music && typeof menfes.music.duration === 'number' && Number.isFinite(menfes.music.duration)
      ? menfes.music.duration
      : null;
  const durasiTeks =
    durasiLagu != null
      ? `${Math.floor(durasiLagu / 60)}:${String(durasiLagu % 60).padStart(2, '0')}`
      : null;
  const { putar, toggle, player } = usePreviewLagu({
    videoId: menfes?.music?.videoId || null,
    judul: menfes?.music?.title || '',
    durasiDetik: durasiLagu,
  });

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
            className="relative flex-none flex items-center justify-center bg-ink-800 border-b sm:border-b-0 sm:border-r border-ink-600 p-3 sm:self-start"
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

            {/* Navigasi multicard — dirender HANYA kalau totalParts > 1,
                supaya preview 1 kartu identik dengan versi lama. */}
            {totalParts > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setPart((p) => Math.max(0, p - 1))}
                  disabled={part <= 0}
                  aria-label="Kartu sebelumnya"
                  className={`absolute left-4 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-lg font-bold leading-none text-white shadow-lg hover:bg-black/75 focus:outline-none focus:ring-2 focus:ring-white/60 ${
                    part <= 0 ? 'pointer-events-none opacity-30' : 'opacity-90'
                  }`}
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setPart((p) => Math.min(totalParts - 1, p + 1))}
                  disabled={part >= totalParts - 1}
                  aria-label="Kartu berikutnya"
                  className={`absolute right-4 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-lg font-bold leading-none text-white shadow-lg hover:bg-black/75 focus:outline-none focus:ring-2 focus:ring-white/60 ${
                    part >= totalParts - 1 ? 'pointer-events-none opacity-30' : 'opacity-90'
                  }`}
                >
                  ›
                </button>
                <span className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-mono font-semibold text-white shadow-lg">
                  {part + 1} / {totalParts}
                </span>
              </>
            )}
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
          </div>

          {/* Posisi Teks Pesan */}
          <div className="bg-ink-800 border border-ink-600 rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono font-bold text-parchment-400 tracking-widest uppercase">
                Posisi Teks Pesan
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

          {/* Foto pengirim — slide setelah kartu, berurutan. Hanya muncul kalau
              menfes punya foto. Kalau ada filenya hilang di server, section ini
              jujur bilang begitu; post IG tetap jalan dengan fallback kartu-saja. */}
          {(menfes?.fotoUrls?.length || 0) > 0 && (
            <div className="bg-ink-800 border border-ink-600 rounded-xl p-3">
              <div className="flex justify-between items-baseline mb-1.5">
                <p className="text-[10px] font-mono font-bold text-ink-200 tracking-widest uppercase">
                  Foto Pengirim ({menfes.fotoUrls.length})
                </p>
                <span className="text-[10px] font-mono text-brand-400 bg-brand-950/60 border border-brand-800/60 px-2 py-0.5 rounded-md">
                  CAROUSEL
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {menfes.fotoUrls.map((url, i) => (
                  <div key={url} className="relative">
                    <img
                      src={urlAset(url)}
                      alt={`Foto pengirim ${i + 1}`}
                      onError={() => setFotoHilang(true)}
                      className="w-full h-28 object-cover rounded-lg bg-ink-900 border border-ink-600"
                    />
                    <span className="absolute bottom-1 left-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/60 text-white">
                      Slide {i + 2}
                    </span>
                  </div>
                ))}
              </div>

              {fotoHilang && (
                <p className="text-[11px] font-mono text-amber-400 leading-relaxed mt-1.5">
                  Sebagian file foto tidak ditemukan di server. Post ke IG tetap
                  bisa — slide yang hilang dilewati.
                </p>
              )}

              <p className="text-[10px] text-ink-200 font-mono mt-1.5">
                Ikut tayang berurutan setelah kartu. Diunduh apa adanya dari
                server buat post manual.
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
                    {menfes.fotoUrls.length > 1
                      ? `Download Semua Foto (${menfes.fotoUrls.length})`
                      : 'Download Foto'}
                  </>
                )}
              </button>
            </div>
          )}

          {/* Video pengirim — slide terakhir carousel. Sama seperti foto:
              kalau filenya hilang, section ini jujur dan post tetap jalan
              dengan fallback kartu-saja. */}
          {menfes?.videoUrl && (
            <div className="bg-ink-800 border border-ink-600 rounded-xl p-3">
              <div className="flex justify-between items-baseline mb-1.5">
                <p className="text-[10px] font-mono font-bold text-ink-200 tracking-widest uppercase">
                  Video Pengirim — Slide Terakhir
                </p>
                <span className="text-[10px] font-mono text-brand-400 bg-brand-950/60 border border-brand-800/60 px-2 py-0.5 rounded-md">
                  CAROUSEL
                </span>
              </div>

              {videoHilang ? (
                <p className="text-[11px] font-mono text-amber-400 leading-relaxed">
                  File video tidak ditemukan di server. Post ke IG tetap bisa —
                  kartu tayang tanpa video.
                </p>
              ) : (
                <>
                  <video
                    src={urlAset(menfes.videoUrl)}
                    controls
                    playsInline
                    onError={() => setVideoHilang(true)}
                    className="w-full max-h-56 rounded-lg bg-ink-900 border border-ink-600"
                  />
                  <p className="text-[10px] text-ink-200 font-mono mt-1.5">
                    Sudah berframe dan sudah MP4 H.264 dari Cloudinary — file
                    yang sama dengan yang dikirim ke Instagram. Unduh untuk
                    post manual.
                  </p>
                  <button
                    type="button"
                    onClick={handleDownloadVideo}
                    disabled={videoDownloading || sibuk}
                    className="mt-2 w-full btn-secondary font-mono text-xs flex items-center justify-center gap-2 py-2.5 touch-manipulation disabled:opacity-40"
                  >
                    {videoDownloading ? (
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
                        Download Video
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Lagu pilihan — info (thumb, judul, artist, durasi) + icon
              putar/jeda. Tampilannya sama dengan blok info di kartu detail;
              audionya dari iframe tersembunyi sehingga TIDAK ada wujud player
              YouTube yang muncul. Lagu tidak pernah ikut ke caption/gambar. */}
          {menfes?.music && (
            <div className="bg-ink-800 border border-ink-600 rounded-xl p-3">
              <p className="text-[10px] font-mono font-bold text-ink-200 tracking-widest uppercase mb-2">
                Lagu Pilihan
              </p>
              <div className="flex items-center gap-3">
                {menfes.music.thumb ? (
                  <img
                    src={menfes.music.thumb}
                    alt=""
                    className="w-14 h-14 rounded-lg object-cover border border-ink-600 bg-ink-900 shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-lg border border-ink-600 bg-ink-900 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm text-parchment-200 font-semibold truncate">
                    {menfes.music.title}
                  </p>
                  <p className="text-[11px] text-ink-300 truncate">
                    {menfes.music.artist}
                    {durasiTeks ? ` · ${durasiTeks}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={putar ? 'Hentikan lagu' : 'Putar lagu'}
                  title={putar ? 'Hentikan' : 'Putar'}
                  className="shrink-0 w-11 h-11 rounded-lg border border-brand-600 text-brand-400 hover:bg-brand-600/10 flex items-center justify-center transition-colors touch-manipulation"
                >
                  {putar ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 translate-x-[1px]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {player}
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