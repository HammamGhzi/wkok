/**
 * Uji services/igPublish.js tanpa jaringan dan tanpa menyentuh disk.
 *
 * Yang paling penting di sini bukan "fungsi mengembalikan apa", tapi apakah
 * media_publish bisa dipanggil dua kali untuk menfes yang sama. Endpoint itu
 * tidak idempoten, jadi dua panggilan berarti dua postingan di akun sungguhan
 * dan tidak ada cara menarik keduanya kembali. Karena itu ada uji konkurensi
 * yang memanggil terbitkan dua kali sekaligus lalu menghitung berapa kali
 * Instagram benar-benar ditanggil.
 *
 * Prisma dan instagramApi diganti stub lewat Module._load, jadi tidak ada
 * koneksi database dan tidak ada panggilan ke Instagram.
 */
const Module = require('module');
const EventEmitter = require('module').EventEmitter;

// ─── Stub prisma ──────────────────────────────────────────────────────────────

const prismaCalls = [];
let updateManyCount = 1;
let baris = null;
let findUniqueThrows = false;

const prismaStub = {
  menfes: {
    async updateMany(args) {
      prismaCalls.push({ op: 'updateMany', args });
      return { count: updateManyCount };
    },
    async update(args) {
      prismaCalls.push({ op: 'update', args });
      return { id: args.where.id, ...args.data };
    },
    async findUnique(args) {
      prismaCalls.push({ op: 'findUnique', args });
      if (findUniqueThrows) throw new Error('database tidak bisa dibaca');
      return baris;
    },
  },
};

// ─── Stub fs/promises ─────────────────────────────────────────────────────────

const fileTertulis = [];

const fsStub = {
  mkdir: async () => {},
  writeFile: async (p, data) => {
    fileTertulis.push({ path: p, bytes: data.length });
  },
};

// ─── Stub instagramApi ────────────────────────────────────────────────────────

const igCalls = [];
let jebakan = null;

const igStub = {
  createImageContainer: async (args) => {
    igCalls.push({ fn: 'createImageContainer', args });
    if (jebakan === 'container') throw new Error('container ditolak Instagram');
    // Stub ini menegakkan batas caption yang sama seperti instagramApi.js.
    // Kalau tidak, caption kepanjangan akan lolos ke publish dan ujinya
    // berbohong: ia akan menguji stub, bukan perilaku yang sebenarnya terjadi.
    const panjang = (args.caption ?? '').length;
    if (panjang > 2200) throw new Error(`Caption ${panjang} karakter, batas 2200.`);
    return { creationId: 'CREATION-XYZ' };
  },
  // FINISHED langsung pada cek pertama: tidak ada polling, tidak ada tidur.
  getContainerStatus: async (id) => {
    igCalls.push({ fn: 'getContainerStatus', id });
    return 'FINISHED';
  },
  createCarouselContainer: async (args) => {
    igCalls.push({ fn: 'createCarouselContainer', args });
    if (jebakan === 'carousel') throw new Error('carousel ditolak Instagram');
    if (!Array.isArray(args.children) || args.children.length < 2) {
      throw new Error('Carousel butuh 2-10 container anak.');
    }
    const panjang = (args.caption ?? '').length;
    if (panjang > 2200) throw new Error(`Caption ${panjang} karakter, batas 2200.`);
    return { creationId: 'CAROUSEL-INDUK-1' };
  },
  publishContainer: async (id) => {
    igCalls.push({ fn: 'publishContainer', id });
    if (jebakan === 'publish') throw new Error('publish ditolak Instagram');
    return { mediaId: 'MEDIA-777', permalink: 'https://instagram.com/p/TES/' };
  },
};

// ─── Pasang stub sebelum modul asli dimuat ───────────────────────────────────

const asliLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '../lib/prisma') return prismaStub;
  if (request === './instagramApi') return igStub;
  if (request === 'fs/promises') return fsStub;
  return asliLoad.call(this, request, parent, isMain);
};

const igPublish = require('./src/services/igPublish');

Module._load = asliLoad;

// ─── Kerangka tes ─────────────────────────────────────────────────────────────

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'OK   ' : 'GAGAL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

const JPEG = Buffer.from('fake-jpeg-bytes');

const updateManyAsli = prismaStub.menfes.updateMany;

function reset() {
  // uji konkurensi mengganti updateMany dengan versi yang hanya berhasil sekali.
  // Kalau tidak dipulihkan, setiap reset sesudahnya ikut terpengaruh dan
  // ujinya tidak lagi mengisolasi apa yang seharusnya diuji.
  prismaStub.menfes.updateMany = updateManyAsli;
  prismaCalls.length = 0;
  igCalls.length = 0;
  fileTertulis.length = 0;
  updateManyCount = 1;
  findUniqueThrows = false;
  jebakan = null;
  baris = { id: 'M1', igStatus: null, igMediaId: null, igPermalink: null, status: 'APPROVED' };
  process.env.IG_PUBLIC_BASE_URL = 'https://menfs.onrender.com';
}

async function grab(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

const jumlahPublish = () => igCalls.filter((c) => c.fn === 'publishContainer').length;
const updateTerakhir = () => {
  const u = prismaCalls.filter((c) => c.op === 'update').pop();
  return u ? u.args.data : {};
};

async function main() {
  // ─── 1. baseUrlPublik ──────────────────────────────────────────────────────
  console.log('\n== baseUrlPublik ==');
  reset();
  check('mengembalikan nilai dari env', igPublish.baseUrlPublik() === 'https://menfs.onrender.com');
  process.env.IG_PUBLIC_BASE_URL = 'https://menfs.onrender.com///';
  check('garis miring di akhir dibuang', igPublish.baseUrlPublik() === 'https://menfs.onrender.com');
  delete process.env.IG_PUBLIC_BASE_URL;
  let e = await grab(() => igPublish.baseUrlPublik());
  check('melempar kalau env kosong', e !== null && /IG_PUBLIC_BASE_URL/.test(e.message));
  check('pesan tidak menebak dari host header', !/localhost/.test(e?.message || ''));
  check('pesan menyebut nama variabel', /IG_PUBLIC_BASE_URL/.test(e?.message || ''));
  reset();

  // ─── 2. simpanGambar ───────────────────────────────────────────────────────
  console.log('\n== simpanGambar ==');
  reset();
  let g = await igPublish.simpanGambar(JPEG, 'image/jpeg', 'M1');
  check('JPEG diterima', g.url.endsWith('.jpg'), g.url);
  check('URL memakai base publik', g.url.startsWith('https://menfs.onrender.com/uploads/ig/'));
  check('file benar-benar ditulis', fileTertulis.length === 1);

  g = await igPublish.simpanGambar(JPEG, 'image/png', 'M1');
  check('PNG diterima', g.url.endsWith('.png'), g.url);

  e = await grab(() => igPublish.simpanGambar(JPEG, 'image/gif', 'M1'));
  check('GIF ditolak', e !== null && /tidak didukung/.test(e.message));
  e = await grab(() => igPublish.simpanGambar(JPEG, 'application/pdf', 'M1'));
  check('PDF ditolak', e !== null);

  e = await grab(() => igPublish.simpanGambar(Buffer.alloc(0), 'image/jpeg', 'M1'));
  check('buffer kosong ditolak', e !== null && /kosong/.test(e.message));

  const gede = Buffer.alloc(9 * 1024 * 1024);
  e = await grab(() => igPublish.simpanGambar(gede, 'image/jpeg', 'M1'));
  check('gambar melebihi batas ditolak', e !== null && /batas/.test(e.message));

  // Path traversal: id berisi "../" tidak boleh keluar dari folder upload.
  reset();
  g = await igPublish.simpanGambar(JPEG, 'image/jpeg', '../../../../etc/passwd');
  check('nama file bebas dari path traversal', !g.namaFile.includes('..') && !g.namaFile.includes('/'), g.namaFile);
  check('path tetap di dalam UPLOAD_DIR', fileTertulis[0].path.startsWith(igPublish.UPLOAD_DIR));

  reset();
  g = await igPublish.simpanGambar(JPEG, 'image/jpeg', 'M1');
  const g2 = await igPublish.simpanGambar(JPEG, 'image/jpeg', 'M1');
  check('dua upload id sama punya nama beda', g.namaFile !== g2.namaFile);

  // ─── 3. Menolak menfes yang sudah tayang ────────────────────────────────────
  console.log('\n== guard: sudah tayang ==');
  reset();
  baris = { id: 'M1', igStatus: 'PUBLISHED', igMediaId: 'M-1', igPermalink: 'https://www.instagram.com/p/M-1/', status: 'APPROVED' };
  e = await grab(() => igPublish.terbitkan({ menfesId: 'M1', imageBuffer: JPEG, mimeType: 'image/jpeg' }));
  check('ditolak', e !== null && e.kode === 'SUDAH_TAYANG', e?.kode);
  check('pesan menyebut tautan yang sudah ada', /www\.instagram\.com\/p\//.test(e?.message || ''), e?.message);
  check('Instagram sama sekali tidak dipanggil', igCalls.length === 0);
  check('tidak ada file ditulis', fileTertulis.length === 0);

  reset();
  baris = { id: 'M1', igStatus: 'PUBLISHED', igMediaId: 'M-1', igPermalink: null, status: 'APPROVED' };
  e = await grab(() => igPublish.terbitkan({ menfesId: 'M1', imageBuffer: JPEG, mimeType: 'image/jpeg' }));
  check('ditolak walau permalink kosong', e !== null && e.kode === 'SUDAH_TAYANG');

  // ─── 4. Klaim gagal: ada proses lain yang lebih dulu ───────────────────────
  console.log('\n== guard: klaim gagal ==');
  reset();
  updateManyCount = 0;
  baris = { id: 'M1', igStatus: 'PENDING', igMediaId: null, igPermalink: null, status: 'APPROVED' };
  e = await grab(() => igPublish.terbitkan({ menfesId: 'M1', imageBuffer: JPEG, mimeType: 'image/jpeg' }));
  check('ditolak', e !== null && e.kode === 'SEDANG_PROSES', e?.kode);
  check('Instagram tidak dipanggil', igCalls.length === 0);

  // ─── 5. Uji konkurensi: dua panggilan paralel, satu publish ───────────────
  console.log('\n== konkurensi ==');
  reset();
  // Klaim hanya berhasil untuk pemanggil pertama.
  let sudahDiklaim = false;
  prismaStub.menfes.updateMany = async (args) => {
    prismaCalls.push({ op: 'updateMany', args });
    if (sudahDiklaim) return { count: 0 };
    sudahDiklaim = true;
    return { count: 1 };
  };
  const hasil = await Promise.allSettled([
    igPublish.terbitkan({ menfesId: 'M1', imageBuffer: JPEG, mimeType: 'image/jpeg', caption: 'a' }),
    igPublish.terbitkan({ menfesId: 'M1', imageBuffer: JPEG, mimeType: 'image/jpeg', caption: 'b' }),
  ]);
  const berhasil = hasil.filter((h) => h.status === 'fulfilled').length;
  const gagal = hasil.filter((h) => h.status === 'rejected').length;
  check('tepat satu panggilan berhasil', berhasil === 1, `${berhasil} berhasil`);
  check('tepat satu panggilan ditolak', gagal === 1, `${gagal} ditolak`);
  check('publishContainer dipanggil TEBAK SATU KALI', jumlahPublish() === 1, String(jumlahPublish()));
  check('createImageContainer dipanggil satu kali', igCalls.filter((c) => c.fn === 'createImageContainer').length === 1);

  // ─── 6. Jalur sukses ───────────────────────────────────────────────────────
  console.log('\n== jalur sukses ==');
  reset();
  const r = await igPublish.terbitkan({
    menfesId: 'M1',
    imageBuffer: JPEG,
    mimeType: 'image/jpeg',
    caption: '  halo dunia  ',
  });
  check('mediaId dikembalikan', r.mediaId === 'MEDIA-777', r.mediaId);
  check('permalink dikembalikan', r.permalink === 'https://instagram.com/p/TES/');
  check('imageUrl dikembalikan', r.imageUrl.startsWith('https://'));
  check('igStatus ditulis PUBLISHED', updateTerakhir().igStatus === 'PUBLISHED', updateTerakhir().igStatus);
  check('igMediaId ditulis', updateTerakhir().igMediaId === 'MEDIA-777');
  check('igPermalink ditulis', updateTerakhir().igPermalink === 'https://instagram.com/p/TES/');
  check('igPublishedAt diisi', updateTerakhir().igPublishedAt instanceof Date);
  check('igError dikosongkan', updateTerakhir().igError === null);
  const simpan = prismaCalls.filter((c) => c.op === 'update' && c.args.data.igImageUrl).pop();
  check('caption dipangkas spasi', simpan?.args.data.igCaption === 'halo dunia', simpan?.args.data.igCaption);
  const kirim = igCalls.find((c) => c.fn === 'createImageContainer');
  check('caption ke container sudah dipangkas', kirim.args.caption === 'halo dunia');

  // ─── 6b. Carousel: ada foto pengirim ───────────────────────────────────────
  console.log('\n== carousel (foto pengirim) ==');
  reset();
  baris = {
    id: 'M1', igStatus: null, igMediaId: null, igPermalink: null,
    status: 'APPROVED', fotoUrl: '/uploads/foto/foto-uji.png',
  };
  const rFoto = await igPublish.terbitkan({
    menfesId: 'M1',
    imageBuffer: JPEG,
    mimeType: 'image/jpeg',
    caption: '  halo carousel  ',
  });
  const anak = igCalls.filter((c) => c.fn === 'createImageContainer');
  const induk = igCalls.filter((c) => c.fn === 'createCarouselContainer');
  check('dua container anak dibuat (kartu + foto)', anak.length === 2, String(anak.length));
  check('anak tanpa caption (caption hanya di induk)',
    anak.every((c) => c.args.caption === undefined),
    JSON.stringify(anak.map((c) => c.args.caption)));
  check('anak pertama kartu, anak kedua foto pengirim',
    anak[0]?.args.imageUrl.includes('/uploads/ig/') && anak[1]?.args.imageUrl.includes('/uploads/foto/'),
    `${anak[0]?.args.imageUrl} | ${anak[1]?.args.imageUrl}`);
  check('container induk CAROUSEL dibuat', induk.length === 1, String(induk.length));
  check('induk membawa 2 children',
    induk[0]?.args.children?.length === 2, JSON.stringify(induk[0]?.args.children));
  check('caption induk dipangkas', induk[0]?.args.caption === 'halo carousel', induk[0]?.args.caption);
  check('publish memakai creation id induk',
    igCalls.find((c) => c.fn === 'publishContainer')?.id === 'CAROUSEL-INDUK-1');
  check('tanpa peringatan kalau carousel lancar', rFoto.peringatan === null, String(rFoto.peringatan));
  check('igStatus ditulis PUBLISHED', updateTerakhir().igStatus === 'PUBLISHED', updateTerakhir().igStatus);

  // Kegagalan membangun carousel: kartu TETAP tayang tanpa foto, dengan
  // peringatan terbuka — bukan gagal total dan bukan ditelan diam-diam.
  console.log('\n== carousel gagal -> fallback kartu tunggal ==');
  reset();
  baris = {
    id: 'M1', igStatus: null, igMediaId: null, igPermalink: null,
    status: 'APPROVED', fotoUrl: '/uploads/foto/foto-uji.png',
  };
  jebakan = 'carousel';
  const rFallback = await igPublish.terbitkan({
    menfesId: 'M1',
    imageBuffer: JPEG,
    mimeType: 'image/jpeg',
    caption: 'caption tetap utuh',
  });
  check('publish tetap terjadi tepat satu kali', jumlahPublish() === 1, String(jumlahPublish()));
  check('publish memakai container kartu tunggal',
    igCalls.find((c) => c.fn === 'publishContainer')?.id === 'CREATION-XYZ');
  const anakFallback = igCalls.filter((c) => c.fn === 'createImageContainer');
  check('container ketiga dibuat ulang ber-caption (fallback)',
    anakFallback.length === 3 && anakFallback[2].args.caption === 'caption tetap utuh',
    JSON.stringify(anakFallback.map((c) => c.args.caption)));
  check('peringatan menyebut foto gagal',
    /Foto tidak bisa diproses/.test(rFallback.peringatan || ''), rFallback.peringatan);
  check('status akhir tetap PUBLISHED', updateTerakhir().igStatus === 'PUBLISHED', updateTerakhir().igStatus);

  // ─── 7. Kegagalan di tiap tahap ────────────────────────────────────────────
  console.log('\n== kegagalan ==');
  reset();
  jebakan = 'container';
  e = await grab(() => igPublish.terbitkan({ menfesId: 'M1', imageBuffer: JPEG, mimeType: 'image/jpeg' }));
  check('kegagalan container dilempar', e !== null);
  check('tahap ditandai container', e?.tahap === 'container', e?.tahap);
  check('igStatus ditulis FAILED', updateTerakhir().igStatus === 'FAILED');
  check('igError menyimpan pesan', /ditolak/.test(updateTerakhir().igError || ''), updateTerakhir().igError);
  check('publish tidak dipanggil', jumlahPublish() === 0);

  reset();
  jebakan = 'publish';
  e = await grab(() => igPublish.terbitkan({ menfesId: 'M1', imageBuffer: JPEG, mimeType: 'image/jpeg' }));
  check('kegagalan publish dilempar', e !== null);
  check('tahap ditandai media_publish', e?.tahap === 'media_publish', e?.tahap);
  check('igStatus ditulis FAILED', updateTerakhir().igStatus === 'FAILED');

  // Caption kepanjangan ditolak instagramApi sebelum sampai publish.
  reset();
  e = await grab(() =>
    igPublish.terbitkan({
      menfesId: 'M1',
      imageBuffer: JPEG,
      mimeType: 'image/jpeg',
      caption: 'x'.repeat(2201),
    })
  );
  check('caption kepanjangan menggagalkan publikasi', e !== null);
  check('tidak ada publish terpanggil', jumlahPublish() === 0);
  check('status akhir FAILED', updateTerakhir().igStatus === 'FAILED');

  // Caption tepat di batas harus lolos validasi.
  reset();
  const batas = await igPublish.terbitkan({
    menfesId: 'M1',
    imageBuffer: JPEG,
    mimeType: 'image/jpeg',
    caption: 'y'.repeat(2200),
  });
  check('caption tepat 2200 karakter lolos', batas.mediaId === 'MEDIA-777');

  // ─── 8. Menfes tidak ada ──────────────────────────────────────────────────
  reset();
  baris = null;
  e = await grab(() => igPublish.terbitkan({ menfesId: 'TIDAK-ADA', imageBuffer: JPEG, mimeType: 'image/jpeg' }));
  check('menfes tidak ada ditolak', e !== null && e.kode === 'NOT_FOUND', e?.kode);

  // ─── 9. Database gagal tidak boleh dianggap sukses ─────────────────────────
  reset();
  findUniqueThrows = true;
  e = await grab(() => igPublish.terbitkan({ menfesId: 'M1', imageBuffer: JPEG, mimeType: 'image/jpeg' }));
  check('kegagalan baca database dilempar', e !== null);
  check('Instagram tidak dipanggil', igCalls.length === 0);

  // ─── Ringkasan ─────────────────────────────────────────────────────────────
  const gagal2 = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(60));
  console.log(`${results.length - gagal2.length}/${results.length} lulus`);
  if (gagal2.length > 0) {
    console.log('\nGAGAL:');
    for (const g of gagal2) console.log(`  - ${g.name}`);
  }
  console.log('='.repeat(60));
  process.exit(gagal2.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTes gagal total:', err);
  process.exit(1);
});