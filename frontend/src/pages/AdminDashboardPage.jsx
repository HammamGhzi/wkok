import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import { adminAPI, siteAPI, urlAset } from '../api';
import ExportModal from '../components/ExportModal';
import { TEMPLATES, parseTemplateFromMenfes, getTemplateById } from '../config/templates';
import { clampPage, paginationItems } from '../utils/pagination.js';

const STATUS_TABS = [
  { key: 'PENDING',  label: 'Menunggu'  },
  { key: 'APPROVED', label: 'Disetujui' },
  { key: 'REJECTED', label: 'Ditolak'   },
];

function formatDate(iso) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

// Bilah halaman kosong. Dipakai sebagai nilai awal dan saat pindah tab, supaya
// jumlah halaman dari tab sebelumnya tidak sempat terlihat.
function paginationKosong() {
  return { page: 1, limit: 20, total: 0, totalPages: 0 };
}

function StatusBadge({ status }) {
  const map = {
    PENDING:  { label: 'Menunggu',  cls: 'bg-amber-900/40 text-amber-400 border-amber-700/40' },
    APPROVED: { label: 'Disetujui', cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40' },
    REJECTED: { label: 'Ditolak',   cls: 'bg-brand-950/60 text-brand-400 border-brand-800/40' },
  };
  const { label, cls } = map[status] || map.PENDING;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono border ${cls}`}>
      {label}
    </span>
  );
}

// ── Lagu pilihan pengirim ────────────────────────────────────────────────────
// Tampil hanya kalau menfess membawa lagu. Preview memakai embed YouTube resmi
// dengan parameter end=30: player BERHENTI SENDIRI di detik ke-30 — yang
// terdengar cuma preview, dan tidak ada audio yang lewat server kita.
// Iframe dirender HANYA saat tombol Putar ditekan (dan dibuang saat
// dihentikan): tanpa autoplay, tanpa player yang terus berbunyi saat scroll.
function BlokMusik({ music }) {
  const [putar, setPutar] = useState(false);
  const durasi =
    typeof music.duration === 'number' && Number.isFinite(music.duration)
      ? `${Math.floor(music.duration / 60)}:${String(music.duration % 60).padStart(2, '0')}`
      : null;

  return (
    <div className="bg-ink-800 border border-ink-600 rounded-lg p-2.5 sm:p-3 space-y-2.5">
      <div className="flex items-start gap-3">
        {putar ? (
          <iframe
            className="w-40 h-24 sm:w-56 sm:h-32 rounded-lg border border-ink-600 bg-ink-900 shrink-0"
            src={`https://www.youtube-nocookie.com/embed/${music.videoId}?start=0&end=30&rel=0`}
            title={`Preview ${music.title}`}
            allow="accelerometer; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          music.thumb && (
            <img
              src={music.thumb}
              alt=""
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover border border-ink-600 bg-ink-900 shrink-0"
            />
          )
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono font-bold text-ink-200 tracking-widest uppercase mb-0.5">
            Lagu Pilihan
          </p>
          <p className="text-xs sm:text-sm text-parchment-200 font-semibold truncate">
            {music.title}
          </p>
          <p className="text-[11px] text-ink-300 truncate">
            {music.artist}
            {durasi ? ` · ${durasi}` : ''}
          </p>
          <p className="text-[10px] text-ink-400 font-mono mt-0.5">
            Preview 30 detik · embed YouTube
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPutar((p) => !p)}
        className="flex items-center gap-1.5 text-[11px] font-mono font-semibold px-3 py-1.5 rounded-lg border border-brand-600 text-brand-400 hover:bg-brand-600/10 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        {putar ? 'Hentikan' : 'Putar'}
      </button>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { admin, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('PENDING');
  const [menfes, setMenfes] = useState([]);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [exportTarget, setExportTarget] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(paginationKosong);
  const [deleteTarget, setDeleteTarget] = useState(null); // Custom confirm modal
  const [searchQuery, setSearchQuery] = useState(''); // Client-side search filter
  const [hoveredId, setHoveredId] = useState(null); // Untuk keyboard shortcuts
  const [selectedIds, setSelectedIds] = useState(new Set()); // Untuk bulk action
  const [bulkMode, setBulkMode] = useState(false); // Toggle mode bulk action
  const [situs, setSitus] = useState(null); // Status buka/tutup menfess (null = belum tahu)
  const [toggleSitus, setToggleSitus] = useState(false); // Sedang menulis status

  // Penjaga urutan permintaan. Klik tab berturut-turut bisa membuat respons
  // lama tiba setelah respons baru; hanya respons dari permintaan terakhir
  // yang boleh menyentuh tampilan.
  const reqSeq = useRef(0);

  const loadData = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    let memundurkan = false;
    try {
      const [statsRes, menfesRes] = await Promise.all([
        adminAPI.getStats(),
        adminAPI.getMenfes(activeTab, page),
      ]);
      if (seq !== reqSeq.current) return;
      const body = menfesRes.data;
      setStats(statsRes.data);
      setMenfes(body.data);
      setPagination(body.pagination ?? { page, limit: 20, total: body.data.length, totalPages: 1 });

      // Halaman bisa mendadak kosong setelah approve/reject/hapus menghabiskan
      // baris terakhirnya. Tarik mundur satu halaman; efek akan memuat ulang
      // dan mengulanginya sampai ada isi atau sampai halaman 1.
      if (body.data.length === 0 && page > 1) {
        memundurkan = true;
        setPage(clampPage(page - 1, body.pagination?.totalPages ?? page - 1));
      }
    } catch {
      if (seq === reqSeq.current) toast.error('Gagal memuat data.');
    } finally {
      // Saat memundurkan halaman, biarkan status memuat menyala supaya tidak
      // ada kedipan "tidak ada menfess" untuk halaman yang sebenarnya ada isinya.
      if (seq === reqSeq.current && !memundurkan) setLoading(false);
    }
  }, [activeTab, page]);

  useEffect(() => { loadData(); }, [loadData]);

  // Baca status buka/tutup sekali saat mount. Gagal membaca tidak perlu
  // ditampilkan — tombolnya memang sengaja disabled selama status belum tahu,
  // supaya admin tidak menekan toggle tanpa tahu posisi sakelarnya sekarang.
  useEffect(() => {
    siteAPI.getStatus()
      .then((res) => setSitus(res.data))
      .catch(() => {});
  }, []);

  // Toggle buka/tutup menfess untuk publik.
  //
  // Ditulis optimis: tampilan berubah duluan, request menyusul. Admin menekan
  // tombol kecil dengan harapan hasil langsung terlihat — kalau ternyata gagal,
  // tampilan dikembalikan dan pesan error muncul, jadi tidak pernah ada
  // indikator hijau yang berbohong tanpa penjelasan.
  async function handleToggleSitus() {
    if (!situs || toggleSitus) return;
    const buka = !situs.open;
    const sebelum = situs;
    setSitus({ ...situs, open: buka });
    setToggleSitus(true);
    try {
      await adminAPI.setSiteOpen(buka);
      toast.success(
        buka
          ? 'Menfess DIBUKA — publik bisa mengirim lagi.'
          : 'Menfess DITUTUP — publik melihat layar tutup.'
      );
    } catch (err) {
      setSitus(sebelum);
      toast.error(err.response?.data?.error || 'Gagal mengubah status menfess.');
    } finally {
      setToggleSitus(false);
    }
  }

  // Keyboard shortcuts (aksi pada card yang sedang di-hover/terakhir di-touch)
  useEffect(() => {
    function handleKey(e) {
      if (deleteTarget || exportTarget) return; // kalau ada modal, jangan shortcut
      if (hoveredId == null) return;
      const item = menfes.find((m) => m.id === hoveredId);
      if (!item) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 'a' && item.status !== 'APPROVED') { e.preventDefault(); handleApprove(item.id); }
      else if (k === 'r' && item.status !== 'APPROVED') { e.preventDefault(); handleReject(item.id); }
      else if (k === 'e' && item.status === 'APPROVED') { e.preventDefault(); setExportTarget(item); }
      else if (k === 'd') { e.preventDefault(); setDeleteTarget(item); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hoveredId, menfes, deleteTarget, exportTarget]);

  async function handleApprove(id) {
    setActionLoading(id + '_approve');
    try {
      await adminAPI.approve(id);
      toast.success('Menfess diapprove!');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Gagal approve.');
    } finally { setActionLoading(null); }
  }

  async function handleReject(id) {
    setActionLoading(id + '_reject');
    try {
      await adminAPI.reject(id);
      toast.success('Menfess direject.');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Gagal reject.');
    } finally { setActionLoading(null); }
  }

  async function handleRetry(id) {
    try {
      await prisma.menfes.update({
        where: { id },
        data: {
          igStatus: 'APPROVED',
          igMediaId: null,
          igPermalink: null,
          igError: null,
          igPublishedAt: null,
        },
      });
      toast.success('Status direset. Buka Export modal untuk publish ulang.');
      loadData();
    } catch (err) {
      toast.error('Gagal mereset status: ' + (err.response?.data?.error || err.message));
    }
  }

  async function handleDelete(id) {
    setActionLoading(id + '_delete');
    try {
      await adminAPI.delete(id);
      toast.success('Menfess dihapus.');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Gagal menghapus.');
    } finally {
      setActionLoading(null);
      setDeleteTarget(null);
    }
  }

  // Filter menfes berdasarkan search query (client-side, pada halaman yang sedang dimuat)
  const filteredMenfes = searchQuery.trim()
    ? menfes.filter((item) => {
        const q = searchQuery.toLowerCase();
        return (
          item.message?.toLowerCase().includes(q) ||
          item.senderName?.toLowerCase().includes(q) ||
          item.senderInfo?.toLowerCase().includes(q)
        );
      })
    : menfes;

  return (
    <div className="min-h-screen bg-ink-800">

      {/* ── Topbar ──────────────────────────────────────────────────── */}
      <header className="bg-ink-900 border-b border-ink-700 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-5 h-13 sm:h-14 flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-7 h-7 bg-brand-700 rounded flex items-center justify-center shrink-0">
              <span className="text-xs font-extrabold text-parchment-100 font-mono">HN</span>
            </div>
            <div className="min-w-0">
              <span className="font-extrabold text-parchment-100 tracking-tight text-sm truncate block">
                HARKAT <span className="text-brand-500">NEKATT</span>
              </span>
            </div>
            <span className="text-ink-200 font-mono text-xs hidden sm:inline shrink-0">/ Admin</span>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Sakelar buka/tutup menfess — posisi sakelar inilah yang
                dilihat publik lewat GET /api/site/status. Label = kondisi
                SAAT INI, bukan aksi, supaya tidak ambigu saat dibaca cepat. */}
            <button
              type="button"
              onClick={handleToggleSitus}
              disabled={!situs || toggleSitus}
              aria-pressed={situs ? !situs.open : undefined}
              title={
                !situs
                  ? 'Status belum dimuat'
                  : situs.open
                    ? 'Klik untuk menutup menfess bagi publik'
                    : 'Klik untuk membuka menfess bagi publik'
              }
              className={`flex items-center gap-1.5 text-xs font-mono font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg border transition-colors ${
                !situs
                  ? 'text-ink-400 border-ink-700 opacity-60 cursor-wait'
                  : situs.open
                    ? 'text-emerald-300 border-emerald-800/60 bg-emerald-950/40 hover:border-emerald-600 hover:text-emerald-200'
                    : 'text-red-300 border-red-800/60 bg-red-950/40 hover:border-red-600 hover:text-red-200'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  !situs ? 'bg-ink-500' : situs.open ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              />
              {situs ? (situs.open ? 'BUKA' : 'TUTUP') : '…'}
            </button>

            {/* Username — sembunyikan di hp sangat kecil */}
            <div className="hidden sm:flex items-center gap-2 bg-ink-800 border border-ink-700 rounded-lg px-3 py-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-mono text-ink-300 max-w-[100px] truncate">{admin?.username}</span>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-xs font-mono text-ink-200 hover:text-brand-400 transition-colors border border-ink-700 hover:border-brand-700/50 px-2.5 sm:px-3 py-1.5 rounded-lg"
            >
              <svg className="w-3.5 h-3.5 sm:w-3 sm:h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1" />
              </svg>
              <span className="hidden xs:inline">Logout</span>
            </button>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-brand-700/60 to-transparent" />
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-5 py-4 sm:py-6 space-y-4 sm:space-y-5">

        {/* ── Stats ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {[
            { label: 'Total',     value: stats.total,    accent: 'text-parchment-200', dot: 'bg-parchment-400' },
            { label: 'Menunggu',  value: stats.pending,  accent: 'text-amber-400',     dot: 'bg-amber-500' },
            { label: 'Disetujui', value: stats.approved, accent: 'text-emerald-400',   dot: 'bg-emerald-500' },
            { label: 'Ditolak',   value: stats.rejected, accent: 'text-brand-400',     dot: 'bg-brand-600' },
          ].map((s) => (
            <div key={s.label} className="bg-ink-700 border border-ink-600 rounded-xl p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
              <div className={`w-1.5 sm:w-2 h-7 sm:h-8 rounded-full ${s.dot} opacity-80 shrink-0`} />
              <div className="min-w-0">
                <div className={`text-xl sm:text-2xl font-extrabold font-mono leading-none ${s.accent}`}>{s.value}</div>
                <div className="text-[10px] sm:text-xs text-ink-200 font-mono mt-0.5 truncate">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabs + Refresh ──────────────────────────────────────────── */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Tab group */}
          <div className="flex gap-1 bg-ink-900 rounded-xl p-1 border border-ink-700 flex-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  if (tab.key === activeTab) return;
                  setActiveTab(tab.key);
                  setPage(1);
                  setPagination(paginationKosong());
                }}
                className={`flex-1 py-2.5 sm:py-2 px-1 sm:px-2 rounded-lg text-xs font-mono font-semibold tracking-wide transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
                  activeTab === tab.key
                    ? 'bg-brand-700 text-parchment-100 shadow-sm'
                    : 'text-ink-200 hover:text-parchment-300 hover:bg-ink-800'
                }`}
              >
                {tab.label}
                {tab.key === 'PENDING' && stats.pending > 0 && activeTab !== 'PENDING' && (
                  <span className="bg-amber-500 text-ink-900 text-[9px] sm:text-[10px] font-bold px-1 sm:px-1.5 rounded-full leading-none py-0.5">
                    {stats.pending}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Bulk mode toggle */}
          <button
            onClick={() => {
              setBulkMode((v) => !v);
              if (bulkMode) setSelectedIds(new Set()); // clear selection saat off
            }}
            title={bulkMode ? 'Matikan bulk action' : 'Aktifkan bulk action'}
            className={`w-9 h-9 sm:w-9 sm:h-9 flex items-center justify-center rounded-xl border transition-all shrink-0 ${
              bulkMode
                ? 'bg-brand-700 border-brand-600 text-parchment-100'
                : 'bg-ink-700 border-ink-600 text-ink-300 hover:text-parchment-200 hover:border-ink-500'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>

          {/* Refresh button */}
          <button
            onClick={loadData}
            disabled={loading}
            title="Refresh"
            className="w-9 h-9 sm:w-9 sm:h-9 flex items-center justify-center rounded-xl bg-ink-700 border border-ink-600 text-ink-300 hover:text-parchment-200 hover:border-ink-500 transition-all shrink-0"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* ── Search ───────────────────────────────────────────────────── */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Cari berdasarkan pesan, nama pengirim, atau template..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-ink-800 border border-ink-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-parchment-200 placeholder:text-ink-300 focus:outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600 font-mono"
            style={{ fontSize: '16px' }}
          />
        </div>

        {/* Hint untuk shortcut */}
        <p className="text-[10px] sm:text-xs text-ink-300 font-mono text-right -mt-2">
          Hover card + tekan <span className="text-brand-400">A</span>=Approve <span className="text-brand-400">R</span>=Reject <span className="text-brand-400">D</span>=Hapus <span className="text-brand-400">E</span>=Export
        </p>

        {/* Bulk action bar — muncul saat bulk mode aktif & ada item terpilih */}
        {bulkMode && selectedIds.size > 0 && (
          <div className="flex items-center justify-between bg-ink-900/70 border border-ink-700 rounded-xl px-4 py-2.5">
            <span className="text-xs font-mono text-parchment-300">
              {selectedIds.size} item terpilih
            </span>
            <div className="flex items-center gap-2">
              {/* Approve hanya bisa saat tidak di tab Disetujui */}
              {activeTab !== 'APPROVED' && (
                <button
                  onClick={() => {
                    const toApprove = [...selectedIds].filter((id) => {
                      const m = menfes.find((x) => x.id === id);
                      return m && m.status !== 'APPROVED';
                    });
                    if (toApprove.length === 0) return toast.error('Tidak ada item yang bisa diapprove.');
                    Promise.all(toApprove.map((id) => adminAPI.approve(id)))
                      .then(() => { toast.success(`${toApprove.length} item diapprove.`); setSelectedIds(new Set()); loadData(); })
                      .catch(() => toast.error('Gagal approve beberapa item.'));
                  }}
                  className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-parchment-100 text-[11px] sm:text-xs font-mono font-semibold rounded-lg transition-colors"
                >
                  Approve
                </button>
              )}
              {/* Reject hanya bisa saat tidak di tab Ditolak */}
              {activeTab !== 'REJECTED' && (
                <button
                  onClick={() => {
                    const toReject = [...selectedIds].filter((id) => {
                      const m = menfes.find((x) => x.id === id);
                      return m && m.status !== 'APPROVED';
                    });
                    if (toReject.length === 0) return toast.error('Tidak ada item yang bisa direject.');
                    Promise.all(toReject.map((id) => adminAPI.reject(id)))
                      .then(() => { toast.success(`${toReject.length} item direject.`); setSelectedIds(new Set()); loadData(); })
                      .catch(() => toast.error('Gagal reject beberapa item.'));
                  }}
                  className="px-3 py-1.5 bg-ink-600 hover:bg-brand-800 text-parchment-300 hover:text-parchment-100 text-[11px] sm:text-xs font-mono font-semibold rounded-lg transition-colors"
                >
                  Reject
                </button>
              )}
              <button
                onClick={() => {
                  const toDelete = [...selectedIds];
                  if (toDelete.length === 0) return;
                  if (!window.confirm(`Yakin hapus ${toDelete.length} menfess permanen?`)) return;
                  Promise.all(toDelete.map((id) => adminAPI.delete(id)))
                    .then(() => { toast.success(`${toDelete.length} item dihapus.`); setSelectedIds(new Set()); loadData(); })
                    .catch(() => toast.error('Gagal hapus beberapa item.'));
                }}
                className="px-3 py-1.5 bg-ink-600 hover:bg-brand-900 text-ink-200 hover:text-brand-400 text-[11px] sm:text-xs font-mono font-semibold rounded-lg transition-colors"
              >
                Hapus
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 bg-transparent text-ink-300 text-[11px] sm:text-xs font-mono transition-colors"
              >
                Batal Pilih
              </button>
            </div>
          </div>
        )}

        {/* ── List ────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-ink-700 border border-ink-600 rounded-xl p-4 sm:p-5 animate-pulse">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-20 h-5 bg-ink-600 rounded-full" />
                  <div className="w-24 h-4 bg-ink-600 rounded" />
                </div>
                <div className="h-4 bg-ink-600 rounded w-3/4 mb-2" />
                <div className="h-3 bg-ink-600 rounded w-1/2 mb-4" />
                <div className="flex items-center gap-2">
                  <div className="h-8 w-20 bg-ink-600 rounded-lg" />
                  <div className="h-8 w-20 bg-ink-600 rounded-lg" />
                  <div className="h-8 w-16 bg-ink-600 rounded-lg ml-auto" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredMenfes.length === 0 ? (
          <div className="bg-ink-700 border border-ink-600 rounded-xl py-12 sm:py-16 text-center">
            <svg className="w-10 h-10 text-ink-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-ink-200 font-mono text-sm">
              {searchQuery ? 'Tidak ada menfess yang cocok dengan pencarian.' : 'Tidak ada menfess di kategori ini.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMenfes.map((item) => (
              <div
                key={item.id}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId((prev) => (prev === item.id ? null : prev))}
                className={`bg-ink-700 border rounded-xl overflow-hidden transition-colors group ${hoveredId === item.id ? 'border-brand-600 ring-1 ring-brand-600/60' : 'border-ink-600 hover:border-ink-500'}`}
              >
                <div className="flex">
                  {/* Checkbox + Accent strip kiri */}
                  <div className="flex items-start gap-2 p-3 sm:p-5 border-r border-ink-700/60">
                    {bulkMode && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setSelectedIds(next);
                        }}
                        className="mt-1 w-4 h-4 accent-brand-700 bg-ink-800 border-ink-500 rounded"
                      />
                    )}
                  </div>
                  <div className="w-1 bg-brand-700 shrink-0 group-hover:bg-brand-600 transition-colors" />

                  <div className="flex-1 p-3 sm:p-5 space-y-3 min-w-0">
                    {/* Header row: status + tanggal + IG */}
                    <div className="flex items-center gap-3">
                      <StatusBadge status={item.status} />
                      <span className="text-[10px] sm:text-xs text-ink-200 font-mono">{formatDate(item.createdAt)}</span>
                      {item.igStatus && (
                        <div className="flex items-center gap-2 text-[9px] text-ink-400 font-mono">
                          {item.igStatus === 'PUBLISHED' && <span className="text-green-400">Sudah tayang</span>}
                          {item.igStatus === 'FAILED' && (
                            <>
                              <span className="text-amber-400">Gagal</span>
                              <button
                                onClick={() => handleRetry(item.id)}
                                className="ml-2 text-brand-400 hover:text-brand-300 text-[9px] font-mono underline"
                                title="Coba publikasi lagi"
                              >
                                Kembali
                              </button>
                            </>
                          )}
                          {item.igMediaId && <span>{item.igMediaId.substring(0, 8)}...</span>}
                        </div>
                      )}
                    </div>

                    {/* Pesan */}
                    <div>
                      <span className="text-brand-600 text-lg leading-none select-none">"</span>
                      <p className={`text-parchment-200 leading-relaxed whitespace-pre-wrap font-mono inline break-words ${
                        item.message.length > 200
                          ? 'text-xs'
                          : item.message.length > 100
                          ? 'text-sm'
                          : 'text-sm sm:text-base'
                      }`}>
                        {item.message}
                      </p>
                      <span className="text-brand-600 text-lg leading-none select-none">"</span>
                    </div>

                    {/* Foto pengirim — slide kedua di post IG; tampil hanya di sini dan IG. */}
                    {item.fotoUrl && (
                      <div className="flex items-center gap-2.5">
                        <a
                          href={urlAset(item.fotoUrl)}
                          target="_blank"
                          rel="noreferrer"
                          title="Klik untuk lihat foto penuh"
                        >
                          <img
                            src={urlAset(item.fotoUrl)}
                            alt="Foto pengirim"
                            className="w-14 h-14 sm:w-16 sm:h-16 object-cover rounded-lg border border-ink-600 hover:border-brand-500 transition-colors bg-ink-800"
                          />
                        </a>
                        <span className="text-[10px] font-mono text-ink-300 leading-relaxed">
                          Foto pengirim<br />
                          <span className="text-ink-400">klik untuk lihat penuh</span>
                        </span>
                      </div>
                    )}

                    {/* Lagu pilihan pengirim — referensi admin saja, tidak
                        pernah ikut ke feed publik maupun Instagram. */}
                    {item.music && <BlokMusik music={item.music} />}

                    {/* Info pengirim & Template */}
                    {(item.senderName || item.senderInfo) && (() => {
                      const tmplId = parseTemplateFromMenfes(item);
                      const tmpl = getTemplateById(tmplId);
                      const isTemplateOnly = item.senderInfo && (
                        item.senderInfo.toLowerCase().includes('template') ||
                        // Data lama sebelum template Classic dihapus: senderInfo-nya
                        // berisi 'Classic Dark', bukan 'template ...'. Tanpa cek ini,
                        // baris itu akan tampil seolah-olah info pengirim dari user.
                        item.senderInfo.toLowerCase().includes('classic')
                      );

                      return (
                        <div className="bg-ink-800 border border-ink-600 rounded-lg px-3 sm:px-4 py-2.5 sm:py-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-mono font-bold text-ink-200 tracking-widest uppercase">
                              Info Pengirim
                            </p>
                            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border bg-ink-700 border-ink-500 text-parchment-300">
                              {tmpl.badge}
                            </span>
                          </div>
                          {item.senderName && (
                            <p className="text-xs text-parchment-400 font-mono">
                              Nama: <span className="text-parchment-200 font-semibold">{item.senderName}</span>
                            </p>
                          )}
                          {item.senderInfo && !isTemplateOnly && (
                            <p className="text-xs text-parchment-400 font-mono break-words">Info: {item.senderInfo}</p>
                          )}
                        </div>
                      );
                    })()}

                    {!item.senderName && !item.senderInfo && (
                      <p className="text-xs text-ink-200 font-mono italic">Dari Seseorang · {TEMPLATES[0].badge}</p>
                    )}

                    {item.approvedAt && (
                      <p className="text-xs text-ink-200 font-mono">
                        Disetujui: {formatDate(item.approvedAt)}
                      </p>
                    )}

                    {/* Action bar — wrap on mobile, horizontal scroll if many */}
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap pt-1 border-t border-ink-700/60">
                      {item.status !== 'APPROVED' && (
                        <button
                          onClick={() => handleApprove(item.id)}
                          disabled={!!actionLoading}
                          className="flex items-center gap-1 bg-emerald-800 hover:bg-emerald-700 text-parchment-100 text-[11px] sm:text-xs font-mono font-semibold px-2.5 py-1.5 sm:py-1.5 rounded-lg transition-colors disabled:opacity-50 touch-manipulation"
                        >
                          {actionLoading === item.id + '_approve' ? (
                            <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                          ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          )}
                          Approve
                        </button>
                      )}
                      {item.status !== 'REJECTED' && (
                        <button
                          onClick={() => handleReject(item.id)}
                          disabled={!!actionLoading}
                          className="flex items-center gap-1 bg-ink-600 hover:bg-brand-800 text-parchment-300 hover:text-parchment-100 text-[11px] sm:text-xs font-mono font-semibold px-2.5 py-1.5 sm:py-1.5 rounded-lg border border-ink-500 hover:border-brand-700 transition-colors disabled:opacity-50 touch-manipulation"
                        >
                          {actionLoading === item.id + '_reject' ? (
                            <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                          ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                          )}
                          Reject
                        </button>
                      )}
                      {item.status === 'APPROVED' && (
                        <button
                          onClick={() => setExportTarget(item)}
                          className="flex items-center gap-1 bg-ink-600 hover:bg-ink-500 text-parchment-300 text-[11px] sm:text-xs font-mono font-semibold px-2.5 py-1.5 sm:py-1.5 rounded-lg border border-ink-500 hover:border-parchment-700/40 transition-colors touch-manipulation"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          Export IG
                        </button>
                      )}

                      {/* Hapus — push ke kanan */}
                      <button
                        onClick={() => setDeleteTarget(item)}
                        disabled={!!actionLoading}
                        className="ml-auto flex items-center gap-1 text-[11px] sm:text-xs text-ink-200 hover:text-brand-400 transition-colors font-mono disabled:opacity-40 py-1.5 sm:py-1 touch-manipulation"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        Hapus
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* ── Paginasi ────────────────────────────────────────────────── */}
        {pagination.totalPages > 1 && !searchQuery && (
          <nav className="flex items-center justify-center gap-1 pt-1" aria-label="Navigasi halaman">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              aria-label="Halaman sebelumnya"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-ink-700 border border-ink-600 text-ink-300 hover:text-parchment-100 hover:border-ink-500 transition-colors disabled:opacity-40 disabled:hover:text-ink-300 disabled:hover:border-ink-600"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>

            {paginationItems(page, pagination.totalPages).map((it, i) =>
              it === '…' ? (
                <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-ink-300 font-mono text-xs select-none">…</span>
              ) : (
                <button
                  key={it}
                  onClick={() => setPage(it)}
                  disabled={loading}
                  aria-label={`Halaman ${it}`}
                  aria-current={it === page ? 'page' : undefined}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-mono font-semibold transition-colors disabled:opacity-60 ${
                    it === page
                      ? 'bg-brand-700 text-parchment-100 border border-brand-600'
                      : 'bg-ink-700 border border-ink-600 text-ink-300 hover:text-parchment-100 hover:border-ink-500'
                  }`}
                >
                  {it}
                </button>
              )
            )}

            <button
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={page >= pagination.totalPages || loading}
              aria-label="Halaman berikutnya"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-ink-700 border border-ink-600 text-ink-300 hover:text-parchment-100 hover:border-ink-500 transition-colors disabled:opacity-40 disabled:hover:text-ink-300 disabled:hover:border-ink-600"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </nav>
        )}
      </main>

      {exportTarget && (
        <ExportModal menfes={exportTarget} onClose={() => setExportTarget(null)} />
      )}

      {/* Custom delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-ink-800 border border-ink-600 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl animate-fadeIn">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-900/40 border border-brand-700/60 flex items-center justify-center">
                <svg className="w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-parchment-100">Hapus Menfess?</h3>
            </div>
            <p className="text-sm text-parchment-300 font-mono leading-relaxed">
              Yakin ingin menghapus menfess ini secara permanen? Tindakan ini tidak bisa dibatalkan.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={!!actionLoading}
                className="flex-1 px-4 py-2.5 rounded-xl bg-ink-700 hover:bg-ink-600 text-parchment-200 font-mono text-sm font-semibold border border-ink-600 transition-colors disabled:opacity-40"
              >
                Batal
              </button>
              <button
                onClick={() => handleDelete(deleteTarget.id)}
                disabled={!!actionLoading}
                className="flex-1 px-4 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-600 text-parchment-100 font-mono text-sm font-semibold transition-colors disabled:opacity-40"
              >
                {actionLoading === deleteTarget.id + '_delete' ? 'Menghapus...' : 'Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
