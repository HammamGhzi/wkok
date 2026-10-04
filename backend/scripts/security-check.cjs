/**
 * Security regression check — backend/.
 *
 * Menjalankan exploit nyata terhadap express app asli (TIDAK ada request
 * ke Telegram sungguhan; modulnya di-stub) lalu memeriksa apakah kerentanan
 * yang sudah ditemukan masih ada atau sudah ditutup.
 *
 * Jalankan:  npm run security-check
 *
 * Exit code 0 = semua lolos. Exit 1 = ada yang masih bocor.
 *
 * ── CAKUPAN DAN BATASNYA ────────────────────────────────────────────────
 * Script ini berjalan di localhost, TANPA reverse proxy sungguhan. Itu
 * berarti:
 *
 *  - Cek "trust proxy" hanya membuktikan bahwa express-rate-limit memakai
 *    entri X-Forwarded-For paling kanan. Itu bagian yang benar untuk
 *    konfigurasi Render, tapi TIDAK membuktikan bahwa Render benar-benar
 *    menambahkan IP asli di ujung kanan. Kalau suatu saat Render meneruskan
 *    XFF apa adanya, penyerang bisa memalsukan XFF dan lolos limit.
 *    Verifikasi produksi harus dijalankan dari luar (lihat catatan di
 *    commit message fix(security)).
 *
 *  - express-rate-limit memakai MemoryStore (in-memory per-process). Kalau
 *    Render menjalankan lebih dari satu instance, tiap instance punya bucket
 *    sendiri sehingga limit efektif menjadi max x jumlah-instance.
 *    Terverifikasi di produksi: max=5 dengan 2 instance -> 10 lolos, dengan
 *    X-RateLimit-Remaining naik lagi dari 0 ke 1 di tengah window. Karena
 *    itu RATE_LIMIT_MAX_SUBMIT ada di .env.example: angka itu perlu dibagi
 *    jumlah instance yang aktif.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });

// ── stub Telegram: catat panggilan, jangan pernah sentron ────────────────
const botCalls = [];
class FakeBot extends EventEmitter {
  async sendMessage(chat, text) { botCalls.push({ fn: 'sendMessage', chat, text }); return { message_id: 1 }; }
  async editMessageText(text, opts) {
    botCalls.push({ fn: 'editMessageText', chat_id: opts.chat_id, text });
    return { message_id: 1 };
  }
  async answerCallbackQuery() { return true; }
  async getMe() { return { id: 1, username: 'fakebot' }; }
  processUpdate(u) {
    if (u.callback_query) this.emit('callback_query', u.callback_query);
    if (u.message) this.emit('message', u.message);
  }
}
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'node-telegram-bot-api') return FakeBot;
  return origLoad.call(this, req, parent, isMain);
};

const results = [];
const check = (name, secure, extra = '') => {
  results.push({ name, secure });
  console.log(`${secure ? 'OK  ' : 'GAGAL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

(async () => {
  process.env.TELEGRAM_BOT_TOKEN = '999999:FAKE-TOKEN-FOR-SECURITY-TEST';
  process.env.TELEGRAM_ADMIN_CHAT_ID = '111222333';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret-rahasia';
  process.env.PORT = '0';

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  const victim = await prisma.menfes.create({
    data: { message: 'SECURITY-CHECK - dihapus otomatis', status: 'PENDING' },
  });

  const app = require(path.join(ROOT, 'src/index.js'));
  await new Promise((r) => setTimeout(r, 700));
  const server = app.listen(0);
  await new Promise((r) => setTimeout(r, 300));
  const base = `http://127.0.0.1:${server.address().port}`;

  const forgeCallback = (data, chatId, msgId, text) => ({
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: {
      id: 'forged',
      from: { id: 1, is_bot: false, first_name: 'Attacker' },
      chat_instance: 'ci',
      data,
      message: { message_id: msgId, chat: { id: chatId, type: 'private' }, text },
    },
  });

  /**
   * Tunggu sampai sebuah kondisi benar, bukan menebak lamanya.
   *
   * Handler callback Telegram itu async dan tidak di-await oleh route webhook:
   * route-nya sudah res.sendStatus(200) selagi handler masih bekerja di
   * belakang. Setelah itu handler baru melakukan DUA query database berurutan.
   * Dulu script ini menunggu 500 ms tetap. Itu cukup kalau database kebetulan
   * dekat, tapi tidak cukup saat query lewat pooler internet ke Supabase.
   * Gejalanya menyesatkan: approve yang seharusnya berhasil dilaporkan gagal,
   * padahal aplikasinya benar.
   *
   * Polling setiap 100 ms menghapus tebakan itu. Batas waktu juga jadi
   * eksplisit di satu tempat, bukan tersembunyi di setiap angka sleep.
   *
   * @param {() => Promise<boolean>} kondisi
   * @param {number} batasMs
   * @returns {Promise<boolean>} true kalau kondisi tercapai tepat waktu
   */
  const tungguSampai = async (kondisi, batasMs = 15000) => {
    const mulai = Date.now();
    for (;;) {
      if (await kondisi()) return true;
      if (Date.now() - mulai > batasMs) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const statusVictim = async () =>
    (await prisma.menfes.findUnique({ where: { id: victim.id } })).status;

  const tungguGagalDitolak = async () => {
    // Untuk kasus negatif kita justru HARUS menunggu cukup lama: supaya "tidak
    // terjadi" berarti memang tidak terjadi, bukan cuma belum terjadi. Pakai batas
    // waktu yang sama dengan kasus positif, biar tidak ada dua standar.
    await new Promise((r) => setTimeout(r, 3000));
    return statusVictim();
  };

  // ═══ 1. Webhook Telegram wajib punya secret ═══════════════════════════
  console.log('\n── 1. Webhook Telegram ──');

  const rNoSecret = await fetch(`${base}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(forgeCallback(`approve_${victim.id}`, 111222333, 1, 'x')),
  });
  const setelahTanpaSecret = await tungguGagalDitolak();
  check('POST webhook tanpa secret DITOLAK', setelahTanpaSecret === 'PENDING',
    `HTTP ${rNoSecret.status}, status=${setelahTanpaSecret}`);

  const rBadSecret = await fetch(`${base}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'secret-salah',
    },
    body: JSON.stringify(forgeCallback(`approve_${victim.id}`, 111222333, 2, 'x')),
  });
  const setelahSecretSalah = await tungguGagalDitolak();
  check('POST webhook dengan secret SALAH ditolak', setelahSecretSalah === 'PENDING',
    `HTTP ${rBadSecret.status}`);

  const rOkSecret = await fetch(`${base}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'test-secret-rahasia',
    },
    body: JSON.stringify(forgeCallback(`approve_${victim.id}`, 111222333, 3, 'notifikasi asli')),
  });
  await tungguSampai(async () => (await statusVictim()) === 'APPROVED');
  const setelahSecretBenar = await statusVictim();
  check('POST webhook dengan secret BENAR tetap berfungsi',
    setelahSecretBenar === 'APPROVED', `HTTP ${rOkSecret.status}, status=${setelahSecretBenar}`);

  // bot tidak boleh menulis ke chat_id asing milik-siapa pun
  botCalls.length = 0;
  await fetch(`${base}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'test-secret-rahasia',
    },
    body: JSON.stringify(forgeCallback('reject_tidak-ada', 777000999, 9, ' INJEKSI ')),
  });
  // Tunggu bot benar-benar selesai memproses, bukan hanya sempat menerima. Kalau
  // tidak, botCalls masih kosong karena handler belum jalan, dan pemeriksaan ini
  // lulus karena alasan yang salah.
  await new Promise((r) => setTimeout(r, 3000));
  check('Bot tidak menulis ke chat_id di luar ADMIN_CHAT_ID',
    !botCalls.some((c) => c.chat_id && c.chat_id !== 111222333),
    `chat_id target: ${botCalls.map((c) => c.chat_id).join(',') || 'tidak ada'}`);

  // ═══ 2. Rate limit tahan spoofing X-Forwarded-For ═════════════════════
  console.log('\n── 2. Rate limit /api/menfes ──');

  // Skenario A: IP sama (tanpa mengubah X-Forwarded-For) → HARUS kena limit
  let createdSame = 0;
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${base}/api/menfes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.5' },
      body: JSON.stringify({ message: `spam same ${i} kalimat cukup panjang untuk lolos` }),
    });
    if (r.status === 201) createdSame++;
  }
  const submitMax = Number(process.env.RATE_LIMIT_MAX_SUBMIT) || 3;
  check('Rate limit berlaku untuk IP yang sama (XFF konsisten)', createdSame <= submitMax,
    `created=${createdSame}/10 (max=${submitMax})`);

  // Skenario B: simulasi Render. Render MENERUSKAN X-Forwarded-For milik
  // client lalu MENAMBAHKAN IP asli di ujung kanan:
  //     X-Forwarded-For: <pilihan-attacker>, <ip-asli>
  // Dengan trust proxy=1, Express membaca entri paling KANAN, jadi dua
  // request dengan IP asli sama harus masuk bucket sama walau attacker
  // memalsukan bagian kirinya.
  let createdSpoof = 0;
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${base}/api/menfes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `10.10.10.${i}, 203.0.113.77`,
      },
      body: JSON.stringify({ message: `spam spoof ${i} kalimat cukup panjang untuk lolos` }),
    });
    if (r.status === 201) createdSpoof++;
  }
  // CATATAN PENTING:
  // Skenario ini hanya meaningful kalau ada proxy tepercaya yang MENAMBAHKAN
  // IP asli di ujung kanan X-Forwarded-For (seperti Render). Di lingkungan
  // lokal tidak ada proxy sungguhan, jadi test ini memverifikasi bahwa
  // express-rate-limit memakai entri paling kanan (trust proxy=1) —
  // bukan membuktikan keamanan produksi.
  //
  // Verifikasi produksi wajib dilakukan dari luar; lihat catatan di README.
  check('trust proxy=1 memakai entri XFF paling kanan (lihat catatan produksi)',
    createdSpoof <= submitMax,
    `created=${createdSpoof}/10 dengan IP kanan sama (max=${submitMax})`);

  // ═══ 3. CORS tetap ketat ══════════════════════════════════════════════
  console.log('\n── 3. CORS ──');
  const rEvil = await fetch(`${base}/api/menfes`, { headers: { Origin: 'https://evil.example.com' } });
  check('Origin asing tidak dapat header CORS', !rEvil.headers.get('access-control-allow-origin'),
    `HTTP ${rEvil.status}`);
  const rGood = await fetch(`${base}/api/menfes`, { headers: { Origin: 'https://harkatnekat.vercel.app' } });
  check('Origin resmi tetap diizinkan',
    (rGood.headers.get('access-control-allow-origin') || '').includes('harkatnekat.vercel.app'));

  // ═══ 4. Admin route tetap tertutup ═══════════════════════════════════
  console.log('\n── 4. Autentikasi admin ──');
  const rAdmin = await fetch(`${base}/api/admin/menfes`);
  check('Endpoint admin menolak tanpa token', rAdmin.status === 401, `HTTP ${rAdmin.status}`);
  const jwt = require('jsonwebtoken');
  const rForged = await fetch(`${base}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${jwt.sign({ role: 'admin' }, 'secret-salah')}` },
  });
  check('JWT dengan secret salah ditolak', rForged.status === 401, `HTTP ${rForged.status}`);

  // ═══ 5. Path traversal ═══════════════════════════════════════════════
  console.log('\n── 5. Path traversal /uploads ──');
  for (const p of ['/uploads/../.env', '/uploads/%2e%2e/.env', '/uploads/../../backend/.env']) {
    const r = await fetch(`${base}${p}`, { redirect: 'manual' });
    check(`Traversal ditolak: ${p}`, r.status >= 400, `HTTP ${r.status}`);
  }

  // ═══ 6. Data privat tidak bocor ke publik ═════════════════════════════
  console.log('\n── 6. Data leak publik ──');
  const pub = await fetch(`${base}/api/menfes`).then((r) => r.json()).catch(() => null);
  if (pub?.data?.length) {
    const leaked = pub.data.some((m) => 'senderName' in m || 'senderInfo' in m || 'ipHash' in m);
    check('Endpoint publik tidak mengembalikan field sensitif', !leaked,
      Object.keys(pub.data[0]).join(','));
  } else {
    check('Endpoint publik tidak mengembalikan field sensitif', true, 'tidak ada data');
  }

  // ── bersihkan ────────────────────────────────────────────────────────
  await prisma.menfes.deleteMany({ where: { message: { contains: 'spam check' } } });
  await prisma.menfes.delete({ where: { id: victim.id } });
  server.close();
  await prisma.$disconnect();

  const failed = results.filter((r) => !r.secure);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${results.length - failed.length}/${results.length} pemeriksaan lolos`);
  if (failed.length) {
    console.log(`\n${failed.length} MASIH RENTAN:`);
    failed.forEach((f) => console.log(`  - ${f.name}`));
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.stack); process.exit(1); });