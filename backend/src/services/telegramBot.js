const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

let bot = null;

/**
 * Inisialisasi bot Telegram.
 * Pakai polling di development, webhook di production.
 */
function initBot() {
  if (!TOKEN || !ADMIN_CHAT_ID) {
    console.warn('⚠️  Telegram bot tidak aktif — TELEGRAM_BOT_TOKEN atau TELEGRAM_ADMIN_CHAT_ID belum diisi di .env');
    return null;
  }

  // Pakai polling (development) — tidak perlu domain publik
  bot = new TelegramBot(TOKEN, { polling: true });

  bot.on('polling_error', (err) => {
    // Jangan crash server karena error polling
    console.error('Telegram polling error:', err.message);
  });

  console.log('🤖 Telegram bot aktif (polling mode)');
  return bot;
}

/**
 * Kirim notifikasi ke admin saat ada menfess baru masuk.
 * Sertakan tombol inline approve/reject.
 */
async function notifyNewMenfes(menfes) {
  if (!bot || !ADMIN_CHAT_ID) return;

  const senderLabel = menfes.senderName
    ? `👤 Dari: ${menfes.senderName}`
    : '👤 Dari: Seseorang (anonim)';

  const preview = menfes.message.length > 300
    ? menfes.message.substring(0, 300) + '...'
    : menfes.message;

  const text =
    `📩 *Menfess Baru Masuk!*\n\n` +
    `${senderLabel}\n\n` +
    `💬 *Pesan:*\n_${escapeMarkdown(preview)}_\n\n` +
    ((menfes.fotoUrls || []).length ? `🖼️ *Foto:* ${menfes.fotoUrls.length}\n\n` : '') +
    (menfes.videoUrl ? `🎥 *Video:* ${menfes.videoUrl}\n\n` : '') +
    `🆔 ID: \`${menfes.id}\``;

  const opts = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve_${menfes.id}` },
          { text: '❌ Reject',  callback_data: `reject_${menfes.id}` },
        ],
      ],
    },
  };

  try {
    await bot.sendMessage(ADMIN_CHAT_ID, text, opts);
  } catch (err) {
    console.error('Telegram kirim notif gagal:', err.message);
  }
}

/**
 * Kirim pesan teks biasa ke admin.
 * Dipakai untuk konfirmasi approve/reject.
 */
async function sendMessage(text) {
  if (!bot || !ADMIN_CHAT_ID) return;
  try {
    await bot.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Telegram sendMessage gagal:', err.message);
  }
}

/**
 * Escape karakter Markdown agar tidak merusak format pesan
 */
function escapeMarkdown(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[');
}

/**
 * Dapatkan instance bot (untuk daftarkan callback handler di route)
 */
function getBot() {
  return bot;
}

module.exports = { initBot, notifyNewMenfes, sendMessage, getBot };
