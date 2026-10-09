import { useEffect, useRef, useState } from 'react';
import { musicAPI } from '../api';
import usePreviewLagu from '../hooks/usePreviewLagu';

function fmtDurasi(d) {
  if (typeof d !== 'number' || !Number.isFinite(d)) return null;
  return `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
}

// ── Step "Musik" pada wizard menfess ─────────────────────────────────────────
// Cari lagu lewat backend, klik satu hasil -> langsung bunyi. Tampilan TIDAK
// PERNAH berpindah ke player YouTube: daftar pencarian tetap di layar, audio
// bunyi dari iframe resmi YouTube (youtube-nocookie) yang dirender tersembunyi
// (sr-only) selama state `putar` aktif — autoplay = gesture klik, dan lagu
// diputar UTUH (tanpa batas `end`), berhenti sendiri saat durasi habis.
// Kontrol jeda/lanjut cuma satu: icon SVG di thumbnail strip lagu terpilih.
// Pilihan tetap murni referensi admin di dashboard; tidak ada audio yang
// lewat server kita.
export default function MusicPicker({ value, onChange, disabled = false, aktif = true }) {
  const [q, setQ] = useState('');
  const [hasil, setHasil] = useState([]);
  const [cari, setCari] = useState(false);
  const [gagal, setGagal] = useState(false);
  const [kosong, setKosong] = useState(false);
  const seq = useRef(0);

  // Durasi lagu dari snapshot pencarian (detik) — batas berhenti sendiri
  // di dalam hook. Kalau null (duration hilang), tanpa auto-stop.
  const durasiDetik =
    value && typeof value.duration === 'number' && Number.isFinite(value.duration)
      ? value.duration
      : null;

  // Seluruh logika bunyi (jeda/lanjut/posisi/timer/iframe) ada di hook —
  // dipakai bareng ExportModal supaya cuma ada SATU implementasi.
  const { putar, toggle, ulang, player } = usePreviewLagu({
    videoId: value ? value.videoId : null,
    judul: value ? value.title : '',
    durasiDetik,
    aktif,
  });

  // Pilih lagu di daftar: posisi direset, langsung bunyi dari detik 0.
  const pilihLagu = (s) => {
    onChange(s);
    ulang();
  };

  // Debounce 400ms: mengetik "tulus manusia baik" cukup memicu SATU request
  // (yang terakhir), bukan satu per ketukan. `seq` menjamin respons
  // pencarian lama yang tiba belakangan tidak menimpa yang baru.
  useEffect(() => {
    const kata = q.trim();
    if (kata.length < 2) {
      // Naikkan seq SEKALIGUS: request lama yang masih in-flight harus jadi
      // basi — kalau tidak, hasil query sebelumnya bisa muncul kembali di
      // bawah input yang sudah dikosongkan.
      seq.current += 1;
      setCari(false);
      setHasil([]);
      setKosong(false);
      setGagal(false);
      return undefined;
    }
    const nomor = ++seq.current;
    const timer = setTimeout(async () => {
      setCari(true);
      setGagal(false);
      setKosong(false);
      try {
        const res = await musicAPI.cari(kata);
        if (nomor !== seq.current) return; // respons basi
        // axios menaruh body di res.data; body endpoint itu { data: [...] },
        // jadi daftar hasilnya di res.data.data (bukan res.data).
        const data = (res.data && res.data.data) || [];
        setHasil(data);
        setKosong(data.length === 0);
      } catch {
        if (nomor !== seq.current) return;
        setGagal(true);
      } finally {
        if (nomor === seq.current) setCari(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [q]);

  const durasi = value ? fmtDurasi(value.duration) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-700 dark:text-parchment-300 font-mono uppercase tracking-widest">
          Musik — Opsional
        </p>
        <span className="text-[10px] font-mono text-ink-500 dark:text-ink-200 border border-parchment-300 dark:border-ink-600 px-2 py-0.5 rounded-md">
          {value ? 'TERPILIH' : 'BOLEH DILEWATI'}
        </span>
      </div>

      <p className="text-[11px] text-ink-500 dark:text-parchment-400 font-mono leading-relaxed">
        Cari musik yang diinginkan olehmu.
      </p>

      {/* Strip lagu terpilih — tampilan TIDAK pernah berganti ke player
          YouTube; daftar pencarian tetap di bawah, audio bunyi dari iframe
          tersembunyi (sr-only) yang dirender saat `putar` aktif. */}
      {value && (
        <div className="flex items-center gap-3 p-2.5 rounded-xl border border-brand-600/40 dark:border-brand-500/40 bg-parchment-100 dark:bg-ink-800">
          <div className="relative w-12 h-12 shrink-0">
            {value.thumb ? (
              <img
                src={value.thumb}
                alt=""
                className="w-12 h-12 rounded-lg object-cover bg-parchment-200 dark:bg-ink-900"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-parchment-200 dark:bg-ink-900" />
            )}
            {/* Overlay putar/jeda di atas thumbnail — satu-satunya kontrol audio */}
            <button
              type="button"
              onClick={toggle}
              disabled={disabled}
              aria-label={putar ? 'Jeda preview' : 'Putar preview'}
              className="absolute inset-0 w-12 h-12 rounded-lg flex items-center justify-center bg-ink-900/55 hover:bg-ink-900/70 transition-colors"
            >
              {putar ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  className="w-5 h-5 text-parchment-100"
                >
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  className="w-5 h-5 text-parchment-100 translate-x-[1px]"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 dark:text-parchment-100 truncate">
              {value.title}
            </p>
            <p className="text-xs text-ink-500 dark:text-parchment-400 truncate">
              {value.artist}
              {durasi ? ` · ${durasi}` : ''}
            </p>
          </div>
          {/* Hapus: buang pilihan; daftar hasil dan query sengaja
              dipertahankan supaya user tinggal klik lagu lain. */}
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="shrink-0 text-xs font-mono font-semibold px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
          >
            Hapus
          </button>
        </div>
      )}

      {/* Player audio tersembunyi dari hook (tanpa `end`: lagu diputar utuh) */}
      {player}

      <div className="space-y-2">
        <input
          id="music-cari"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari lagu, mis. tulus manusia baik"
          disabled={disabled}
          maxLength={100}
          autoComplete="off"
          className="input-field font-mono text-sm"
        />

        {gagal && (
          <p className="text-xs font-mono text-red-500 dark:text-red-400">
            Lagu lagi gangguan. Coba lagi beberapa saat.
          </p>
        )}
        {cari && (
          <p className="text-xs font-mono text-ink-400 dark:text-parchment-400">Mencari...</p>
        )}
        {!cari && !gagal && kosong && (
          <p className="text-xs font-mono text-ink-400 dark:text-parchment-400">
            Lagu tidak ditemukan. Coba kata kunci lain.
          </p>
        )}

        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
          {hasil.map((s) => (
            <li key={s.videoId}>
              <button
                type="button"
                onClick={() => pilihLagu(s)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 p-2 rounded-lg border text-left transition-colors ${
                  value && value.videoId === s.videoId
                    ? 'border-brand-500 bg-brand-600/10 dark:bg-brand-500/15'
                    : 'border-parchment-300 dark:border-ink-600 hover:border-brand-500 hover:bg-parchment-200/50 dark:hover:bg-ink-700/50'
                }`}
              >
                {s.thumb ? (
                  <img
                    src={s.thumb}
                    alt=""
                    className="w-10 h-10 rounded-md object-cover bg-parchment-200 dark:bg-ink-900 shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-md bg-parchment-200 dark:bg-ink-900 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink-900 dark:text-parchment-100 truncate">
                    {s.title}
                  </span>
                  <span className="block text-[11px] text-ink-500 dark:text-parchment-400 truncate">
                    {s.artist}
                    {fmtDurasi(s.duration) ? ` · ${fmtDurasi(s.duration)}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
