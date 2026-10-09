import { useEffect, useRef, useState } from 'react';

// ── Pemutar lagu tanpa UI player ─────────────────────────────────────────────
// Satu-satunya implementasi "klik -> bunyi" untuk lagu pilihan. Dipakai di
// dua tempat dengan tampilan berbeda tapi perilaku sama:
//   - MusicPicker (step 4 form user) — strip thumbnail di atas daftar hasil;
//   - ExportModal (modul export IG) — kartu info lagu di kolom controls.
//
// Bunyi datang dari embed resmi YouTube (youtube-nocookie) yang konsumen
// render lewat `player` yang dikembalikan hook ini — class `sr-only`
// (tersembunyi, bukan display:none) sehingga TIDAK ADA wujud player YouTube
// yang terlihat, sementara audio tetap jalan dan tidak lewat server kita.
//
// Posisi (detik) disimpan di ref, bukan state: perubahan per detik tidak
// perlu me-render ulang — src iframe hanya dibaca saat mount. Pause -> iframe
// dibuang (audio mati) + posisi terakumulasi; lanjut -> iframe mount ulang
// dengan `start=<posisi>`. Berhenti sendiri dihitung dari `durasiDetik`;
// kalau durasi tidak diketahui (null) tidak ada auto-stop (user jeda sendiri).
export default function usePreviewLagu({
  videoId,
  judul = '',
  durasiDetik = null,
  aktif = true,
}) {
  const [putar, setPutar] = useState(false);
  const detik = useRef(0);
  const mulaiPada = useRef(0);

  // Lepas player (dan matikan audionya) saat area pemakaian ditinggalkan —
  // tidak pernah ada audio ngehidden di belakang layar tanpa sebab.
  useEffect(() => {
    if (!aktif) setPutar(false);
  }, [aktif]);

  // VideoId dilepas -> berhenti + reset; videoId BERUBAH (ganti lagu) ->
  // posisi ikut reset supaya lagu baru mulai dari nol.
  useEffect(() => {
    if (!videoId) {
      setPutar(false);
    }
    detik.current = 0;
  }, [videoId]);

  // Timer berhenti sendiri. Deps memuat videoId+durasiDetik: ganti lagu saat
  // masih bunyi harus mematikan timer lama dan memasang hitungan yang baru.
  useEffect(() => {
    if (!putar || !videoId) return undefined;
    mulaiPada.current = Date.now();
    if (durasiDetik == null) return undefined;
    if (detik.current >= durasiDetik) {
      detik.current = 0;
      setPutar(false);
      return undefined;
    }
    const sisaMs = (durasiDetik - detik.current) * 1000;
    const jeda = setTimeout(() => {
      detik.current = 0;
      setPutar(false);
    }, sisaMs);
    return () => clearTimeout(jeda);
  }, [putar, videoId, durasiDetik]);

  // Toggle tombol putar/jeda: jeda mengakumulasi posisi, lanjut pakai
  // posisi terakhir lewat parameter `start`.
  function toggle() {
    if (putar) {
      const posisi =
        detik.current + Math.floor((Date.now() - mulaiPada.current) / 1000);
      detik.current =
        durasiDetik != null ? Math.min(durasiDetik, posisi) : posisi;
      setPutar(false);
    } else {
      mulaiPada.current = Date.now();
      setPutar(true);
    }
  }

  // Pilih/petik lagu dari daftar: langsung bunyi dari detik 0.
  function ulang() {
    detik.current = 0;
    mulaiPada.current = Date.now();
    setPutar(true);
  }

  // Elemen iframe-nya (atau null saat tidak bunyi). Konsumen tinggal
  // me-render `{player}` — taruh di mana saja, sr-only tidak mengubah layout.
  const player = putar && videoId ? (
    <iframe
      className="sr-only"
      src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&start=${detik.current}&rel=0`}
      title={`Preview ${judul}`}
      allow="autoplay; encrypted-media"
    />
  ) : null;

  return { putar, toggle, ulang, player };
}
