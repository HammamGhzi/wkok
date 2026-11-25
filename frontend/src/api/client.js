import axios from 'axios';

import { ruteApi } from './origin.js';

// VITE_API_URL = backend utama (termasuk WA). VITE_CHATBOT_API_URL = server
// FAQ. Kalau kosong, keduanya pakai /api (proxy Vite saat dev).
const { BASE_URL, CHATBOT_BASE_URL } = ruteApi({
  apiUrl: import.meta.env.VITE_API_URL,
  chatbotUrl: import.meta.env.VITE_CHATBOT_API_URL,
});

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── Request interceptor: Sisipkan token JWT ────────────────────────────────
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response interceptor: Handle 401 (token expired) ──────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    tangani401(error.response?.status);
    return Promise.reject(error);
  }
);

// ─── Helper untuk jalur yang tidak lewat axios ──────────────────────────────
//
// Unggah gambar ke Instagram memakai fetch, bukan axios (alasannya di
// adminAPI.postInstagram). Supaya jalur itu tidak jadi jalur tanpa pengaman,
// dua hal yang di interceptor dipindahkan ke sini dan dipanggil dari keduanya.

export function ambilToken() {
  return localStorage.getItem('admin_token');
}

export function tangani401(status) {
  if (status !== 401) return;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  // Redirect ke login jika bukan di halaman login
  if (!window.location.pathname.includes('/admin/login')) {
    window.location.href = '/admin/login';
  }
}

export { BASE_URL, CHATBOT_BASE_URL };

export default api;
