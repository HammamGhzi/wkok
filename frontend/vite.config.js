import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // PENTING: pakai polling untuk file watcher.
    //
    // Gejala kalau tanpa ini (khusus di Windows):
    //   Error: EBUSY: resource busy or locked, watch '.../public/template/x.png'
    //     errno: -4082, syscall: 'watch'
    //     at NodeFsHandler._handleFile ... _addToNodeFs
    //
    // Kronologi: ada file baru muncul di public/template/ (mis. hasil download
    // atau copy gambar) -> chokidar emit 'add' -> vite manggil fs.watch() di
    // file itu secara individual -> file-nya sedang dipegang proses lain ->
    // Windows balas ERROR_SHARING_VIOLATION -> libuv petakan jadi EBUSY ->
    // vite tidak pasang handler 'error' di FSWatcher itu -> Node anggap uncaught
    // exception -> SELURUH dev server mati.
    //
    // usePolling membuat chokidar pakai fs.watchFile (stat-based) alih-alih
    // fs.watch, jadi tidak pernah memegang handle eksklusif dan tidak bisa
    // kena EBUSY.
    //
    // JANGAN menggantinya dengan ignored: ['**/public/**']. Itu kelihatan
    // seperti solusi, tapi merusak hal yang lebih penting: vite hanya
    // meng-update cache daftar file public/ dari event watcher 'add'/'unlink'
    // (lihat onFileAddUnlink di vite/dist/.../dep-*.js). Kalau public/ tidak
    // di-watch, file gambar yang baru di-copy ke public/template/ TIDAK akan
    // tersaji sama sekali - request-nya jatuh ke SPA fallback dan mengembalikan
    // index.html. Sudah diuji: dengan ignored, file baru -> 1626 byte text/html;
    // tanpa ignored -> 815474 byte image/png.
    //
    // Catatan: interval 200ms membuat HMR terasa sedikit lebih lambat dibanding
    // native watch. Kalau proses node terasa boros CPU, naikkan interval (mis. 500).
    watch: {
      usePolling: true,
      interval: 200,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // File foto pengirim (uploads/foto) di-backend. Tanpa proxy ini,
      // <img src="/uploads/..."> di dev jatuh ke SPA fallback dan balik
      // index.html — gambar rusak tanpa error yang kelihatan.
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
