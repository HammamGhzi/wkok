const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const WA_WHATSAPP_GROUP_ID = process.env.WA_WHATSAPP_GROUP_ID;
// Use /tmp for ephemeral storage (works on Render), or persistent disk if configured
const SESSION_PATH = process.env.WA_SESSION_PATH || path.join('/tmp', 'wa-session');

let sock = null;
let isConnected = false;

function getGroupJid() {
  if (!WA_WHATSAPP_GROUP_ID) return null;
  
  // Pastikan format grup benar (ends with @g.us)
  const groupId = WA_WHATSAPP_GROUP_ID.trim();
  if (!groupId.endsWith('@g.us')) {
    console.warn('⚠️  WA_WHATSAPP_GROUP_ID harus berakhir dengan @g.us');
    return null;
  }
  
  return groupId;
}

function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch image: ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/**
 * Inisialisasi bot WhatsApp dengan Baileys
 */
async function initWa() {
  console.log('🔧 Inisialisasi WhatsApp bot...');
  
  // Buat folder session kalo belum ada
  if (!fs.existsSync(SESSION_PATH)) {
    fs.mkdirSync(SESSION_PATH, { recursive: true });
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
      browser: ['Harkat Nekat Menfes', 'Chrome', '1.0.0'],
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      console.log('[WhatsApp] Connection update:', connection, qr ? '(QR)' : '');
      
      if (qr) {
        console.log('\n📱 Scan QR Code berikut untuk login WhatsApp:');
        qrcode.generate(qr, { small: true });
      }
      
      if (connection === 'close') {
        isConnected = false;
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('❌ WhatsApp terputus. Mencoba reconnect...', shouldReconnect);
        
        if (shouldReconnect) {
          setTimeout(() => initWa(), 3000);
        } else {
          console.log('🚪 WhatsApp logged out. Hapus folder wa-session untuk scan QR ulang.');
        }
      } else if (connection === 'open') {
        isConnected = true;
        console.log('✅ WhatsApp bot aktif!');
        
        // 📋 AUTO FETCH GROUP IDs - Cari grup ID untuk notifikasi
        (async () => {
          try {
            console.log('🔍 Mengambil daftar grup WhatsApp...');
            const groups = await sock.groupFetchAllParticipating();
            
            console.log('\n📋 === DAFTAR GRUP WHATSAPP ===');
            for (const [id, group] of Object.entries(groups)) {
              console.log(`\n📍 Nama grup: ${group.subject}`);
              console.log(`🆔 Group ID: ${id}`);
              console.log(`👥 Jumlah member: ${group.participants?.length || 0}`);
              console.log('─────────────────────────────────');
            }
            console.log('\n💡 Copy Group ID yang diinginkan ke .env:');
            console.log('   WA_WHATSAPP_GROUP_ID=<GROUP_ID_YANG_DIINGINKAN>');
            console.log('   Contoh: WA_WHATSAPP_GROUP_ID=120363194020948049@g.us');
          } catch (err) {
            console.log('⚠️  Gagal mengambil grup:', err.message);
          }
        })();
      }
    });

    sock.ev.on('creds.update', saveCreds);
    
    return sock;
  } catch (err) {
    console.error('❌ Gagal inisialisasi WhatsApp bot:', err.message);
    return null;
  }
}

/**
 * Kirim notifikasi ke admin saat ada menfess baru masuk
 * Format: 1 pesan dengan foto (jika ada) + caption berisi info lengkap
 */
async function notifyNewMenfesWa({ menfes, pendingCount }) {
  if (!sock || !isConnected) return;
  
  const groupJid = getGroupJid();
  if (!groupJid) {
    console.log('⚠️  WA_WHATSAPP_GROUP_ID belum diisi di .env, skip notifikasi grup');
    return;
  }

  try {
    // Buat caption sesuai format yang diminta
    let caption = `Ada Menfess baru nih!\n\n`;
    caption += `Pesan: ${menfes.message}\n\n`;
    
    if (menfes.fotoUrl) {
      caption += `Foto: Ada\n`;
    }
    
    if (menfes.videoUrl) {
      // Video TIDAK dilampirkan: batas media WhatsApp 16 MB, sementara video
      // pengirim sampai 25 MB. Tautan tetap bisa dibuka anggota grup.
      caption += `Video: Ada\n${menfes.videoUrl}\n`;
    }
    
    if (menfes.music) {
      const lagu = `${menfes.music.title} - ${menfes.music.artist}`;
      caption += `Lagu: ${lagu}\n`;
    }
    
    caption += `ID: ${menfes.id}\n`;
    caption += `Total Pending: ${pendingCount}`;
    
    // Jika ada foto, kirim foto dengan caption
    if (menfes.fotoUrl) {
      try {
        const buffer = await fetchImage(menfes.fotoUrl);
        await sock.sendMessage(groupJid, {
          image: buffer,
          caption: caption,
        });
      } catch (imgErr) {
        console.error('Gagal kirim foto ke WA, kirim teks aja:', imgErr.message);
        await sock.sendMessage(groupJid, { text: caption });
      }
    } else {
      await sock.sendMessage(groupJid, { text: caption });
    }
    
    console.log(`✅ Notifikasi WhatsApp terkirim ke grup: ${menfes.id}`);
  } catch (err) {
    console.error('WhatsApp kirim notif gagal:', err.message);
  }
}

module.exports = { initWa, notifyNewMenfesWa };
