# Deployment Guide - Instagram Publish Integration

## Status: READY TO DEPLOY ✅

**Current State**: 5 commits ahead of origin/main, all tests passing, UI verified

---

## 🎯 Correct URLs

| Service | URL |
|---------|-----|
| **Backend (Render)** | `https://harkatnekatt.onrender.com` |
| **Frontend (Vercel)** | `https://harkatnekat.vercel.app` |
| **Admin Dashboard** | `https://harkatnekat.vercel.app/4613a76adb4fb2dc` |

---

## Quick Links

| Resource | URL |
|----------|-----|
| **Backend** | https://harkatnekatt.onrender.com |
| **Frontend** | https://harkatnekat.vercel.app |
| **Admin Dashboard** | https://harkatnekat.vercel.app/4613a76adb4fb2dc |
| **Render Dashboard** | https://dashboard.render.com |
| **Vercel Dashboard** | https://vercel.com/dashboard |
| **Supabase Dashboard** | https://supabase.com/dashboard |
| **Completion Doc** | `menfs/docs/instagram-publish-completion.md` |
| **Deployment Guide** | `menfs/docs/deployment-guide.md` |

---

## ⏱️ Estimated Time

- **Push**: 1 menit
- **Deploy Backend**: 3-5 menit (auto) + 2 menit verify
- **Deploy Frontend**: 2-3 menit (auto) + 2 menit verify
- **Rotate DATABASE_URL**: 3 menit
- **E2E Test**: 5 menit (optional)

**Total**: ~15-20 menit untuk full deployment

---

## ⚠️ Critical Reminders

1. **Rotate DATABASE_URL** - Credentials sudah leaked, wajib ganti
2. **Never auto-post** - Admin harus explicit click "Post ke IG"
3. **Music manual** - Audio API unavailable, tambah di Instagram app
4. **Caption editable** - Write caption sebelum post
5. **Retry available** - Failed publish bisa dicoba lagi
6. **VITE_API_URL format** - Tanpa trailing slash: `https://harkatnekatt.onrender.com`
7. **IG_PUBLIC_BASE_URL** - `https://harkatnekatt.onrender.com/uploads/ig`

---

## Step 1: Push to GitHub

```bash
cd C:\Users\AcerAG14\Documents\Project\harkatnekatt\menfs
git push origin main
```

**Note**: File `test-results.txt` dan screenshot verification tidak perlu di-commit (temporary files).

---

## Step 2: Deploy Backend to Render

### 2.1 Access Render Dashboard
- URL: https://dashboard.render.com
- Login dengan credentials lu

### 2.2 Update Environment Variables
Di service backend (URL: `https://harkatnekatt.onrender.com`), cek/update environment variables:

```env
# Database (⚠️ ROTATE INI - credentials sudah leaked!)
DATABASE_URL=postgresql://<NEW_CREDENTIALS>@<host>/<database>

# Instagram (sudah ada, pastikan benar)
IG_ACCESS_TOKEN=<token>
IG_USER_ID=<user_id>

# ⚠️ PENTING: Harus pake harkatnekatt.onrender.com
IG_PUBLIC_BASE_URL=https://harkatnekatt.onrender.com/uploads/ig

# Pastikan environment lain tetap ada
NODE_ENV=production
PORT=10000
```

### 2.3 Deploy
1. Render akan auto-deploy saat push ke GitHub (jika connected)
2. Atau manual: Dashboard → Service → Manual Deploy → "Deploy latest commit"
3. Tunggu build selesai (biasanya 2-3 menit)

### 2.4 Verify Backend
```bash
# Health check
curl https://harkatnekatt.onrender.com/health

# Test uploads route (harus 404, bukan error)
curl -I https://harkatnekatt.onrender.com/uploads/ig/test.jpg

# Test admin route (harus 401 Unauthorized)
curl -X POST https://harkatnekatt.onrender.com/api/admin/menfes/test/post
```

**Expected**:
- `/health` → `{"status":"ok"}`
- `/uploads/ig/*` → 404 (not 500)
- `/api/admin/*` → 401 (auth required)

---

## Step 3: Deploy Frontend to Vercel

### 3.1 Access Vercel Dashboard
- URL: https://vercel.com/dashboard
- Login dengan GitHub account

### 3.2 Check Project Settings
Project: `harkatnekat` (https://harkatnekat.vercel.app)

**Environment Variables**:
```env
VITE_API_URL=https://harkatnekatt.onrender.com
```

⚠️ **PENTING**: Jangan taruh slash di akhir! Format yang benar: `https://harkatnekatt.onrender.com` (bukan `https://harkatnekatt.onrender.com/`)

**Build Settings**:
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Root Directory: `frontend` (jika monorepo)

### 3.3 Deploy
1. Vercel akan auto-deploy saat push ke GitHub (jika connected)
2. Atau manual: Dashboard → Project → Deployments → "Redeploy"
3. Pilih commit terbaru: `b859e7c feat(ig): integration lengkap...`
4. Tunggu build selesai

### 3.4 Verify Frontend
Buka https://harkatnekat.vercel.app dan test:

1. **Homepage**:
   - [ ] Halaman load正常
   - [ ] Disclaimer anonim terlihat: "100% aman & anonim untuk Instagram"
   - [ ] Template cards render

2. **Admin Dashboard** (https://harkatnekat.vercel.app/4613a76adb4fb2dc):
   - [ ] Login berhasil (admin/admin123)
   - [ ] Stats cards render (Total, Menunggu, Disetujui, Ditolak)
   - [ ] Menfess list load
   - [ ] 0 console errors

3. **Export Modal**:
   - [ ] Klik tab "Disetujui"
   - [ ] Klik "Export IG" di salah satu menfess
   - [ ] Modal terbuka dengan canvas preview
   - [ ] Caption textarea terlihat dengan counter "0/2200"
   - [ ] Tombol "Download JPG" dan "Post ke IG" terlihat
   - [ ] Ketik caption → counter update

---

## Step 4: Rotate Supabase DATABASE_URL ⚠️ CRITICAL

### 4.1 Generate New Credentials
1. Buka https://supabase.com/dashboard
2. Pilih project
3. Settings → Database
4. Click "Rotate credentials" atau "Regenerate database password"
5. Copy connection string baru (format: `postgresql://postgres:[PASSWORD]@...`)

### 4.2 Update Render
1. Render Dashboard → Backend Service → Environment
2. Update `DATABASE_URL` dengan credentials baru
3. Save (Render akan auto-restart)

### 4.3 Verify
```bash
# Test backend connection
curl https://harkatnekatt.onrender.com/health

# Harus return ok, bukan database connection error
```

---

## Step 5: End-to-End Test (Production)

### 5.1 Test Publish Flow
⚠️ **Only test jika IG token valid dan lu siap post ke Instagram!**

1. Login ke https://harkatnekat.vercel.app/4613a76adb4fb2dc
2. Approve satu menfess (atau pakai yang sudah APPROVED)
3. Klik "Export IG"
4. Tulis caption (max 2200 chars)
5. Klik "Post ke IG"
6. **Expected**:
   - Toast: "Tayang di Instagram."
   - Status berubah jadi "Sudah Tayang"
   - Image muncul di Instagram
   - Image accessible di `https://menfs.onrender.com/uploads/ig/<filename>`

### 5.2 Test Error Handling
1. Coba post menfess yang PENDING
2. **Expected**: Toast error "Menfes belum di-approve"

### 5.3 Test Retry (jika ada failure)
1. Jika post gagal, status jadi "Gagal" + retry button
2. Klik retry button
3. Status reset ke APPROVED
4. Bisa coba post lagi

---

## Troubleshooting

### Backend Won't Start
```bash
# Cek Render logs
Dashboard → Service → Logs

# Common issues:
# 1. DATABASE_URL salah → "Can't reach database server"
# 2. Missing env vars → "IG_ACCESS_TOKEN tidak ditemukan"
# 3. Build failed → "npm install error"
```

### Frontend Can't Connect to Backend
```bash
# Cek Vercel environment
# Pastikan VITE_API_URL=https://harkatnekatt.onrender.com (tanpa trailing slash)

# Cek browser console (F12)
# Error "Network Error" → backend down atau CORS
# Error 401 → token expired, logout & login lagi
# Error 404 "Route tidak ditemukan" → VITE_API_URL ada double slash
```

### Image Upload Fails
```bash
# Cek backend logs untuk error detail
# Common issues:
# - Image > 8MB → "Ukuran gambar melebihi batas"
# - Invalid type → "Tipe file tidak didukung"
# - IG token expired → "Kode 190: token kedaluwarsa"
```

### Instagram API Errors
```bash
# Error 190: Token expired
# → Regenerate IG_ACCESS_TOKEN di Facebook Developer

# Error 400: Invalid image
# → Cek format (JPEG/PNG/WEBP) dan size (< 8MB)

# Error 502: Instagram service error
# → Retry beberapa menit kemudian
```

---

## Post-Deployment Checklist

- [ ] Backend health check OK (https://harkatnekatt.onrender.com/health)
- [ ] Backend `/uploads` route OK
- [ ] Frontend loads di production
- [ ] Admin login works
- [ ] Export modal works
- [ ] Caption input works
- [ ] DATABASE_URL rotated
- [ ] Test publish (optional, if IG token valid)
- [ ] Verify image di `/uploads/ig/`
- [ ] Update completion doc status

---

## Rollback Plan

Jika ada issue di production:

### Backend Rollback
1. Render Dashboard → Service → Deployments
2. Pilih deployment sebelumnya (commit `9201394` atau sebelumnya)
3. Click "Rollback"

### Frontend Rollback
1. Vercel Dashboard → Project → Deployments
2. Pilih deployment sebelumnya
3. Click "Promote to Production"

### Database Rollback
⚠️ **Tidak perlu rollback** - kolom baru nullable, tidak affect existing data

---

## Support

**Completion Doc**: `menfs/docs/instagram-publish-completion.md`
**Test Suite**: `npm run test:all` di `backend/` (398 assertions, 0 failures)
**Git Log**: `git log --oneline -5` untuk cek commit history

---

**Estimated Time**: 15-20 menit untuk full deployment
**Difficulty**: Easy (auto-deploy dari GitHub)
**Risk**: Low (semua tests passing, UI verified)
