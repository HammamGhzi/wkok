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
const waPublish = require('./waPublish');

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

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Gagal mengambil berkas: ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// Batas media WhatsApp 16 MB, sementara video pengirim sampai 25 MB. Versi
// 720 px dari Cloudinary cukup kecil untuk lolos; kalau masih lebih, tautan
// yang dikirim (lebih baik daripada notifikasi gagal total).
const BATAS_VIDEO_WA = 16 * 1024 * 1024;

// Tombol reply bisa datang dalam tiga bentuk tergantung versi WhatsApp /
// Baileys. Semua dibaca di sini supaya format mana pun tetap dikenali.
function ambilIdTombol(message) {
  const paramsJson = message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (paramsJson) {
    try {
      const params = JSON.parse(paramsJson);
      if (params?.id) return String(params.id);
    } catch {
      // Format tidak dikenal: coba bentuk lain di bawah.
    }
  }
  const lama = message?.buttonsResponseMessage?.selectedButtonId;
  if (lama) return String(lama);
  const templat = message?.templateButtonReplyMessage?.selectedId;
  return templat ? String(templat) : null;
}

const balasanTerlihat = new Set();

async function tanganiTombolPostIg(messages) {
  for (const item of messages || []) {
    const idPesan = item?.key?.id;
    const idTombol = ambilIdTombol(item?.message);
    if (!idPesan || !idTombol || balasanTerlihat.has(idPesan)) continue;
    if (!idTombol.startsWith(waPublish.AWAL_TOMBOL)) continue;

    balasanTerlihat.add(idPesan);
    if (item.key.fromMe) continue;
    const tujuan = item.key.remoteJid || getGroupJid();
    if (!tujuan) continue;

    try {
      const hasil = await waPublish.terbitkanDariToken(
        idTombol.slice(waPublish.AWAL_TOMBOL.length)
      );
      await sock.sendMessage(tujuan, {
        text: `✅ Menfes sudah diposting ke Instagram.${hasil.permalink ? `\n${hasil.permalink}` : ''}`,
      });
    } catch (err) {
      await sock.sendMessage(tujuan, { text: `❌ Gagal post ke IG: ${err.message}` });
    }
  }
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

    // Balasan tombol "Post ke IG". Baileys mengirim reply tombol lewat dua
    // event berbeda tergantung versi WhatsApp; dua-duanya dipasang dan id
    // pesan dipakai untuk menduplikasi. Tanpa ini tombol hanya tampil, tidak
    // melakukan apa pun saat ditekan.
    sock.ev.on('messages.update', (updates) =>
      tanganiTombolPostIg(updates.map((u) => ({
        key: u.key,
        message: u.update?.message || u.message,
      })))
    );
    sock.ev.on('messages.upsert', ({ messages }) => tanganiTombolPostIg(messages));

    return sock;
  } catch (err) {
    console.error('❌ Gagal inisialisasi WhatsApp bot:', err.message);
    return null;
  }
}

/**
 * Kirim notifikasi ke admin saat ada menfess baru masuk
 * Format: 1 pesan per foto (caption di foto pertama), lalu video (jika ada)
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
    
    const fotoUrls = menfes.fotoUrls || [];

    if (fotoUrls.length) {
      caption += `Foto: ${fotoUrls.length}\n`;
    }
    
    if (menfes.videoUrl) {
      caption += `Video: Ada\n`;
    }
    
    if (menfes.music) {
      const lagu = `${menfes.music.title} - ${menfes.music.artist}`;
      caption += `Lagu: ${lagu}\n`;
    }
    
    caption += `ID: ${menfes.id}\n`;
    caption += `Total Pending: ${pendingCount}`;
    
    // Caption hanya sekali: di media pertama yang berhasil terkirim, supaya
    // grup tidak dibanjiri teks yang sama berulang.
    let captionTerkirim = false;
    let videoTerkirim = false;

    // Foto: Baileys tidak punya album yang andal, jadi kirim satu per satu.
    for (const url of fotoUrls) {
      try {
        const buffer = await fetchBuffer(url);
        await sock.sendMessage(groupJid, {
          image: buffer,
          ...(captionTerkirim ? {} : { caption }),
        });
        captionTerkirim = true;
      } catch (imgErr) {
        console.error('Gagal kirim foto ke WA:', imgErr.message);
      }
    }

    // Video selalu setelah semua foto — sama seperti slide terakhir di carousel
    // Instagram.
    if (menfes.videoUrl) {
      try {
        // Turunkan ke 720 px supaya muat batas media WhatsApp; frame dan
        // handle ikut mengecil proporsional, jadi tetap sama bentuknya.
        const ringan = menfes.videoUrl.replace('/f_mp4/', '/c_scale,w_720/f_mp4/');
        const buffer = await fetchBuffer(ringan);
        if (buffer.length > BATAS_VIDEO_WA) {
          throw new Error(`video ${(buffer.length / 1048576).toFixed(1)} MB melebihi batas 16 MB`);
        }
        await sock.sendMessage(groupJid, {
          video: buffer,
          mimetype: 'video/mp4',
          ...(captionTerkirim ? {} : { caption }),
        });
        captionTerkirim = true;
        videoTerkirim = true;
      } catch (videoErr) {
        console.error('Gagal kirim video ke WA, kirim tautan:', videoErr.message);
      }
    }

    // Video gagal dikirim sebagai media -> tautannya tetap diteruskan, jangan
    // hilang dari notifikasi. Kalau sama sekali belum ada yang terkirim,
    // caption ikut di pesan teks ini.
    if (menfes.videoUrl && !videoTerkirim) {
      await sock.sendMessage(groupJid, {
        text: captionTerkirim ? `Video: ${menfes.videoUrl}` : `${caption}\n\nVideo: ${menfes.videoUrl}`,
      });
    } else if (!captionTerkirim) {
      await sock.sendMessage(groupJid, { text: caption });
    }
    
    console.log(`✅ Notifikasi WhatsApp terkirim ke grup: ${menfes.id}`);
  } catch (err) {
    console.error('WhatsApp kirim notif gagal:', err.message);
  }
}

/**
 * Kirim hasil export WA: semua kartu + lampiran media user ke grup.
 * Dipanggil dari endpoint POST /api/admin/menfes/:id/wa-export.
 *
 * @param {object} args
 * @param {string} args.menfesId
 * @param {string} args.message       teks menfes (tanpa caption IG)
 * @param {string[]} args.fotoUrls    URL foto pengirim (boleh kosong)
 * @param {string|null} args.videoUrl URL video pengirim (boleh null)
 * @param {Array<Buffer>} args.kartuBuffers  kartu hasil render canvas
 * @param {string|null} args.postIgToken     token publish dari waPublish
 * @param {string|null} args.postIgUrl       link cadangan kalau tombol tak muncul
 * @returns {Promise<{terkirim: number, gagal: string[]}>}
 */
async function kirimExportWa({
  menfesId,
  message,
  fotoUrls = [],
  videoUrl = null,
  kartuBuffers = [],
  postIgToken = null,
  postIgUrl = null,
}) {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp bot belum terhubung. Cek QR / koneksi bot.');
  }
  const groupJid = getGroupJid();
  if (!groupJid) {
    throw new Error('WA_WHATSAPP_GROUP_ID belum diisi di .env.');
  }

  let terkirim = 0;
  let captionTerkirim = false;
  const gagal = [];
  const caption = `Menfess ${menfesId}\n\n${message || ''}`;

  // 1. Kartu hasil render canvas (di-upload admin dari browser)
  for (let i = 0; i < kartuBuffers.length; i++) {
    try {
      await sock.sendMessage(groupJid, {
        image: kartuBuffers[i],
        ...(captionTerkirim ? {} : { caption }),
      });
      terkirim++;
      captionTerkirim = true;
    } catch (err) {
      gagal.push(`kartu ${i + 1}: ${err.message}`);
    }
  }

  // 2. Foto lampiran user (URL Cloudinary / server)
  for (let i = 0; i < fotoUrls.length; i++) {
    try {
      const buffer = await fetchBuffer(fotoUrls[i]);
      await sock.sendMessage(groupJid, {
        image: buffer,
        ...(captionTerkirim ? {} : { caption }),
      });
      terkirim++;
      captionTerkirim = true;
    } catch (err) {
      gagal.push(`foto ${i + 1}: ${err.message}`);
    }
  }

  // 3. Video lampiran user (turunkan ke 720 px supaya muat 16 MB)
  if (videoUrl) {
    try {
      const ringan = videoUrl.replace('/f_mp4/', '/c_scale,w_720/f_mp4/');
      const buffer = await fetchBuffer(ringan);
      if (buffer.length > BATAS_VIDEO_WA) {
        throw new Error(`video ${(buffer.length / 1048576).toFixed(1)} MB melebihi batas 16 MB`);
      }
      await sock.sendMessage(groupJid, {
        video: buffer,
        mimetype: 'video/mp4',
        ...(captionTerkirim ? {} : { caption }),
      });
      terkirim++;
      captionTerkirim = true;
    } catch (err) {
      gagal.push(`video: ${err.message}`);
      // Video gagal dikirim: tautannya tetap diteruskan supaya tidak hilang.
      if (videoUrl) {
        try {
          await sock.sendMessage(groupJid, {
            text: `${captionTerkirim ? '' : caption + '\n\n'}Video: ${videoUrl}`.trim(),
          });
          captionTerkirim = true;
        } catch {
          // Kalau teks pun gagal, kegagalan sudah tercatat di `gagal`.
        }
      }
    }
  }

  // Semua media gagal: minimal teks menfes tetap sampai ke grup.
  if (!captionTerkirim) {
    try {
      await sock.sendMessage(groupJid, { text: caption });
    } catch (err) {
      gagal.push(`teks: ${err.message}`);
    }
  }

  // Tombol "Post ke IG" + link cadangan. Tombol interaktif sering tidak muncul
  // di grup untuk akun non-bisnis, jadi link SELALU dikirim terlepas dari
  // keberhasilan tombol.
  if (postIgUrl) {
    // id quick_reply punya batas pendek. Banyak kartu membuat token panjang;
    // dalam kasus itu tombol dilewati dan link tetap dikirim.
    const idTombol = `${waPublish.AWAL_TOMBOL}${postIgToken || ''}`;
    if (postIgToken && idTombol.length <= 200) {
      try {
        await sock.sendMessage(groupJid, {
          interactiveMessage: {
            header: { title: 'Post ke IG', subTitle: menfesId },
            body: { text: 'Post menfes ini ke Instagram?' },
            footer: { text: 'Caption otomatis: isi menfes + -katt' },
            nativeFlowMessage: {
              buttons: [{
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                  display_text: 'Post ke IG',
                  id: idTombol,
                }),
              }],
            },
          },
        });
      } catch (err) {
        console.warn('Tombol IG tidak bisa dikirim, pakai link cadangan:', err.message);
      }
    }
    try {
      await sock.sendMessage(groupJid, {
        text: `Kalau tombol tidak muncul, post ke IG, klik link ini:\n${postIgUrl}`,
      });
    } catch (err) {
      gagal.push(`link IG: ${err.message}`);
    }
  }

  console.log(`✅ Export WA terkirim: ${terkirim} media, ${gagal.length} gagal — ${menfesId}`);
  return { terkirim, gagal };
}

module.exports = { initWa, notifyNewMenfesWa, kirimExportWa, ambilIdTombol };
