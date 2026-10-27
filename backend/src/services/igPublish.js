// Orkestrasi publikasi menfes ke Instagram.
//
// Urutan kerja satu menfes:
//
//   1. klaim pakai updateMany bersyarat   -> hanya satu proses boleh jalan
//   2. simpan gambar ke uploads/ig/       -> nama file dibuat dari id, bukan dari input
//   3. POST /media                        -> container (belum publik)
//      N kartu: anak per kartu berurutan, ditambah anak foto/video kalau ada,
//      semuanya jadi anak induk CAROUSEL. 1 kartu tanpa lampiran tetap satu
//      container ber-caption seperti jalur lama. Anak kartu gagal di tengah
//      -> gagal total (tidak ada carousel sebagian); anak foto/video gagal ->
//      kartu tayang tanpa lampiran + peringatan.
//   4. POST /media_publish                -> tayang di feed (SEKALI)
//   5. tulis hasilnya ke database
//
// BAHAYA YANG DIHANDLE FILE INI
//
// media_publish tidak idempoten. Panggil dua kali dengan creation id yang sama
// menghasilkan dua postingan di akun sungguhan, dan tidak ada cara menarik
// kembali keduanya diam-diam. Karena itu:
//
//   - Klaim kerja memakai updateMany bersyarat, bukan update biasa. Dua request
//     yang datang bersamaan hanya satu yang melihat count 1; yang satunya melihat
//     count 0 dan berhenti sebelum memanggil Instagram sama sekali.
//   - Menfes yang sudah PUBLISHED ditolak, bukan di-post ulang.
//   - PENDING yang lebih tua dianggap yatim dan boleh diklaim ulang, karena
//     container Instagram kedaluwarsa sendiri dalam 24 jam.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const ig = require('./instagramApi');

// Letak upload. Harus sama dengan yang dilayani express.static di src/index.js,
// yang menunjuk ../uploads relatif terhadap src/. resolved di sini supaya tidak
// bergantung pada process.cwd(), yang berbeda antara server dan skrip.
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'ig');

// Instagram hanya menerima JPEG dan PNG untuk feed.
const TIPE_BOKEH = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
]);

// Batas ukuran gambar. Hasil canvas di browser sekitar 200-500 KB, jadi 8 MB
// memberi ruang besar tanpa membuka pintu.upload abuse.
const UKURAN_MAKS = 8 * 1024 * 1024;

// Container Instagram kedaluwarsa dalam 24 jam. Ambil jauh lebih pendek supaya
// PENDING yang menggantung akibat proses mati bisa dicoba ulang di sesi yang
// sama, bukan menunggu sampai besok.
const UMUR_PENDING_MS = 25 * 60 * 1000;

/**
 * Base URL publik untukbackend, dipakai menyusun tautan gambar.
 *
 * Instagram menarik gambar dari server kita, jadi tautannya harus bisa dijangkau
 * dari internet. localhost tidak bisa, dan itu alasan nilai ini tidak boleh
 * ditebak dari Host header: header bisa dipalsukan, dan hasil tebakannya akan
 * tersimpan permanen di kolom igImageUrl.
 *
 * @returns {string} base URL tanpa garis miring di akhir
 * @throws {Error} kalau belum diisi
 */
function baseUrlPublik() {
  const raw = process.env.IG_PUBLIC_BASE_URL;
  if (!raw || !raw.trim()) {
    throw new Error(
      'IG_PUBLIC_BASE_URL belum diisi di .env. Instagram harus bisa menjangkau ' +
        'gambar lewat URL publik, jadi nilainya tidak bisa ditebak.',
    );
  }
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Periksa buffer gambar sebelum apa pun yang menyentuh disk atau database.
 *
 * Dipisah dari simpanGambar supaya controller bisa memanggilnya duluan. Kalau
 * pemeriksaan baru terjadi di dalam simpanGambar, tipe gambar yang salah sudah
 * terlanjur mengklaim hak proses lalu menandai menfes sebagai GAGAL, padahal
 * menfes itu tidak pernah dicoba. Input yang salah adalah kesalahan admin, dan
 * harus dibalas sebagai 400 tanpa mengubah apa pun.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {string} ekstensi hasil, 'jpg' atau 'png'
 * @throws {Error} dengan pesan yang bisa langsung ditampilkan ke admin
 */
function periksaGambar(buffer, mimeType) {
  const ext = TIPE_BOKEH.get(String(mimeType || '').toLowerCase());
  if (!ext) {
    throw new Error(
      `Tipe gambar tidak didukung: ${mimeType}. Instagram hanya menerima JPEG dan PNG.`,
    );
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Gambar kosong atau tidak terkirim.');
  }
  if (buffer.length > UKURAN_MAKS) {
    throw new Error(
      `Gambar ${(buffer.length / 1024 / 1024).toFixed(1)} MB, batas ${UKURAN_MAKS / 1024 / 1024} MB.`,
    );
  }
  return ext;
}

/**
 * Simpan buffer gambar ke disk dan kembalikan URL publiknya.
 *
 * Nama file dibangun dari id menfes dan angka acak, TIDAK PERNAH dari input
 * pengguna. Nama dari input membuka path traversal: "../../.env" sebagai
 * nama file akan menulis ke mana saja di disk.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} menfesId
 * @returns {Promise<{url: string, namaFile: string}>}
 */
async function simpanGambar(buffer, mimeType, menfesId) {
  const ext = periksaGambar(buffer, mimeType);

  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  // id menfes sudah UUID dari database, tapi tetap disanitasi defensif supaya
  // perubahan di masa depan tidak ikut membuka celah path traversal.
  const akar = String(menfesId).replace(/[^a-zA-Z0-9_-]/g, '');
  const namaFile = `${akar}-${crypto.randomBytes(6).toString('hex')}.${ext}`;

  await fs.writeFile(path.join(UPLOAD_DIR, namaFile), buffer);

  return {
    namaFile,
    url: `${baseUrlPublik()}/uploads/ig/${namaFile}`,
  };
}

/**
 * Klaim hak memproses satu menfes.
 *
 * Memakai updateMany dengan kondisi igStatus, bukan find-then-update. Bedanya
 * menentukan: dua request bersamaan yang keduanya melihat status NULL akan dua
 *-duanya lolos kalau pakai cara biasa. Dengan updateMany bersyarat, hanya satu
 * yang melihat count 1; yang satunya melihat count 0 dan berhenti sebelum
 * memanggil Instagram.
 *
 * @param {string} menfesId
 * @returns {Promise<{diklaim: boolean, alasan?: string}>}
 */
async function klaimKerja(menfesId) {
  const sekarang = Date.now();
  const batas = new Date(sekarang - UMUR_PENDING_MS);

  // Syarat: belum PUBLISHED, dan PENDING hanya boleh diklaim ulang kalau sudah
  // cukup lama, yang berarti proses sebelumnya memang tidak pernah selesai.
  const hasil = await prisma.menfes.updateMany({
    where: {
      id: menfesId,
      OR: [
        { igStatus: null },
        { igStatus: 'FAILED' },
        { igStatus: 'PENDING', igPublishedAt: null, updatedAt: { lt: batas } },
      ],
    },
    data: { igStatus: 'PENDING', igError: null },
  });

  if (hasil.count === 1) return { diklaim: true };
  return { diklaim: false };
}

/**
 * Baca status IG satu menfes, untuk pesan error yang informatif.
 *
 * @param {string} menfesId
 * @returns {Promise<object|null>}
 */
async function ambilStatus(menfesId) {
  return prisma.menfes.findUnique({
    where: { id: menfesId },
    select: { igStatus: true, igMediaId: true, igPermalink: true, status: true, fotoUrls: true, videoUrl: true },
  });
}

/**
 * Tunggu container selesai diproses oleh Instagram.
 *
 * Instagram memproses container secara asinkron, terutama kalau ada caption.
 * Publish dipanggil terlalu cepat akan gagal dengan error "media belum siap".
 * Fungsi ini polling status setiap 2 detik sampai FINISHED.
 *
 * @param {string} creationId
 * @param {number} timeoutMs maksimum waktu tunggu (default 30 detik)
 * @param {number} intervalMs interval polling (default 2 detik)
 * @returns {Promise<string>} status akhir container
 * @throws {Error} kalau timeout atau status ERROR
 */
async function tungguContainerSelesai(creationId, timeoutMs = 30000, intervalMs = 2000) {
  const batas = Date.now() + timeoutMs;

  // Cek pertama kali langsung, tanpa tunggu. Kalau container sudah FINISHED
  // (biasanya terjadi untuk gambar tanpa caption), tidak perlu polling sama
  // sekali.
  const statusPertama = await ig.getContainerStatus(creationId);
  if (statusPertama === 'FINISHED') return statusPertama;
  if (statusPertama === 'ERROR') {
    throw new Error('Instagram gagal memproses container. Coba lagi atau cek format gambar.');
  }

  // Polling: cek setiap intervalMs sampai selesai atau timeout.
  while (Date.now() < batas) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));

    const status = await ig.getContainerStatus(creationId);

    if (status === 'FINISHED') {
      return status;
    }

    if (status === 'ERROR') {
      throw new Error('Instagram gagal memproses container. Coba lagi atau cek format gambar.');
    }
  }

  throw new Error(`Timeout: container belum selesai dalam ${timeoutMs / 1000} detik.`);
}

/**
 * Publikasikan satu menfes ke Instagram.
 *
 * Fungsi ini menolak kalau menfes sudah pernah tayang. Panggilan ulang setelah
 * GAGAL tetap aman, karena GAGAL berarti tidak ada container yang berhasil
 * diterbitkan.
 *
 * @param {object} args
 * @param {string} args.menfesId
 * @param {Array<{buffer: Buffer, mimeType: string}>} args.buffers
 *        kartu berurutan (1-10), hasil canvas.toBlob dari browser. Urutan
 *        array = urutan slide di feed.
 * @param {string} [args.caption]    caption pilihan admin
 * @returns {Promise<{mediaId: string, permalink: string|null, imageUrl: string, peringatan: string|null}>}
 */
async function terbitkan({ menfesId, buffers, caption }) {
  // Validasi SEMUA kartu SEBELUM klaim. Alasannya sama seperti periksaGambar
  // di controller: input salah adalah kesalahan admin dan harus berhenti di
  // sini — tanpa klaim, tanpa file di disk, tanpa perubahan status menfes.
  // Kalau validasi ini jatuh setelah klaim, menfes yang tidak pernah dicoba
  // langsung tercatat GAGAL.
  const kartu = Array.isArray(buffers) ? buffers : [];
  if (kartu.length === 0) {
    const e = new Error('Field images wajib berisi minimal satu gambar.');
    e.kode = 'INPUT_SALAH';
    throw e;
  }
  for (let i = 0; i < kartu.length; i++) {
    try {
      periksaGambar(kartu[i]?.buffer, kartu[i]?.mimeType);
    } catch (err) {
      // Nomor kartu ikut disampaikan: admin mengunggah banyak file sekaligus,
      // pesan "tipe tidak didukung" tanpa nomor tidak bisa ditelusuri ke file.
      err.message = `Kartu ${i + 1}: ${err.message}`;
      err.kode = 'INPUT_SALAH';
      throw err;
    }
  }

  const ada = await ambilStatus(menfesId);
  if (!ada) {
    const e = new Error('Menfes tidak ditemukan.');
    e.kode = 'NOT_FOUND';
    throw e;
  }

  // Lampiran (foto/video) jadi anak SETELAH kartu, ikut dihitung terhadap batas
  // 10 anak Instagram, bukan cuma jumlah kartu. Dihitung SETELAH baris dibaca
  // karena lampiran tidak dikirim pemanggil, melainkan diambil dari kolom
  // fotoUrls/videoUrl.
  const fotoMentah = ada.fotoUrls || [];
  const jumlahLampiran = fotoMentah.length + (ada.videoUrl ? 1 : 0);
  if (kartu.length + jumlahLampiran > 10) {
    const e = new Error(
      `Total anak carousel ${kartu.length + jumlahLampiran} buah (kartu + lampiran), ` +
        'batas Instagram 10 gambar. Pangkas pesan atau kurangi lampiran.'
    );
    e.kode = 'INPUT_SALAH';
    throw e;
  }

  if (ada.igStatus === 'PUBLISHED') {
    const e = new Error(
      ada.igPermalink
        ? `Menfes ini sudah tayang di ${ada.igPermalink}.`
        : 'Menfes ini sudah pernah tayang. Menposting ulang akan membuat duplikat.',
    );
    e.kode = 'SUDAH_TAYANG';
    throw e;
  }

  const klaim = await klaimKerja(menfesId);
  if (!klaim.diklaim) {
    const e = new Error(
      ada.igStatus === 'PENDING'
        ? 'Menfes sedang diproses. Tunggu sebentar sebelum mencoba lagi.'
        : 'Menfes sudah tayang. Menposting ulang akan membuat duplikat.',
    );
    e.kode = 'SEDANG_PROSES';
    throw e;
  }

  // Caption dipangkas sekali di sini, lalu hasil yang sama dipakai untuk
  // database dan untuk Instagram. Sebelumnya database menyimpan versi
  // terpangkas sementara Instagram menerima versi mentah, jadi isi kolom
  // igCaption bisa berbeda dari caption yang benar-benar tayang.
  const teks = String(caption ?? '').trim();

  // Tahap dicatat terpisah dari tersimpan. Gambar yang sudah tersimpan tidak
  // berarti container sudah dibuat, jadi kegagalan membuat container juga
  // terjadi setelah file ada di disk.
  let tahap = 'simpan_gambar';
  let tersimpan = [];
  let peringatan = null;
  let creationIdFinal;
  try {
    // Semua kartu disimpan dulu, berurutan. Kolom igImageUrl hanya satu, jadi
    // yang masuk adalah kartu pertama; kolom itu tidak ditampilkan di mana
    // pun, tapi tetap diisi supaya tidak pernah kosong.
    for (let i = 0; i < kartu.length; i++) {
      tersimpan.push(await simpanGambar(kartu[i].buffer, kartu[i].mimeType, menfesId));
    }

    await prisma.menfes.update({
      where: { id: menfesId },
      data: { igImageUrl: tersimpan[0].url, igCaption: teks || null },
    });

    // ── Kartu tunggal ATAU carousel ─────────────────────────────────────────
    // Jumlah kartu + lampiran menentukan jalurnya: tanpa lampiran dan hanya
    // satu kartu, satu container ber-caption seperti sebelum fitur ini ada.
    // Selain itu post jadi carousel — caption hanya di container induk, semua
    // anak tanpa caption.
    //
    // Lampiran: foto berurutan, video selalu terakhir. Dua bentuk URL foto:
    // absolut Cloudinary (baris baru) dipakai apa adanya; path relatif lama
    // ('/uploads/foto/...') menempel ke base publik.
    const urlFotos = fotoMentah.map((u) =>
      /^https:\/\//.test(u) ? u : `${baseUrlPublik()}${u}`
    );

    // Video selalu URL Cloudinary absolut (hasil eager upload), jadi tidak ada
    // bentuk path relatif lama yang perlu ditempel base URL.
    const urlVideo = ada.videoUrl || null;

    const tunggu = async (creationId) => {
      const status = await tungguContainerSelesai(creationId);
      if (status !== 'FINISHED') {
        throw new Error(`Container tidak selesai diproses (status: ${status}).`);
      }
    };

    // Jatuh ke kartu tunggal ber-caption. Dipakai dua kali: foto gagal (kartu
    // pertama sudah jadi, tinggal dipublikasikan tanpanya) dan kegagalan lain
    // untuk menfes satu kartu. Kartu TETAP tayang tanpa foto — admin sudah
    // mengedit caption dan menunggu, menahan seluruh post hanya karena slide
    // terakhir bermasalah lebih merugikan daripada posting tanpa foto.
    // Kegagalannya tetap diucapkan terbuka lewat peringatan, bukan ditelan
    // diam-diam.
    const jatuhKeKartuTunggal = async (alasan, label = 'Foto') => {
      peringatan =
        `${label} tidak bisa diproses jadi carousel (${alasan}). ` +
        'Kartu tayang tanpa lampiran.';
      console.warn('IG carousel fallback:', alasan);

      tahap = 'container_fallback';
      const { creationId } = await ig.createImageContainer({
        imageUrl: tersimpan[0].url,
        caption: teks,
      });
      tahap = 'tunggu_container_fallback';
      await tunggu(creationId);
      creationIdFinal = creationId;
    };

    if (tersimpan.length === 1 && urlFotos.length === 0 && !urlVideo) {
      // Jalur lama, tanpa perubahan: satu container ber-caption, satu publish.
      // Sengaja BUKAN carousel berisi satu anak — Instagram hanya menerima
      // carousel berisi 2-10 anak, dan membuat container induk hanya untuk
      // satu kartu menambah satu putaran gagal tanpa ada yang didapat.
      tahap = 'container';
      const { creationId } = await ig.createImageContainer({
        imageUrl: tersimpan[0].url,
        caption: teks,
      });
      tahap = 'tunggu_container';
      await tunggu(creationId);
      creationIdFinal = creationId;
    } else {
      // Membangun anak dulu, baru memilih publish. Seluruh isi blok ini
      // terjadi SEBELUM media_publish — kalau gagal di mana pun di sini,
      // belum ada satu pun post yang tayang, jadi mengulang tidak mungkin
      // menghasilkan duplikat. media_publish tetap dipanggil SEKALI, hanya
      // untuk creation id final.
      try {
        const children = [];

        // Anak kartu dibuat berurutan 1..N. Gagal di tengah berarti ada kartu
        // yang tidak sempat jadi; menerbitkan carousel tanpanya menipu admin,
        // jadi biar dilempar, menfes jadi GAGAL, dan admin bisa mengulang dari
        // awal tanpa sisa postingan sebagian.
        for (let i = 0; i < tersimpan.length; i++) {
          tahap = 'container_kartu';
          const { creationId } = await ig.createImageContainer({
            imageUrl: tersimpan[i].url,
          });
          tahap = 'tunggu_container_kartu';
          await tunggu(creationId);
          children.push(creationId);
        }

        if (urlFotos.length > 0) {
          // Satu foto gagal tidak membatalkan foto lain: kumpulkan kegagalan,
          // lalu putuskan sekali di akhir.
          const gagal = [];
          for (let i = 0; i < urlFotos.length; i++) {
            try {
              tahap = 'container_foto';
              const { creationId: anakFoto } = await ig.createImageContainer({
                imageUrl: urlFotos[i],
              });
              tahap = 'tunggu_container_foto';
              await tunggu(anakFoto);
              children.push(anakFoto);
            } catch (errFoto) {
              gagal.push(`foto ${i + 1}: ${errFoto.message}`);
            }
          }

          if (gagal.length > 0) {
            // 1 kartu + SEMUA foto gugur + tidak ada video: sisa kartunya cuma
            // satu, jadi publikasikan sebagai kartu tunggal ber-caption. Kalau
            // ada video, carousel masih layak (kartu + video) — jangan buang
            // videonya karena foto gagal.
            if (tersimpan.length === 1 && gagal.length === urlFotos.length && !urlVideo) {
              await jatuhKeKartuTunggal(gagal[0]);
            } else {
              peringatan =
                `${gagal.length} dari ${urlFotos.length} foto tidak bisa diproses ` +
                `jadi carousel (${gagal.join('; ')}). Kartu tayang tanpa foto itu.`;
              console.warn('IG carousel fallback:', gagal.join('; '));
            }
          }
        }

        if (urlVideo) {
          try {
            tahap = 'container_video';
            const { creationId: anakVideo } = await ig.createVideoContainer({
              videoUrl: urlVideo,
              isCarouselItem: true,
            });
            tahap = 'tunggu_container_video';
            // Video diproses jauh lebih lama daripada gambar (Meta menyarankan
            // polling sampai 5 menit), jadi batas tunggunya lebih panjang.
            await tungguContainerSelesai(anakVideo, 5 * 60 * 1000);
            children.push(anakVideo);
          } catch (errVideo) {
            // Perlakuan sama dengan foto: video adalah pelengkap, kartu teks
            // tetap yang utama. Jangan tahan seluruh post karena satu slide.
            // Jatuh ke kartu tunggal hanya kalau tidak ada anak lain sama
            // sekali — kalau foto berhasil, carousel tetap bisa terbit.
            if (tersimpan.length === 1 && children.length === 1) {
              await jatuhKeKartuTunggal(errVideo.message, 'Video');
            } else {
              peringatan =
                `Video tidak bisa diproses jadi carousel (${errVideo.message}). ` +
                'Kartu tayang tanpa video.';
              console.warn('IG carousel fallback (video):', errVideo.message);
            }
          }
        }

        if (!creationIdFinal) {
          tahap = 'container_induk';
          const { creationId: induk } = await ig.createCarouselContainer({
            children,
            caption: teks,
          });

          tahap = 'tunggu_container_induk';
          await tunggu(induk);
          creationIdFinal = induk;
        }
      } catch (errCarousel) {
        // Untuk menfes SATU kartu, kegagalan apa pun di sini (anak kartu
        // pertama atau induknya) masih berarti kartunya bisa tayang sendiri —
        // itu jalur lama, dipertahankan persis.
        //
        // Untuk LEBIH dari satu kartu, kegagalan berarti ada kartu yang belum
        // jadi: menerbitkan sebagian jauh lebih menipu daripada gagal total,
        // jadi biar GAGAL dan dicoba ulang. percobaan ulang aman karena belum
        // ada satu pun media_publish yang terjadi.
        if (tersimpan.length > 1) throw errCarousel;
        await jatuhKeKartuTunggal(errCarousel.message);
      }
    }

    tahap = 'media_publish';
    const hasil = await ig.publishContainer(creationIdFinal);

    await prisma.menfes.update({
      where: { id: menfesId },
      data: {
        igStatus: 'PUBLISHED',
        igMediaId: hasil.mediaId,
        igPermalink: hasil.permalink,
        igPublishedAt: new Date(),
        igError: null,
      },
    });

    return {
      mediaId: hasil.mediaId,
      permalink: hasil.permalink,
      imageUrl: tersimpan[0].url,
      peringatan,
    };
  } catch (err) {
    await prisma.menfes.update({
      where: { id: menfesId },
      data: {
        igStatus: 'FAILED',
        // igError kolomnya TEXT dan bisa jadi panjang. Potong supaya tidak
        // freak out kalau errornya membawa HTML dari Facebook.
        igError: String(err?.message || err).slice(0, 1000),
      },
    });

    // Laporkan tahap gagal tanpa menutupi error aslinya. Admin perlu tahu ini
    // gagal di mana, bukan cuma bahwa gagal. Penanda tahap disimpan terpisah
    // dari tersimpan, karena gambar yang tersimpan tidak berarti container sudah
    // dibuat: kegagalan membuat container juga terjadi setelah file tersimpan.
    err.tahap = tahap;
    throw err;
  }
}

module.exports = {
  terbitkan,
  simpanGambar,
  periksaGambar,
  klaimKerja,
  baseUrlPublik,
  TIPE_BOKEH,
  UKURAN_MAKS,
  UMUR_PENDING_MS,
  UPLOAD_DIR,
};