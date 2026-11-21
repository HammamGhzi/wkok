import { useEffect, useRef, useState } from 'react';
import './IntroLoader.css';

// phase:
//  'logo'    — logo muncul, nunggu klik
//  'mascot'  — maskot jalan (GIF sekali putar)
//  'closing' — fade out

// GIF total 3060ms sekali putar.
// Frame 6 (t=2160ms) = tangan mulai terangkat + mulut terbuka → audio mulai di sini
const GIF_DURATION    = 3060;  // ms — satu kali putar penuh
const AUDIO_DELAY     = 2160;  // ms — frame 6, tangan mulai melambai
const MASCOT_DURATION = GIF_DURATION + 600; // fade out langsung setelah GIF selesai

export default function IntroLoader() {
  const [visible, setVisible] = useState(true);
  const [phase,   setPhase]   = useState('logo');
  const startedRef = useRef(false);
  const audioRef   = useRef(null);

  const handleLogoClick = () => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Unlock audio context tepat di dalam event klik
    const audio = new Audio('/maskot-halo.mpeg');
    audio.volume = 1;
    audioRef.current = audio;

    setPhase('mascot');

    // Audio delay pas tangan melambai
    setTimeout(() => {
      audio.play().catch(() => {});
    }, AUDIO_DELAY);

    // Fade out setelah GIF selesai sekali putar + sedikit hold
    setTimeout(() => setPhase('closing'),  MASCOT_DURATION - 600);
    setTimeout(() => setVisible(false),    MASCOT_DURATION);
  };

  if (!visible) return null;

  return (
    <div className={`intro-loader intro-loader--${phase}`} role="status" aria-label="Memuat halaman">

      {/* ── FASE LOGO ─────────────────────────────────────────────────── */}
      {(phase === 'logo') && (
        <div className="intro-logo" onClick={handleLogoClick}>
          <img
            src="/template/logo-dark.png"
            alt="Harkat Nekat"
            className="intro-logo__img"
            draggable={false}
          />
          <p className="intro-logo__sub">Klik untuk melanjutkan</p>
        </div>
      )}

      {/* ── FASE MASKOT ───────────────────────────────────────────────── */}
      {(phase === 'mascot' || phase === 'closing') && (
        <>
          <div className="mascot-wrap">
            <img
              src="/maskot.gif"
              alt="Maskot"
              className="mascot-img"
              draggable={false}
            />
          </div>
          <span className="intro-loader__dots" aria-hidden="true">
            <i /><i /><i />
          </span>
        </>
      )}

    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MascotGif — tampilkan GIF sekali putar lalu freeze di frame terakhir
   Caranya: setelah GIF_DURATION ms, ganti src ke PNG statis (frame terakhir)
───────────────────────────────────────────────────────────────────────────── */
function MascotGif() {
  const [src, setSrc] = useState('/maskot.gif');

  useEffect(() => {
    // Setelah sekali putar penuh, freeze ke PNG statis
    const t = setTimeout(() => setSrc('/maskot.png'), GIF_DURATION);
    return () => clearTimeout(t);
  }, []);

  return (
    <img
      src={src}
      alt="Maskot"
      className="mascot-img"
      draggable={false}
    />
  );
}
