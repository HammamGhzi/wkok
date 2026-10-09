import { useEffect, useRef, useState } from 'react';
import { musicAPI } from '../api';

function fmtDurasi(d) {
  if (typeof d !== 'number' || !Number.isFinite(d)) return null;
  return `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
}

// ── Step "Musik" pada wizard menfess ─────────────────────────────────────────
// Cari lagu lewat backend, pilih satu hasil. Lagu TIDAK diputar di sini:
// pilihan ini murni referensi admin di dashboard, dan preview-nya memakai
// embed resmi YouTube di sana (berhenti sendiri di detik ke-30).
export default function MusicPicker({ value, onChange, disabled = false }) {
  const [q, setQ] = useState('');
  const [hasil, setHasil] = useState([]);
  const [cari, setCari] = useState(false);
  const [gagal, setGagal] = useState(false);
  const [kosong, setKosong] = useState(false);
  const seq = useRef(0);

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
        Pilih satu lagu sebagai referensi admin. Cuma judul dan thumbnail yang
        disimpan — tidak ada audio yang diunggah ke server.
      </p>

      {value ? (
        <div className="rounded-xl border border-parchment-300 dark:border-ink-600 overflow-hidden">
          <div className="flex items-center gap-3 p-2.5 bg-parchment-100 dark:bg-ink-800">
            {value.thumb ? (
              <img
                src={value.thumb}
                alt=""
                className="w-12 h-12 rounded-lg object-cover bg-parchment-200 dark:bg-ink-900"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-parchment-200 dark:bg-ink-900" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-900 dark:text-parchment-100 truncate">
                {value.title}
              </p>
              <p className="text-xs text-ink-500 dark:text-parchment-400 truncate">
                {value.artist}
                {durasi ? ` · ${durasi}` : ''}
              </p>
            </div>
          </div>
          <div className="flex gap-2 p-2 bg-parchment-100 dark:bg-ink-800 border-t border-parchment-300 dark:border-ink-600">
            {/* Ganti: kembali ke daftar hasil dengan query yang masih ada. */}
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled}
              className="flex-1 text-xs font-mono font-semibold py-2 rounded-lg border border-parchment-300 dark:border-ink-600 text-ink-700 dark:text-parchment-300 hover:bg-parchment-200 dark:hover:bg-ink-700 transition-colors"
            >
              Ganti
            </button>
            {/* Hapus: bersihkan pilihan SEKALIGUS query dan hasil. */}
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setQ('');
                setHasil([]);
              }}
              disabled={disabled}
              className="flex-1 text-xs font-mono font-semibold py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            >
              Hapus
            </button>
          </div>
        </div>
      ) : (
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
                  onClick={() => onChange(s)}
                  disabled={disabled}
                  className="w-full flex items-center gap-3 p-2 rounded-lg border border-parchment-300 dark:border-ink-600 text-left hover:border-brand-500 hover:bg-parchment-200/50 dark:hover:bg-ink-700/50 transition-colors"
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
      )}
    </div>
  );
}
