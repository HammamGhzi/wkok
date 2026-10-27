-- Foto pengirim dari satu URL jadi array (maks 4). Baris lama yang punya
-- fotoUrl dipindahkan apa adanya; urutan array = urutan slide carousel.
ALTER TABLE "Menfes" ADD COLUMN "fotoUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Menfes"
SET "fotoUrls" = ARRAY["fotoUrl"]
WHERE "fotoUrl" IS NOT NULL AND "fotoUrl" <> '';

-- Satu sumber kebenaran: kolom tunggal dibuang setelah isinya disalin, supaya
-- tidak ada dua tempat yang bisa berbeda.
ALTER TABLE "Menfes" DROP COLUMN "fotoUrl";
