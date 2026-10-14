-- AlterTable
-- Sakelar buka/tutup kini bertiga: 'auto' (ikut jadwal) | 'buka' | 'tutup'.
-- ADDITIVE: kolom baru dengan DEFAULT, tidak ada yang di-drop atau diubah,
-- baris yang sudah ada otomatis mendapat 'auto' (bawaan perilaku baru:
-- situs mengikuti jadwal jam buka begitu migrasi ini masuk).
ALTER TABLE "SiteSetting" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'auto';
