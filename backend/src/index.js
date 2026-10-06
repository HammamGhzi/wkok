require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const menfesRoutes = require('./routes/menfes');
const adminRoutes = require('./routes/admin');
const siteRoutes = require('./routes/site');
const authMiddleware = require('./middleware/auth');
const { router: telegramRouter, registerTelegramCallbacks } = require('./routes/telegram');
const { initBot } = require('./services/telegramBot');

const app = express();
const PORT = process.env.PORT || 3001;

// Di belakang reverse proxy (Render/Vercel/nginx), Express perlu tahu kalau
// ada tepat 1 proxy di depan aplikasi supaya req.ip memakai X-Forwarded-For
// yang benar. Tanpa ini, SEMUA permintaan dari satu proxy terhitung sebagai
// satu IP: rate limit jadi tidak berguna, dan penyerang bisa memalsukan
// X-Forwarded-For untuk lolos dari limit.
app.set('trust proxy', 1);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

// Pastikan production URL selalu ada
if (!allowedOrigins.includes('https://harkatnekat.vercel.app')) {
  allowedOrigins.push('https://harkatnekat.vercel.app');
}

console.log('🌐 FRONTEND_URL env:', process.env.FRONTEND_URL);
console.log('✅ Allowed origins:', allowedOrigins);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} tidak diizinkan.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body Parser ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Unggah gambar untuk publikasi Instagram ──────────────────────────────────
// SATU-SATUNYA route yang dipasang DI ATAS body parser global, dan itu wajib.
//
// express.json() dan express.raw() sama-sama melompat kalau request sudah
// diparse. Karena body parser global di atas sudah lebih dulu, parser 8 MB
// yang menempel di routes/admin.js tidak akan pernah dipanggil kalau route ini
// tidak dipasang di sini. Penjelasan panjangnya ada di routes/admin.js.
//
// Urutan di dalam route ini juga disengaja: auth DI DAHULU parser gambar.
// Kalau dibalik, siapa pun tanpa token bisa memaksa server membaca 8 MB per
// request tanpa batas, karena globalLimiter di bawah juga baru aktif setelah
// body parser.
app.post(
  '/api/admin/menfes/:id/post',
  authMiddleware,
  adminRoutes.parserGambar,
  adminRoutes.postMenfesToInstagram
);

// ─── Serve uploaded template ──────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// /api/health dipasang SEBELUM rate limiter supaya health check Render selalu
// mendapat 200 saat service sehat; sebelumnya route ini ikut kena globalLimiter
// dan bisa membalas 429, yang membuat Render menandai service unhealthy.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Menfes Harkat Nekat',
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    timestamp: new Date().toISOString(),
  });
});

// ─── Global Rate Limit ────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Terlalu banyak request. Coba lagi nanti.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/menfes', menfesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/site', siteRoutes);
app.use('/api/telegram', telegramRouter);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route tidak ditemukan.' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Terjadi kesalahan server.'
      : err.message,
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);

  // Init Telegram bot setelah server jalan
  initBot();
  registerTelegramCallbacks();
});

module.exports = app;
