// Pecah daftar baris hasil wrap jadi batch per kartu.
// Dipakai fitur multicard: pesan panjang dibagi jadi beberapa kartu,
// tiap kartu maksimal `maxLines` baris.
//
// Input kosong menghasilkan `[[]]` — satu kartu kosong, supaya placeholder
// tetap tampil normal saat pesan belum diisi.
export function chunkLines(allLines, maxLines) {
  if (!allLines.length) return [[]];
  // Jaga dari infinite loop kalau maxLines cacat (0/NaN).
  // ponytail: cukup dipaksa 1; kalau ada pemanggil butuh error, ganti jadi throw.
  if (!(maxLines >= 1)) maxLines = 1;

  const chunks = [];
  for (let i = 0; i < allLines.length; i += maxLines) {
    chunks.push(allLines.slice(i, i + maxLines));
  }
  return chunks;
}
