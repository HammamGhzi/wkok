/**
 * Chatbot FAQ Harkat Nekat
 * Pakai TF-IDF + cosine similarity dengan preprocessing:
 * - Strip sapaan (min, kak, bang, dll)
 * - Normalisasi kata informal -> formal
 * - Stemming sederhana awalan/akhiran bahasa Indonesia
 */

// ── Preprocessing ─────────────────────────────────────────────────────────────

// Kata yang terdeteksi sebagai niat bertanya (setelah sapaan dibuang)
const NIAT_TANYA = new Set([
  'tanya', 'nanya', 'nanyain', 'nanyak', 'tanyain',
  'mau', 'mo', 'ingin', 'pengen', 'pgn', 'minta',
  'numpang', 'boleh', 'bisa', 'izin', 'ijin',
]);
const SAPAAN = new Set([
  'min', 'minn', 'minnn', 'admin',
  'kak', 'kakak', 'kk',
  'bang', 'mas', 'mba', 'mbak', 'teh', 'neng',
  'bro', 'sis', 'guys', 'gan',
  'halo', 'hai', 'hi', 'hey', 'hei', 'hello',
  'assalamualaikum', 'waalaikumsalam', 'permisi', 'selamat',
  'pagi', 'siang', 'sore', 'malam',
  'numpang', 'tanya', 'nanyain', 'nanyak',
  'mau', 'aku', 'saya', 'gue', 'gw',
  'boleh', 'bisa',
  'excuse', 'me', 'maaf', 'sorry',
  'dong', 'nih', 'deh', 'yah',
]);

/**
 * Kamus normalisasi: kata informal/singkatan -> kata standar.
 * Dijalankan per token setelah tokenisasi.
 */
const NORMALISASI = {
  // Variasi "menfes"
  menfess: 'menfes', mnfs: 'menfes', menfes: 'menfes',
  menfes2: 'menfes', confess: 'menfes', mention: 'menfes',

  // Kata tanya & partikel
  gmn: 'gimana', gimn: 'gimana', bgmn: 'bagaimana', bagaimana: 'gimana',
  gmana: 'gimana', gimananya: 'gimana',
  knp: 'kenapa', knapa: 'kenapa', mengapa: 'kenapa',
  kpn: 'kapan', kapankah: 'kapan',
  dmn: 'dimana', dimananya: 'dimana',
  brp: 'berapa', berapaan: 'berapa',
  apa: 'apa', apaan: 'apa', apasih: 'apa',

  // Negasi & konfirmasi
  gak: 'tidak', ga: 'tidak', ngga: 'tidak', nggak: 'tidak',
  engga: 'tidak', enggak: 'tidak', kagak: 'tidak', gakbisa: 'tidak bisa',
  gabisa: 'tidak bisa', gaisa: 'tidak bisa',
  iya: 'ya', yep: 'ya', yups: 'ya', okee: 'oke', oks: 'oke',

  // Kirim & submit
  ngirim: 'kirim', mengirim: 'kirim', pengiriman: 'kirim',
  submit: 'kirim', ngesubmit: 'kirim', kirimkan: 'kirim',
  dikirim: 'kirim', dikirimkan: 'kirim', terkirim: 'kirim',
  send: 'kirim', ngesend: 'kirim',

  // Lihat & tampil
  liat: 'lihat', ngeliat: 'lihat', diliat: 'lihat',
  tayang: 'tampil', ditayang: 'tampil', ditayangkan: 'tampil',
  muncul: 'tampil', keluar: 'tampil', nongol: 'tampil',

  // Batas & limit
  limit: 'batas', limited: 'batas', maksimal: 'maks', maximum: 'maks',
  minimal: 'min2', minimum: 'min2', // min2 supaya tidak bentrok dengan sapaan "min"

  // Waktu
  hari: 'hari', harian: 'hari', sehari: 'hari',
  jam: 'jam', jaman: 'jam',

  // Foto & gambar
  gambar: 'foto', image: 'foto', img: 'foto', pic: 'foto', pict: 'foto',
  picture: 'foto', photo: 'foto', attachment: 'lampiran',

  // Video & clip
  clip: 'video', reels: 'video', reel: 'video',

  // Anonim & identitas
  anon: 'anonim', anonymous: 'anonim', anonym: 'anonim',
  identitas: 'identitas', id: 'identitas',
  ketahuan: 'ketahuan', keliatan: 'ketahuan', kelihatan: 'ketahuan',
  bocor: 'ketahuan', kebocoran: 'ketahuan',

  // Disetujui & ditolak
  approve: 'setuju', approved: 'setuju', diapprove: 'setuju',
  acc: 'setuju', diacc: 'setuju',
  reject: 'tolak', rejected: 'tolak', direject: 'tolak',
  ditolak: 'tolak',

  // Template & desain
  template: 'template', tema: 'template', design: 'template',
  desain: 'template', tampilan: 'template', layout: 'template',

  // Musik & lagu
  musik: 'musik', music: 'musik', lagu: 'musik', song: 'musik',
  track: 'musik',

  // Instagram
  ig: 'instagram', insta: 'instagram', instgram: 'instagram',

  // Error & masalah
  eror: 'error', galat: 'error', masalah: 'error', problem: 'error',
  bug: 'error', rusak: 'error',

  // Jadwal & waktu buka
  jadwal: 'jadwal', schedule: 'jadwal', operasional: 'jadwal',
  buka: 'buka', open: 'buka', tutup: 'tutup', close: 'tutup',
  closed: 'tutup',

  // Kata sambung & filler yang tidak perlu
  sih: '', deh: '', dong: '', nih: '', tuh: '', loh: '',
  lah: '', yah: '', yaa: '', yaaa: '', duh: '', aduh: '',
  emang: 'memang', emg: 'memang',
  udah: 'sudah', udh: 'sudah', dah: 'sudah',
  blm: 'belum', belom: 'belum',
  lg: 'lagi', lgi: 'lagi',
  jg: 'juga', juga: 'juga',
  klo: 'kalau', kl: 'kalau', kalo: 'kalau', kalok: 'kalau',
  tp: 'tapi', tpi: 'tapi',
  krn: 'karena', karna: 'karena',
  dgn: 'dengan', sm: 'sama',
  utk: 'untuk', buat: 'untuk', bt: 'untuk',
  yg: 'yang', yng: 'yang',
  dr: 'dari', dr: 'dari',
  ke: 'ke', pd: 'pada',
  hrs: 'harus', hrus: 'harus',
  bs: 'bisa', bsa: 'bisa',
  msh: 'masih',
};

/**
 * Awalan bahasa Indonesia yang di-strip saat stemming.
 * Urutan penting: coba dari yang paling panjang dulu.
 */
const AWALAN = [
  'menge', 'memper', 'diper', 'keter', 'peng', 'meng', 'pem',
  'mem', 'per', 'pen', 'men', 'pel', 'mel', 'di', 'ke', 'se',
  'me', 'pe', 'be', 'te',
];

/**
 * Akhiran bahasa Indonesia yang di-strip.
 */
const AKHIRAN = ['kan', 'an', 'nya', 'ku', 'mu', 'i', 'lah', 'kah'];

/**
 * Stemming sederhana: coba strip awalan dan akhiran.
 * Hanya dijalankan kalau kata tidak ada di kamus normalisasi.
 * Kata pendek (<= 4 huruf) tidak di-stem supaya tidak salah potong.
 */
function stem(kata) {
  if (kata.length <= 4) return kata;

  let hasil = kata;

  // Coba strip akhiran dulu
  for (const akh of AKHIRAN) {
    if (hasil.endsWith(akh) && hasil.length - akh.length >= 3) {
      hasil = hasil.slice(0, -akh.length);
      break;
    }
  }

  // Coba strip awalan
  for (const aw of AWALAN) {
    if (hasil.startsWith(aw) && hasil.length - aw.length >= 3) {
      hasil = hasil.slice(aw.length);
      break;
    }
  }

  return hasil;
}

/**
 * Preprocessing lengkap satu teks:
 * 1. Lowercase & hapus tanda baca
 * 2. Tokenisasi
 * 3. Strip sapaan
 * 4. Normalisasi kata informal
 * 5. Stemming
 * 6. Buang token kosong
 */
function preprocess(teks) {
  const tokens = teks
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const hasil = [];
  for (const token of tokens) {
    // Buang sapaan dan kata niat tanya (tidak informatif untuk TF-IDF)
    if (SAPAAN.has(token) || NIAT_TANYA.has(token)) continue;

    // Normalisasi
    const norm = NORMALISASI[token];
    if (norm === '') continue;           // filler word, buang
    if (norm !== undefined) {
      // Normalisasi bisa menghasilkan frasa (spasi), split lagi
      for (const t of norm.split(' ').filter(Boolean)) hasil.push(t);
      continue;
    }

    // Stemming untuk kata yang tidak ada di kamus
    hasil.push(stem(token));
  }

  return hasil;
}

// ── Dataset FAQ ───────────────────────────────────────────────────────────────
const FAQ = [
  {
    pertanyaan: [
      'cara kirim menfes',
      'cara ngirim menfes',
      'gimana cara kirim',
      'cara mengirim menfes',
      'cara submit menfes',
      'cara kirim menfess',
      'mau kirim menfes gimana',
      'cara pakai web ini',
      'cara penggunaan',
      'gimana cara pakainya',
      'cara ngirim',
      'menfes dikirim gimana',
      'cara isi form',
      'cara kirimnya gimana',
      'tutorial kirim menfes',
      'minta tolong ajarin kirim menfes',
      'ga ngerti cara kirim',
      'bingung cara kirimnya',
      'langkah kirim menfes',
      'step by step kirim menfes',
    ],
    jawaban:
      'Tulis pesanmu di kolom pesan (minimal 5, maksimal 500 karakter), isi nama/info pengirim kalau mau (opsional), pilih template, lalu klik Kirim. Menfesmu akan menunggu persetujuan admin sebelum tayang di Instagram.',
  },
  {
    pertanyaan: [
      'menfes anonim',
      'apakah anonim',
      'identitas aman',
      'nama aku ketahuan ngga',
      'privasi pengirim',
      'aman ngga',
      'identitas ketahuan',
      'menfes aku aman',
      'bakal ketahuan ngga',
      'anonymous',
      'rahasia ngga',
      'data aku aman',
      'identitas disimpen ngga',
      'nama disimpan ngga',
      'bakal bocor ga identitasku',
      'nama aku keliatan ga',
      'orang lain tau ga siapa yang kirim',
      'pengirim ketahuan ngga',
    ],
    jawaban:
      'Anonim 100%. Nama dan info pengirim tidak akan ditampilkan di postingan Instagram. Kami tidak menyimpan identitas aslimu.',
  },
  {
    pertanyaan: [
      'berapa kali kirim',
      'batas kirim',
      'limit kirim',
      'boleh kirim berapa',
      'maksimal kirim',
      'sehari berapa kali',
      'quota kirim',
      'boleh berapa menfes',
      'kirim berapa kali sehari',
      'batas pengiriman',
      'limit pengiriman',
      'sehari bisa kirim berapa',
      'maksimal berapa menfes per hari',
      'boleh kirim lebih dari 3',
      'kuota kirim sehari berapa',
    ],
    jawaban:
      'Kamu bisa kirim maksimal 3 menfes per hari. Kuota reset setiap tengah malam WIB.',
  },
  {
    pertanyaan: [
      'kena limit padahal baru kirim',
      'limit padahal belum kirim',
      'baru kirim sekali sudah limit',
      'kenapa kena limit',
      'limit 1 kali kirim',
      'limit padahal kirim dikit',
      'kok udah limit',
      'kenapa limit',
      'sudah limit padahal baru',
      'limit terus',
      'baru kirim 1 udah limit',
      'teman beda hp juga kena limit',
      'teman kena limit padahal beda orang',
      'ip sama jadi limit',
      'wifi kampus kena limit',
    ],
    jawaban:
      'Limit dihitung per IP (alamat jaringan). Kalau kamu pakai WiFi kampus atau jaringan yang sama dengan banyak orang, kuota bisa terbagi. Coba pakai data seluler sendiri.',
  },
  {
    pertanyaan: [
      'jam buka menfess',
      'jam berapa buka',
      'kapan buka',
      'jadwal buka',
      'buka jam berapa',
      'jam operasional',
      'jam menfess',
      'kapan menfess buka',
      'buka kapan',
      'jadwal menfes',
      'jam berapa bisa kirim',
      'waktu kirim menfes',
      'jam berapa menfes dibuka',
      'menfes buka sampai jam berapa',
      'jadwal operasional menfes',
      'open jam berapa',
    ],
    jawaban:
      'Jam buka menfess:\n- 08.00 - 10.00 WIB\n- 12.00 - 14.00 WIB\n- 16.00 - 21.00 WIB\n\nDi luar jam tersebut, pengiriman ditutup sementara.',
  },
  {
    pertanyaan: [
      'kenapa gabisa kirim',
      'tidak bisa kirim',
      'gagal kirim',
      'error kirim',
      'kenapa error',
      'menfes gagal',
      'ga bisa submit',
      'submit gagal',
      'kirim tapi error',
      'kenapa tidak bisa',
      'menfes tidak terkirim',
      'pengiriman gagal',
      'kenapa menfes gagal melulu',
      'selalu gagal kirim',
      'kirim menfes error terus',
      'kok gabisa submit',
      'ada masalah saat kirim',
    ],
    jawaban:
      'Kemungkinan penyebabnya:\n1. Menfess sedang tutup - cek jam buka (08.00-10.00, 12.00-14.00, 16.00-21.00 WIB)\n2. Kamu sudah mencapai limit 3 menfes hari ini\n3. Koneksi internetmu bermasalah\n4. Pesan terlalu pendek (min 5 karakter) atau terlalu panjang (maks 500 karakter)',
  },
  {
    pertanyaan: [
      'boleh kirim foto',
      'bisa kirim foto',
      'lampiran foto',
      'foto boleh',
      'kirim gambar',
      'bisa lampirkan foto',
      'foto bisa dilampirkan',
      'format foto',
      'ukuran foto',
      'foto maksimal',
      'bisa attach foto',
      'ngirim menfes sama foto bisa ga',
      'menfes bisa disertai gambar',
      'foto berapa mb maksimal',
      'format gambar yang diterima apa',
    ],
    jawaban:
      'Boleh. Kamu bisa lampirkan maksimal 4 foto format JPG atau PNG, ukuran maksimal 5 MB per foto. Format WebP tidak diterima.',
  },
  {
    pertanyaan: [
      'boleh kirim video',
      'bisa kirim video',
      'lampiran video',
      'video boleh',
      'kirim video',
      'format video',
      'ukuran video',
      'video maksimal',
      'durasi video',
      'video berapa detik',
      'bisa lampirkan video',
      'ngirim menfes sama video bisa ga',
      'video berapa mb maksimal',
      'durasi video maksimal berapa',
      'video minimal berapa detik',
    ],
    jawaban:
      'Boleh 1 video per menfes. Format MP4, MOV, atau WebM, ukuran maksimal 25 MB, durasi 3-60 detik. Video akan jadi slide terakhir di postingan Instagram.',
  },
  {
    pertanyaan: [
      'total ukuran lampiran',
      'total foto video',
      'batas total lampiran',
      'ukuran total',
      'maksimal total upload',
      'total file berapa mb',
      'batas ukuran semua lampiran',
    ],
    jawaban:
      'Total semua lampiran (foto + video) maksimal 45 MB.',
  },
  {
    pertanyaan: [
      'kapan menfes tayang',
      'kapan ditayangkan',
      'berapa lama diapprove',
      'kapan disetujui',
      'lama approve',
      'menfes kapan muncul',
      'kapan di instagram',
      'berapa lama tunggu',
      'proses moderasi',
      'menfes diproses berapa lama',
      'menfes aku kapan tayang',
      'udah lama ga tayang tayang',
      'menfes sudah lama belum muncul',
      'estimasi berapa lama approve',
      'menfes pending berapa lama',
    ],
    jawaban:
      'Menfesmu akan tayang setelah disetujui admin. Tidak ada waktu pasti karena tergantung antrian dan waktu admin online. Sabar ya.',
  },
  {
    pertanyaan: [
      'menfes ditolak',
      'menfes tidak muncul',
      'kenapa tidak tayang',
      'menfes hilang',
      'tidak ada notif ditolak',
      'notif ditolak',
      'menfes dihapus',
      'kenapa tidak di instagram',
      'menfes tidak disetujui',
      'menfes aku kemana',
      'menfes ga ada di ig',
      'kenapa menfes ga keluar',
      'tidak ada pemberitahuan ditolak',
      'ga ada notifikasi',
    ],
    jawaban:
      'Kalau menfesmu tidak muncul di Instagram, kemungkinan tidak disetujui admin. Memang tidak ada notifikasi penolakan. Pastikan pesanmu sesuai aturan.',
  },
  {
    pertanyaan: [
      'ada fitur musik',
      'bisa tambah lagu',
      'fitur lagu',
      'musik di menfes',
      'cara tambah musik',
      'lagu bisa dilampirkan',
      'tambah musik',
      'menfes ada musiknya',
      'cara pilih lagu',
      'bisa request lagu',
      'nambah lagu gimana',
      'musik itu fitur apa',
      'cara cari lagu di form',
    ],
    jawaban:
      'Ada. Kamu bisa tambahkan lagu pilihan di kolom Musik saat mengisi form. Cari judul lagu, lalu pilih dari hasil pencarian. Lagu akan ditampilkan di postingan.',
  },
  {
    pertanyaan: [
      'template itu apa',
      'template menfes',
      'cara pilih template',
      'ada berapa template',
      'apa itu template',
      'template artinya apa',
      'ganti template',
      'template bedanya apa',
      'pilih template yang mana',
      'template pengaruh ke apa',
      'tampilan menfes di ig gimana',
    ],
    jawaban:
      'Template adalah desain tampilan menfesmu di Instagram. Kamu bisa pilih salah satu template yang tersedia sebelum kirim. Tampilan pesanmu akan menyesuaikan template yang dipilih.',
  },
  {
    pertanyaan: [
      'menfes itu apa',
      'apa itu menfes',
      'apa itu menfess',
      'pengertian menfes',
      'menfes artinya',
      'web ini untuk apa',
      'fungsi web ini',
      'harkat nekat itu apa',
      'ini web apa',
      'kegunaan web ini apa',
      'menfes buat apa',
    ],
    jawaban:
      'Menfess (mention confess) adalah pesan anonim yang dikirim ke akun Instagram kami. Kamu bisa confession atau kirim pesan ke seseorang tanpa ketahuan identitasmu.',
  },
  {
    pertanyaan: [
      'halo',
      'hai',
      'hi',
      'hello',
      'hey',
      'hei',
      'assalamualaikum',
      'selamat pagi',
      'selamat siang',
      'selamat malam',
      'halo bot',
      'ada orang',
      'ada yang bisa bantu',
      'mau tanya',
      'numpang tanya',
      'permisi mau tanya',
    ],
    jawaban:
      'Halo! Aku asisten Harkat Nekat. Tanya apa aja soal cara pakai web ini, aku siap bantu.',
  },
  {
    pertanyaan: [
      'terima kasih',
      'makasih',
      'thanks',
      'thx',
      'tq',
      'thank you',
      'tengkyu',
      'oke makasih',
      'oke thanks',
      'udah cukup makasih',
      'oke terima kasih',
    ],
    jawaban: 'Sama-sama. Senang bisa bantu. Ada pertanyaan lain?',
  },
];

// ── TF-IDF + Cosine Similarity ────────────────────────────────────────────────

function hitungTF(tokens) {
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  return tf;
}

function bangunIndeks(faq) {
  const dokumen = faq.map((item) => item.pertanyaan.join(' '));
  const tokens = dokumen.map(preprocess);

  const df = {};
  const N = tokens.length;
  for (const toks of tokens) {
    const unik = new Set(toks);
    for (const t of unik) {
      df[t] = (df[t] || 0) + 1;
    }
  }

  const vektor = tokens.map((toks) => {
    const tf = hitungTF(toks);
    const vec = {};
    for (const [term, freq] of Object.entries(tf)) {
      const idf = Math.log((N + 1) / ((df[term] || 0) + 1)) + 1;
      vec[term] = (freq / toks.length) * idf;
    }
    return vec;
  });

  return { vektor, df, N };
}

function vektorQuery(query, df, N) {
  const tokens = preprocess(query);
  const tf = hitungTF(tokens);
  const vec = {};
  for (const [term, freq] of Object.entries(tf)) {
    const idf = Math.log((N + 1) / ((df[term] || 0) + 1)) + 1;
    vec[term] = (freq / tokens.length) * idf;
  }
  return vec;
}

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, v] of Object.entries(a)) {
    dot += v * (b[k] || 0);
    normA += v * v;
  }
  for (const v of Object.values(b)) {
    normB += v * v;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Bangun indeks sekali saat modul di-load
const { vektor, df, N } = bangunIndeks(FAQ);

/**
 * Cari jawaban paling relevan untuk pertanyaan user.
 */
function cariJawaban(pertanyaan) {
  const qVec = vektorQuery(pertanyaan, df, N);
  let skorTerbaik = -1;
  let idxTerbaik = -1;

  for (let i = 0; i < vektor.length; i++) {
    const s = cosine(qVec, vektor[i]);
    if (s > skorTerbaik) {
      skorTerbaik = s;
      idxTerbaik = i;
    }
  }

  // Kalau token query kosong setelah preprocessing, cek apakah input asli
  // mengandung niat bertanya ("mau tanya", "boleh tanya", dll) atau cuma sapaan.
  const tokenQuery = preprocess(pertanyaan);

  // Cek niat tanya dari token mentah (sebelum preprocessing membuang semuanya)
  const tokenMentah = pertanyaan.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  const adaNiatTanya = tokenMentah.some((t) => NIAT_TANYA.has(t));

  // Kalau setelah preprocessing tidak ada token substantif, balas sesuai konteks
  if (tokenQuery.length === 0 || (tokenQuery.length <= 1 && NIAT_TANYA.has(tokenQuery[0]))) {
    return {
      jawaban: adaNiatTanya
        ? 'Iya boleh, mau tanya apa?'
        : 'Halo! Ada yang bisa aku bantu?',
      skor: 0,
    };
  }

  const THRESHOLD = 0.05;
  if (skorTerbaik < THRESHOLD || idxTerbaik === -1) {
    return {
      jawaban:
        'Hmm, aku kurang paham pertanyaanmu. Coba tanya dengan kata lain, atau hubungi admin lewat Instagram kami ya.',
      skor: skorTerbaik,
    };
  }

  return {
    jawaban: FAQ[idxTerbaik].jawaban,
    skor: skorTerbaik,
  };
}

module.exports = { cariJawaban };
