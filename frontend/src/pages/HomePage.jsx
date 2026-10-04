import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { menfesAPI } from '../api';
import { TEMPLATES, getTemplateById } from '../config/templates';
import TemplatePreview from '../components/TemplatePreview';

const MAX_CHARS = 500;
const MAX_NAME = 30;

export default function HomePage() {
  const [message, setMessage] = useState('');
  const [isAnon, setIsAnon] = useState(true);
  const [senderName, setSenderName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('template1');
  const [showPreview, setShowPreview] = useState(true); // Default tampil agar user langsung melihat bentuk aslinya
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [lastSubmittedTemplate, setLastSubmittedTemplate] = useState('Template 1');
  const [step, setStep] = useState(1);
  const [darkMode, setDarkMode] = useState(false);

  const selectedTemplate = getTemplateById(selectedTemplateId);
  const remaining = MAX_CHARS - message.length;

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length < 5) {
      toast.error('Pesan minimal 5 karakter ya!');
      return;
    }
    if (!isAnon && senderName.trim().length === 0) {
      toast.error('Tulis nama kamu dulu!');
      return;
    }

    setSubmitting(true);
    try {
      await menfesAPI.submit({
        message: trimmed,
        senderName: isAnon ? null : senderName.trim(),
        senderInfo: selectedTemplate.name,
      });
      setLastSubmittedTemplate(selectedTemplate.name);
      setSubmitted(true);
      setMessage('');
      setSenderName('');
      toast.success('Menfess terkirim! Menunggu persetujuan admin.');
    } catch (err) {
      const msg = err.response?.data?.error || 'Gagal mengirim menfes. Coba lagi.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSubmitted(false);
    setMessage('');
    setSenderName('');
    setIsAnon(true);
    setSelectedTemplateId('template1');
    setShowPreview(true);
    setStep(1);
  }

  const stepTitles = {
    1: 'Pilih Template',
    2: 'Isi Pesan',
    3: 'Tampil Sebagai',
  };

  return (
    <div className="min-h-screen bg-parchment-100 dark:bg-ink-800">
      {/* Header */}
      <header className="bg-white/95 dark:bg-ink-900/95 backdrop-blur-sm border-b border-parchment-300 dark:border-ink-600 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/template/logo.jpg" alt="Logo" className="w-7 h-7 rounded-full border border-parchment-300 dark:border-ink-500 object-cover" />
            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight leading-none">
              <span className="text-ink-900 dark:text-parchment-200">HARKAT</span>{' '}
              <span className="text-brand-600 relative">
                NEKATT
                <span className="absolute -bottom-0.5 left-0 right-0 h-[2px] bg-brand-700 rounded-full" />
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDarkMode(v => !v)}
              className="flex items-center gap-1.5 text-[11px] font-mono text-ink-500 dark:text-ink-200 bg-parchment-100 dark:bg-ink-800 border border-parchment-300 dark:border-ink-400 px-2.5 py-1 rounded-full"
            >
              {darkMode ? 'Light' : 'Dark'}
            </button>
            <span className="text-[11px] font-mono text-ink-500 dark:text-ink-200 bg-parchment-100 dark:bg-ink-800 border border-parchment-300 dark:border-ink-400 px-2.5 py-1 rounded-full">
              Menfess Kampus
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Hero */}
        <div className="text-center space-y-2 sm:space-y-3 py-2 sm:py-4">
          <p className="text-ink-500 dark:text-parchment-500 font-mono text-[10px] sm:text-xs tracking-[0.2em] sm:tracking-[0.25em] uppercase">
            The pen is mightier than the sword.
          </p>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            <span className="text-ink-900 dark:text-parchment-100">Kirim </span>
            <span className="text-brand-600">Menfess</span>
          </h2>
          <p className="text-xs sm:text-sm text-ink-700 dark:text-parchment-300 max-w-md mx-auto">
            Pilih template desain kesukaanmu, tulis pesan, dan lihat pratinjau langsung!
          </p>
        </div>

        {/* Form */}
        {!submitted ? (
          <div className="card border-parchment-300 dark:border-ink-600 p-4 sm:p-6 space-y-5">
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Mobile wizard steps */}
              <div className="sm:hidden flex items-center gap-2 mb-4">
                {[1, 2, 3].map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => setStep(s)}
                    className={`w-8 h-8 rounded-full text-xs font-mono font-bold border transition-colors ${
                      step === s
                        ? 'bg-brand-700 border-brand-600 text-ink-900 dark:text-parchment-100'
                        : 'bg-parchment-100 dark:bg-ink-800 border-parchment-300 dark:border-ink-600 text-ink-400 dark:text-ink-300 hover:text-ink-700 dark:text-parchment-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <span className="ml-2 text-xs text-ink-400 dark:text-ink-300 font-mono">{stepTitles[step]}</span>
              </div>

              {/* 1. Pilih Template Menfess */}
              <div className={`space-y-2.5 ${step === 1 ? '' : 'hidden sm:block'}`}>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-ink-700 dark:text-parchment-300 font-mono uppercase tracking-widest">
                    Pilih Template Desain
                  </label>
                  <span className="text-[11px] font-mono text-ink-900 dark:text-parchment-100 bg-parchment-200 dark:bg-ink-800 border border-parchment-400 dark:border-ink-600 px-2.5 py-0.5 rounded-md font-semibold">
                    {selectedTemplate.name}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                  {TEMPLATES.map((tmpl) => {
                    const isSelected = tmpl.id === selectedTemplateId;
                    return (
                      <button
                        key={tmpl.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(tmpl.id)}
                        className={`relative p-2 rounded-xl border text-left transition-all duration-200 flex flex-col items-center gap-2 group ${
                          isSelected
                            ? 'bg-parchment-100 dark:bg-ink-800 border-brand-500 ring-2 ring-brand-500/40 shadow-xl scale-[1.02]'
                            : 'bg-parchment-100 dark:bg-ink-800/80 border-parchment-400 dark:border-ink-600 hover:border-parchment-400 dark:border-ink-500 hover:bg-parchment-200 dark:hover:bg-ink-800 opacity-85 hover:opacity-100'
                        }`}
                      >
                        {/* Thumbnail image portrait agar terlihat jelas wujud aslinya */}
                        <div className="w-full aspect-[3/4] rounded-lg overflow-hidden bg-black/60 border border-parchment-300 dark:border-ink-600 flex items-center justify-center relative shadow-inner">
                          <img
                            src={tmpl.thumbnail}
                            alt={tmpl.name}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            onError={(e) => {
                              if (tmpl.fallbackSrc) e.target.src = tmpl.fallbackSrc;
                            }}
                          />
                          {isSelected && (
                            <div className="absolute inset-0 bg-brand-900/15 border-2 border-brand-500 rounded-lg pointer-events-none" />
                          )}
                        </div>

                        {/* Text info dengan warna kontras */}
                        <div className="text-center w-full px-0.5">
                          <p className={`text-xs font-mono font-bold truncate ${isSelected ? 'text-ink-900 dark:text-parchment-100' : 'text-ink-700 dark:text-parchment-300'}`}>
                            {tmpl.badge}
                          </p>
                          <p className="text-[10px] text-ink-600 dark:text-parchment-400 font-mono truncate font-medium">
                            {tmpl.tag}
                          </p>
                        </div>

                        {/* Selected badge */}
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-brand-600 text-white rounded-full flex items-center justify-center text-[10px] shadow-sm">
                            ✓
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between text-xs font-mono pt-0.5">
                  <p className="text-ink-600 dark:text-parchment-400 text-[11px]">
                    {selectedTemplate.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowPreview(!showPreview)}
                    className="text-brand-400 hover:text-brand-300 font-semibold transition-colors flex items-center gap-1 text-[11px] shrink-0 ml-2"
                  >
                    <span>{showPreview ? '▼ Sembunyikan Pratinjau' : '▶ Lihat Pratinjau Gambar Asli'}</span>
                  </button>
                </div>
              </div>

              {/* 2. Pratinjau Langsung Gambar Template Asli */}
              {showPreview && (step === 1 || step === 2 || step === 3) && (
                <div className="p-3.5 sm:p-4 rounded-xl bg-parchment-100 dark:bg-ink-900/90 border border-parchment-400 dark:border-ink-600 space-y-2 animate-fadeIn">
                  <div className="flex items-center justify-between border-b border-parchment-300 dark:border-ink-700 pb-2">
                    <p className="text-[11px] font-mono font-bold text-ink-700 dark:text-parchment-300 uppercase tracking-widest">
                      Pratinjau Template Nyata ({selectedTemplate.name})
                    </p>
                    <span className="text-[10px] font-mono text-ink-500 dark:text-ink-200">
                      Live Canvas
                    </span>
                  </div>

                  <TemplatePreview
                    template={selectedTemplate}
                    message={message}
                    senderName={senderName}
                    isAnon={isAnon}
                    className="pt-1 pb-1"
                  />
                </div>
              )}

              {/* 3. Isi Pesan */}
              <div className={`${step === 2 ? '' : 'hidden sm:block'}`}>
                <label
                  htmlFor="message"
                  className="block text-xs font-semibold text-ink-700 dark:text-parchment-300 mb-2 font-mono uppercase tracking-widest"
                >
                  Pesan Menfess
                </label>
                <div className="relative">
                  <textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tulis pesan menfess kamu di sini..."
                    rows={5}
                    maxLength={MAX_CHARS}
                    className="input-field resize-none font-mono text-sm pb-8"
                    disabled={submitting}
                    aria-label="Isi pesan menfess"
                    style={{ fontSize: '16px' /* cegah zoom iOS */ }}
                  />
                  <span className={`absolute right-3 bottom-2 text-[11px] font-mono ${remaining < 50 ? 'text-brand-500 font-bold' : 'text-ink-600 dark:text-parchment-400'}`}>
                    {remaining}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs mt-1 font-mono">
                  <span className="text-[11px] text-ink-500 dark:text-ink-200">
                    Teks otomatis di-wrap ke template di atas
                  </span>
                  <span className="text-ink-600 dark:text-parchment-400 text-[11px]">
                    {MAX_CHARS - message.length}/{MAX_CHARS}
                  </span>
                </div>
              </div>

              {/* 4. Pilihan Pengirim */}
              <div className={`space-y-3 ${step === 3 ? '' : 'hidden sm:block'}`}>
                <p className="text-xs font-semibold text-ink-700 dark:text-parchment-300 font-mono uppercase tracking-widest">
                  Tampil Sebagai
                </p>

                {/* Toggle anonim / nama sendiri */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAnon(true)}
                    className={`py-3 sm:py-2.5 px-3 rounded-xl border text-xs font-mono font-semibold transition-all ${
                      isAnon
                        ? 'bg-brand-700 border-brand-600 text-ink-900 dark:text-parchment-100 shadow-md'
                        : 'bg-parchment-100 dark:bg-ink-800 border-parchment-300 dark:border-ink-600 text-ink-600 dark:text-parchment-400 hover:text-ink-900 dark:text-parchment-200 hover:border-parchment-300 dark:border-ink-500'
                    }`}
                  >
                    Dari Seseorang (Anonim)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAnon(false)}
                    className={`py-3 sm:py-2.5 px-3 rounded-xl border text-xs font-mono font-semibold transition-all ${
                      !isAnon
                        ? 'bg-brand-700 border-brand-600 text-ink-900 dark:text-parchment-100 shadow-md'
                        : 'bg-parchment-100 dark:bg-ink-800 border-parchment-300 dark:border-ink-600 text-ink-600 dark:text-parchment-400 hover:text-ink-900 dark:text-parchment-200 hover:border-parchment-300 dark:border-ink-500'
                    }`}
                  >
                    Tulis Nama
                  </button>
                </div>

                {/* Input nama jika tidak anonim */}
                {!isAnon && (
                  <div>
                    <input
                      type="text"
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      placeholder="Nama kamu / inisial..."
                      maxLength={MAX_NAME}
                      className="input-field font-mono text-sm"
                      disabled={submitting}
                      aria-label="Nama pengirim"
                      autoFocus
                      style={{ fontSize: '16px' /* cegah zoom iOS */ }}
                    />
                    <div className="text-right text-xs mt-1 font-mono text-ink-600 dark:text-parchment-400">
                      {MAX_NAME - senderName.length} karakter tersisa
                    </div>
                  </div>
                )}
              </div>

              {/* Wizard navigation - mobile only */}
              <div className="flex items-center justify-between sm:hidden pt-2">
                {step > 1 && (
                  <button
                    type="button"
                    onClick={() => setStep(step - 1)}
                    className="text-xs font-mono text-ink-400 dark:text-ink-300 hover:text-ink-900 dark:text-parchment-200"
                  >
                    ← Kembali
                  </button>
                )}
                {step < 3 && (
                  <button
                    type="button"
                    onClick={() => setStep(step + 1)}
                    className="ml-auto px-4 py-2 bg-brand-700 text-white dark:text-parchment-100 text-xs font-mono font-semibold rounded-lg"
                  >
                    Lanjut →
                  </button>
                )}
              </div>

                {/* Info Privasi */}
              <div className={`bg-parchment-100 dark:bg-ink-800/90 border border-parchment-400 dark:border-ink-600 rounded-xl p-3 ${step === 3 ? '' : 'hidden sm:block'}`}>
                <p className="text-xs text-ink-700 dark:text-parchment-300 flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>Identitasmu <strong className="text-ink-900 dark:text-parchment-100 font-semibold">100% aman & anonim untuk Instagram</strong> (nama akan muncul di bawah cerita menfess ini)</span>
                </p>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting || message.trim().length < 5 || (!isAnon && !senderName.trim())}
                className={`btn-primary w-full text-center font-mono tracking-widest py-3.5 sm:py-3 shadow-lg hover:shadow-brand-900/30 transition-shadow ${step === 3 ? '' : 'hidden sm:block'}`}
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    MENGIRIM...
                  </span>
                ) : `KIRIM DENGAN ${selectedTemplate.badge.toUpperCase()}`}
              </button>
            </form>
          </div>
        ) : (
          <div className="card text-center space-y-4 border-brand-800/40 p-6 sm:p-8">
            <svg className="w-12 h-12 text-brand-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <h3 className="text-xl font-bold text-ink-900 dark:text-parchment-200">Menfess Berhasil Dikirim!</h3>
            <p className="text-ink-700 dark:text-parchment-300 text-sm">
              Sedang menunggu persetujuan admin sebelum diexport ke Instagram feed.
            </p>
            <div className="inline-flex items-center gap-2 bg-parchment-100 dark:bg-ink-800 border border-parchment-300 dark:border-ink-600 px-3 py-1.5 rounded-full text-xs font-mono text-ink-700 dark:text-parchment-300">
              <span>Template:</span>
              <strong className="text-brand-400">{lastSubmittedTemplate}</strong>
            </div>
            <div>
              <button onClick={handleReset} className="btn-primary font-mono py-3.5 sm:py-3 w-full sm:w-auto px-8 mt-2">
                KIRIM LAGI
              </button>
            </div>
          </div>
        )}

      </main>

      <footer className="text-center py-6 sm:py-8 border-t border-parchment-300 dark:border-ink-700">
        <div className="w-16 h-0.5 bg-brand-700 mx-auto mb-4 rounded-full" />
        <p className="text-xs font-mono tracking-widest text-ink-500 dark:text-ink-200">
          © 2026{' '}
          <span className="font-semibold text-brand-400">HARKAT NEKATT</span>
          {' · EST. 2026'}
        </p>
      </footer>
    </div>
  );
}

