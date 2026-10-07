-- Kolom foto opsional dari pengirim. Nullable tanpa nilai bawaan: 600+ baris
-- yang sudah ada tidak perlu disentuh, dan NULL jelas berarti "tanpa foto".
ALTER TABLE "Menfes" ADD COLUMN "fotoUrl" TEXT;
