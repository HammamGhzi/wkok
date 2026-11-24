import { useState, useRef, useEffect } from 'react';
import { chatbotAPI } from '../api';
import maskot from '../assets/chatbot-mascot.png';

const PESAN_SAMBUTAN = {
  dari: 'bot',
  teks: 'Halo! Aku Katt. Ada yang bisa aku bantu soal cara pakai web ini?',
};

const SARAN_PERTANYAAN = [
  'Cara kirim menfes?',
  'Jam berapa buka?',
  'Boleh kirim foto?',
  'Menfes anonim ngga?',
];

export default function ChatbotWidget() {
  const [buka, setBuka] = useState(false);
  const [pesan, setPesan] = useState([PESAN_SAMBUTAN]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sudahSapa, setSudahSapa] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll ke pesan terbaru
  useEffect(() => {
    if (buka) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [pesan, buka]);

  // Fokus input hanya di desktop, bukan mobile (supaya keyboard HP tidak
  // langsung muncul saat overlay dibuka)
  useEffect(() => {
    if (buka && window.matchMedia('(hover: hover)').matches) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [buka]);

  async function kirim(teks) {
    const q = (teks || input).trim();
    if (!q || loading) return;

    setInput('');
    setPesan((prev) => [...prev, { dari: 'user', teks: q }]);
    setLoading(true);

    try {
      const res = await chatbotAPI.tanya(q);
      setPesan((prev) => [...prev, { dari: 'bot', teks: res.data.jawaban }]);
    } catch {
      setPesan((prev) => [
        ...prev,
        { dari: 'bot', teks: 'Waduh, ada gangguan koneksi. Coba lagi ya!' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      kirim();
    }
  }

  function toggleBuka() {
    setBuka((v) => !v);
    if (!sudahSapa) setSudahSapa(true);
  }

  return (
    <>
      {/* Tombol trigger pojok kanan bawah */}
      <button
        onClick={toggleBuka}
        aria-label="Buka asisten"
        className="fixed bottom-5 right-5 z-50 w-16 h-16 rounded-full shadow-lg
                   transition-transform duration-200 hover:scale-110 active:scale-95
                   focus:outline-none focus:ring-2 focus:ring-brand-400"
      >
        <img
          src={maskot}
          alt="Asisten Harkat Nekat"
          className="w-full h-full object-contain rounded-full"
        />
        {/* Badge notif kecil saat pertama kali */}
        {!sudahSapa && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full
                           animate-bounce border-2 border-white" />
        )}
      </button>

      {/* Panel chat */}
      <div
        className={`fixed bottom-24 right-5 z-50 w-80 sm:w-96 flex flex-col
                    rounded-2xl shadow-2xl overflow-hidden
                    bg-white dark:bg-ink-800
                    border border-parchment-200 dark:border-ink-700
                    transition-all duration-300 origin-bottom-right
                    ${buka ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-90 pointer-events-none'}`}
        style={{ maxHeight: '70vh' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3
                        bg-brand-700 dark:bg-brand-800">
          <img src={maskot} alt="" className="w-9 h-9 object-contain rounded-full" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">Katt</p>
            <p className="text-xs text-brand-200">FAQ · Cara pakai web</p>
          </div>
          <button
            onClick={() => setBuka(false)}
            aria-label="Tutup"
            className="text-white/70 hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Riwayat pesan */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-parchment-50 dark:bg-ink-900">
          {pesan.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.dari === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.dari === 'bot' && (
                <img src={maskot} alt="" className="w-7 h-7 object-contain rounded-full mr-2 self-end flex-shrink-0" />
              )}
              <div
                className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm whitespace-pre-line leading-relaxed
                  ${m.dari === 'user'
                    ? 'bg-brand-700 text-white rounded-br-sm'
                    : 'bg-white dark:bg-ink-700 text-ink-800 dark:text-parchment-100 rounded-bl-sm shadow-sm border border-parchment-100 dark:border-ink-600'
                  }`}
              >
                {m.teks}
              </div>
            </div>
          ))}

          {/* Loading bubble */}
          {loading && (
            <div className="flex justify-start">
              <img src={maskot} alt="" className="w-7 h-7 object-contain rounded-full mr-2 self-end flex-shrink-0" />
              <div className="bg-white dark:bg-ink-700 border border-parchment-100 dark:border-ink-600
                              px-4 py-3 rounded-2xl rounded-bl-sm shadow-sm flex gap-1 items-center">
                <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Saran pertanyaan — hanya tampil kalau baru 1 pesan (sambutan) */}
        {pesan.length === 1 && (
          <div className="px-4 py-2 flex flex-wrap gap-2 bg-parchment-50 dark:bg-ink-900 border-t border-parchment-100 dark:border-ink-700">
            {SARAN_PERTANYAAN.map((s) => (
              <button
                key={s}
                onClick={() => kirim(s)}
                className="text-xs px-3 py-1 rounded-full border border-brand-300 dark:border-brand-600
                           text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900
                           transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="px-3 py-3 bg-white dark:bg-ink-800 border-t border-parchment-100 dark:border-ink-700 flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ketik pertanyaanmu..."
            maxLength={300}
            disabled={loading}
            className="flex-1 text-sm px-3 py-2 rounded-xl border border-parchment-200 dark:border-ink-600
                       bg-parchment-50 dark:bg-ink-700 text-ink-800 dark:text-parchment-100
                       placeholder-ink-400 dark:placeholder-ink-400
                       focus:outline-none focus:ring-2 focus:ring-brand-400
                       disabled:opacity-50 transition"
          />
          <button
            onClick={() => kirim()}
            disabled={!input.trim() || loading}
            aria-label="Kirim"
            className="w-9 h-9 flex items-center justify-center rounded-xl
                       bg-brand-700 hover:bg-brand-800 disabled:opacity-40
                       text-white transition-colors flex-shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M3.105 3.105a.75.75 0 0 1 .814-.156l13 5.5a.75.75 0 0 1 0 1.382l-13 5.5a.75.75 0 0 1-1.03-.911L4.98 10 2.89 4.58a.75.75 0 0 1 .215-.475Z" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
