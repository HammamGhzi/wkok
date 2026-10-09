// ── Akses YouTube Music (unofficial) ─────────────────────────────────────────
// Wrapper tipis di sekitar `ytmusic-api` (scraper komunitas, tak resmi).
// Sengaja dipisah di satu file: kalau library ini pecah karena YouTube
// mengubah API internalnya, cukup ganti isi file ini — controller dan route
// tidak tersentuh.
//
// initialize() dibuat LAZY (saat pencarian pertama) dan hasilnya di-cache
// sebagai promise, supaya:
//   - server tetap bisa start walau YouTube sedang tidak terjangkau;
//   - dua pencarian pertama yang berbarengan tidak memicu dua initialize;
//   - kegagalan initialize melempar error yang bisa ditangkap endpoint dan
//     dibalaskan sebagai 502 (bukan crash saat boot).
const YTMusic = require('ytmusic-api');

const ytm = new YTMusic();
let initSekali = null;

function siapkan() {
  if (!initSekali) {
    initSekali = ytm
      .initialize()
      .then((hasil) => {
        if (!hasil) {
          initSekali = null; // biarkan percobaan berikutnya mengulang dari nol
          throw new Error('ytmusic-api initialize() mengembalikan undefined');
        }
        return hasil;
      })
      .catch((err) => {
        initSekali = null;
        throw err;
      });
  }
  return initSekali;
}

/**
 * Cari lagu di YouTube Music berdasarkan kata kunci (tanpa login/cookies).
 * @returns {Promise<Array<{videoId: string, name: string,
 *   artist: {name: string}, duration: number|null,
 *   thumbnails: Array<{url: string}>}>>}
 */
async function cariLagu(kueri) {
  await siapkan();
  return ytm.searchSongs(kueri);
}

module.exports = { cariLagu };
