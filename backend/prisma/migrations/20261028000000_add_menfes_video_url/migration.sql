-- Kolom video opsional dari pengirim. Nullable tanpa nilai bawaan: baris yang
-- sudah ada tidak perlu disentuh, dan NULL jelas berarti "tanpa video".
-- Satu lampiran saja: foto ATAU video (dijaga di controller).
ALTER TABLE "Menfes" ADD COLUMN "videoUrl" TEXT;
