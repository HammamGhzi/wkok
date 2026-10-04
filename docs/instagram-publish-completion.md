# Instagram Publish Integration - Completion Status

## Date: 2026-10-05

## ✅ Completed Work

### Backend (Node.js/Express)
- **Route**: `POST /api/admin/menfes/:id/post` mounted with `authMiddleware` → `parserGambar` → handler
- **Controller**: `postMenfesToInstagram` in `adminController.js`
  - Validates menfes status (must be APPROVED)
  - Calls `periksaGambar()` before DB mutation
  - Handles Instagram API errors (409, 502, etc.)
  - Updates `igStatus`, `igMediaId`, `igPermalink`, `igError`, `igPublishedAt`
- **Service**: `igPublish.js` refactored
  - Extracted `periksaGambar(buffer, mimeType)` validator
  - Exports `TIPE_BOKEH`, `UKURAN_MAKS`
  - `klaimKerja()` prevents concurrent publishes
  - `baseUrlPublik()` from `IG_PUBLIC_BASE_URL` env
- **Image Hosting**: Static route `/uploads` serves from `backend/uploads/ig/`
- **Tests**: 47/47 assertions passing in `test-ig-route.cjs`
  - Auth-before-parser ordering verified (9MB body → 401, not 413)
  - All guard logic tested
  - Success path, error propagation, status codes

### Frontend (React/Vite)
- **ExportModal.jsx**
  - Caption textarea with 2200-char counter
  - Post ke IG button (disabled if not APPROVED or already PUBLISHED)
  - Status display: "Sudah Tayang" / "Perlu Approve" / "Post ke IG"
  - `handlePost()` renders canvas → FormData → `adminAPI.postInstagram()`
  - Error handling with toast notifications
  - Caption preserved for retry (from `menfes.igCaption`)
- **AdminDashboardPage.jsx**
  - IG status column (lines 449-466)
  - Shows "Sudah tayang" (green) if `igStatus === 'PUBLISHED'`
  - Shows "Gagal" (amber) + retry button if `igStatus === 'FAILED'`
  - Retry button resets `igMediaId`, `igPermalink`, `igError`, `igPublishedAt` to null
- **HomePage.jsx**
  - Anonymity disclaimer updated (line 364)
  - Text: "Identitasmu 100% aman & anonim untuk Instagram (nama akan muncul di bawah cerita menfess ini)"
- **API Layer**
  - `client.js`: Exported `ambilToken`, `tangani401`, `BASE_URL`
  - `index.js`: Added `postInstagram(id, formData)` with native `fetch`, 60s timeout
- **UI Verification**
  - ExportModal renders correctly (verified via Playwright)
  - Caption counter updates (42/2200 test)
  - Post button visible and enabled
  - Live canvas preview working
  - 0 console errors

### Database
- **Schema Migration Applied to Prod**
  - 7 nullable columns added to `Menfes` table
  - `igStatus` (STRING, nullable, NO default)
  - `igMediaId`, `igPermalink`, `igCaption`, `igError` (all STRING, nullable)
  - `igPublishedAt` (DATETIME, nullable)
  - `prisma generate` successful
- **No DEFAULT constraint** on `igStatus` to avoid rewriting 444 existing rows

### Configuration
- **Backend `.env`**
  - `IG_PUBLIC_BASE_URL=https://menfs.onrender.com/uploads/ig`
  - `IG_ACCESS_TOKEN` (present, gitignored)
  - `IG_USER_ID` (present, gitignored)
- **Frontend**
  - Vite dev server running on port 5173
  - Backend server running on port 3001 (nodemon)

## ⚠️ Pending Tasks

### 1. Deployment (Blocking)
- [ ] **Backend → Render** (https://menfs.onrender.com)
  - Deploy latest code from `main` branch
  - Set environment variables in Render dashboard
  - Verify `/uploads/ig` static route works
  - Test `POST /api/admin/menfes/:id/post` endpoint
- [ ] **Frontend → Vercel** (https://harkatnekat.vercel.app)
  - Deploy latest code from `main` branch
  - Verify API base URL points to Render backend
  - Test ExportModal in production
  - Test AdminDashboardPage IG status column

### 2. Security (Critical)
- [ ] **Rotate Supabase DATABASE_URL**
  - Status: Acknowledged but not yet rotated
  - Reason: Credentials were leaked in error message during testing
  - Action: Generate new credentials in Supabase dashboard, update Render env vars

### 3. Testing (Recommended)
- [ ] **End-to-End Publish Test**
  - Requires valid Instagram token
  - Flow: Draft → Approve → Export Modal → Write Caption → Post ke IG → Verify status
  - Check `igStatus` in database
  - Verify image appears in `/uploads/ig/`
  - Test retry button on failure (if any)
- [ ] **Production Smoke Test**
  - Deploy both services
  - Login as admin
  - Approve a test menfess
  - Open Export Modal
  - Verify caption input works
  - Click Post ke IG (if ready to test live)
  - Monitor backend logs for Instagram API calls

## 🔍 Verification Summary

### Backend Tests
- ✅ IG Route Test: 47/47 passing
- ✅ Security Test: 55/55 passing
- ✅ Audit Test: 52/52 passing
- ✅ All test suites exit 0

### Frontend UI
- ✅ ExportModal renders correctly
- ✅ Caption textarea accepts input
- ✅ Character counter updates (42/2200 verified)
- ✅ Post ke IG button visible
- ✅ Anonymity disclaimer visible on HomePage
- ✅ Live canvas preview working
- ✅ 0 console errors

### Code Quality
- ✅ Auth middleware runs before body parser
- ✅ Image validation before DB mutation
- ✅ Concurrent publish prevention (klaimKerja)
- ✅ Error handling (409, 502, 503, etc.)
- ✅ Audit logging (no caption leak)
- ✅ Multipart parsing with native FormData

## 📋 Architecture Notes

### Instagram Publish Flow
```
Admin Dashboard
    ↓
Export Modal (caption + canvas render)
    ↓
POST /api/admin/menfes/:id/post (multipart)
    ↓
authMiddleware → parserGambar → postMenfesToInstagram
    ↓
periksaGambar() validation
    ↓
klaimKerja() - prevent concurrent publishes
    ↓
Instagram Graph API (container → publish)
    ↓
Update igStatus = PUBLISHED + mediaId + permalink
    ↓
Audit log (no caption)
```

### Key Design Decisions
1. **No auto-post**: Admin must explicitly click "Post ke IG"
2. **Draft-only**: Caption editable before posting
3. **Async tracked**: Publish status stored in DB, retry available
4. **Instagram Login path**: Not Facebook Login
5. **Image hosting**: Served from existing `/uploads` static route
6. **Public URL**: From `IG_PUBLIC_BASE_URL` env, not Host header
7. **Nullable igStatus**: No DEFAULT to avoid rewriting existing rows
8. **Auth before parser**: Prevents 413 on unauthenticated requests

## 🚀 Deployment Checklist

### Backend (Render)
- [ ] Pull latest code from `main`
- [ ] Run `npm install`
- [ ] Run `npx prisma generate`
- [ ] Verify environment variables:
  - `DATABASE_URL` (rotated)
  - `IG_ACCESS_TOKEN`
  - `IG_USER_ID`
  - `IG_PUBLIC_BASE_URL=https://menfs.onrender.com/uploads/ig`
- [ ] Start server
- [ ] Test health endpoint
- [ ] Test `/uploads` static route
- [ ] Test `POST /api/admin/menfes/:id/post` with auth

### Frontend (Vercel)
- [ ] Pull latest code from `main`
- [ ] Run `npm install`
- [ ] Verify `VITE_API_BASE_URL` points to Render backend
- [ ] Build project (`npm run build`)
- [ ] Deploy to Vercel
- [ ] Test admin login
- [ ] Test ExportModal
- [ ] Test caption input
- [ ] Test Post ke IG button (if ready)

## 📝 Notes

- **Never auto-post**: System requires explicit admin approval via button click
- **Anonymity**: Names appear in UI but are not exposed to Instagram API
- **Music**: Must be added manually in Instagram app (Audio API unavailable)
- **Image size**: Max 8MB, types: JPEG, PNG, WEBP (validated before publish)
- **Caption limit**: 2200 chars (Instagram's limit)
- **Concurrent safety**: `klaimKerja()` prevents duplicate publishes
- **Retry**: Failed publishes can be retried via button (resets mediaId, permalink)
- **Audit**: All publishes logged, but captions never logged

## 🔗 Related Files

### Backend
- `backend/src/routes/admin.js` - Route definition
- `backend/src/controllers/adminController.js` - Handler logic
- `backend/src/services/igPublish.js` - Instagram API service
- `backend/src/index.js` - Route mounting
- `backend/.env` - Environment variables
- `backend/test-ig-route.cjs` - Test suite (47 assertions)

### Frontend
- `frontend/src/components/ExportModal.jsx` - Export & publish UI
- `frontend/src/pages/AdminDashboardPage.jsx` - Dashboard with IG status
- `frontend/src/pages/HomePage.jsx` - Anonymity disclaimer
- `frontend/src/api/client.js` - API client utilities
- `frontend/src/api/index.js` - API methods

### Database
- `schema.mysql.prisma` - Local schema (kept in sync manually)
- Prod DB: Supabase (7 new columns applied)

---

**Status**: Development complete, tests passing, ready for deployment
**Next Action**: Deploy to Render + Vercel, then rotate DATABASE_URL
