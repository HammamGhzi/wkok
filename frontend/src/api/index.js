import api, { BASE_URL, ambilToken, tangani401 } from './client';

// ─── Auth ──────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (username, password) =>
    api.post('/auth/login', { username, password }),

  me: () =>
    api.get('/auth/me'),

  changePassword: (currentPassword, newPassword) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),

  // Memanggil ini membatalkan SEMUA token yang pernah terbit, bukan hanya
  // token milik pemanggil. Untuk panel satu admin itu menguntungkan: token
  // yang dicuri ikut mati saat pemilik logout.
  logout: () =>
    api.post('/auth/logout'),
};

// ─── Menfes Publik ────────────────────────────────────────────────────────
export const menfesAPI = {
  submit: (data) =>
    api.post('/menfes', data),

  getApproved: (page = 1, limit = 10) =>
    api.get('/menfes', { params: { page, limit } }),
};

// ─── Status buka/tutup situs ──────────────────────────────────────────────
export const siteAPI = {
  getStatus: () =>
    api.get('/site/status'),
};

// ─── Admin ────────────────────────────────────────────────────────────────
export const adminAPI = {
  getStats: () =>
    api.get('/admin/stats'),

  getMenfes: (status, page = 1, limit = 20) =>
    api.get('/admin/menfes', { params: { status, page, limit } }),

  approve: (id) =>
    api.patch(`/admin/menfes/${id}/approve`),

  reject: (id) =>
    api.patch(`/admin/menfes/${id}/reject`),

  delete: (id) =>
    api.delete(`/admin/menfes/${id}`),

  // Buka/tutup menfess untuk publik. Menulis baris SiteSetting di database,
  // jadi perubahannya langsung terbaca semua orang tanpa instance lain
  // perlu di-restart.
  setSiteOpen: (open) =>
    api.patch('/admin/site', { open }),

  // Publikasikan gambar + caption ke Instagram.
  //
  // Sengaja pakai fetch, bukan axios:
  //
  //  - Content-Type TIDAK boleh diisi manual untuk FormData. Browser yang
  //    memasang boundary multipart; kalau kita menulis 'multipart/form-data'
  //    tanpa boundary, server tidak bisa mengurai body dan jawabannya 400
  //    dengan pesan yang tidak menjelaskan apa pun.
  //
  //  - Timeout axios di client.js 10 detik. Satu siklus Instagram (buat
  //    container lalu terbitkan) kerap memakan belasan detik, jadi 10 detik
  //    akan memutus request yang sebenarnya sedang berhasil, dan admin lalu
  //    menekan ulang saat publikasinya yang pertama sebenarnya sudah tayang.
  //
  // Bentuk errornya dibuat mirip axios supaya catch di komponen cukup satu
  // cara: err.response.data.error adalah pesan dari server.
  postInstagram: async (id, formData) => {
    const token = ambilToken();
    let res;
    try {
      res = await fetch(`${BASE_URL}/admin/menfes/${id}/post`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        signal: AbortSignal.timeout(60000),
      });
    } catch (err) {
      // Timeout dan kegagalan jaringan tidak punya HTTP status, jadi
      // tangani401 tidak relevan dan pesannya ditulis di sini.
      const kehabisanWaktu =
        err.name === 'TimeoutError' || err.name === 'AbortError';
      throw Object.assign(
        new Error(
          kehabisanWaktu
            ? 'Instagram tidak menjawab dalam 60 detik. Postingan mungkin sudah tayang — cek feed @harkatnekatt sebelum mencoba lagi.'
            : 'Tidak bisa menghubungi server. Cek koneksi internet.'
        ),
        { response: null }
      );
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      tangani401(res.status);
      throw Object.assign(new Error(data.error || `Gagal (HTTP ${res.status}).`), {
        response: { data, status: res.status },
      });
    }
    return data;
  },
};
