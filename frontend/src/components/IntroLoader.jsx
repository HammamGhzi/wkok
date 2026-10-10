import { useEffect, useState } from 'react';
import './IntroLoader.css';

const INTRO_DURATION = 2400;

export default function IntroLoader() {
  const [visible, setVisible] = useState(true);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const closeTimer = window.setTimeout(() => setClosing(true), INTRO_DURATION - 500);
    const removeTimer = window.setTimeout(() => setVisible(false), INTRO_DURATION);

    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(removeTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className={`intro-loader${closing ? ' intro-loader--closing' : ''}`} role="status" aria-label="Membuka surat">
      <div className="intro-loader__scene" aria-hidden="true">
        <div className="intro-loader__letter">
          {/* Logo crimson: surat di intro selalu krem, jadi logo cream tidak akan terlihat */}
          <img className="intro-loader__logo" src="/template/logo-dark.png" alt="Logo Harkat Nekat" />
          <span className="intro-loader__letter-line" />
          <span className="intro-loader__letter-line intro-loader__letter-line--short" />
          <span className="intro-loader__letter-heart">♥</span>
        </div>
        <div className="intro-loader__envelope">
          <div className="intro-loader__envelope-back" />
          <div className="intro-loader__envelope-front" />
          <div className="intro-loader__flap" />
        </div>
      </div>
      <span className="intro-loader__dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}
