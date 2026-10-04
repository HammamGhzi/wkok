# Riset Teknis: Auto-Posting ke Instagram dari Aplikasi Web

**Proyek:** Menfes Harkat Nekatt (anonymous campus message board)
**Kebutuhan:** Setelah admin approve satu menfes, gambar 1080×1080 otomatis ter-post ke Instagram (feed dan/atau story), tanpa admin download lalu upload manual.
**Tanggal riset:** 1 Oktober 2026
**Sumber:** Hanya dokumentasi resmi Meta / Instagram Platform, Graph API docs, Meta for Developers Blog, dan Meta Platform Terms. Tidak ada blog pihak ketiga yang dipakai sebagai sumber fakta.

> **Catatan versi:** Saat riset ini dilakukan, Graph API terbaru adalah **v26.0** (rilis 29 Juli 2026). Contoh di halaman referensi Instagram Platform masih memakai `v25.0`. Setiap versi dijamin hidup minimal 2 tahun sejak versi berikutnya rilis ([Platform Versioning](https://developers.facebook.com/docs/graph-api/guides/versioning)).

---

## RINGKASAN UNTUK KEPUTUSAN

### (a) Apakah feasible secara teknis? — **YA, dengan 3 perubahan arsitektur wajib**

Auto-posting feed image itu **resmi didukung dan aktif di 2026**. Endpoint-nya belum deprecated. Namun implementasinya **bukan** "kirim file langsung ke API". Ada tiga hal yang memaksa perubahan arsitektur:

| # | Temuan | Dampak ke arsitektur |
|---|---|---|
| 1 | **Wajib URL publik.** Docs: *"We cURL media used in publishing attempts, so the media must be hosted on a publicly accessible server at the time of the attempt."* ([Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing#requirements)) | Canvas 1080×1080 tidak bisa langsung dikirim. Harus di-render di server / upload dulu ke storage publik, baru dapat URL-nya. |
| 2 | **Hanya JPEG.** *"JPEG is the only image format supported."* ([Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing#limitations)) | Pipeline canvas harus diubah dari PNG ke JPEG. |
| 3 | **Dua langkah (container → publish).** | Tidak bisa satu call. Perlu retry + status polling. |

ARSITEKTUR YANG DIBUTUHKAN: `Approve menfes → server render PNG/canvas → convert JPEG → upload ke public URL (S3/CDN/Supabase Storage) → POST /{ig-user-id}/media (dapat container ID) → POST /{ig-user-id}/media_publish (dapat media ID)`.

### (b) Blocker terbesar

**Bertingkat, dari yang terbesar:**

1. **Syarat akun (bukan teknis, tapi blocker paling realistis).** Wajib IG **Professional**. Kalau akun IG "Menfes Harkat Nekatt" sekarang Personal, tidak bisa sama sekali — tidak ada API publik untuk Personal account. Dan untuk **Story**, docs secara eksplisit limiting ke **Business** saja, bukan Creator.
2. **Wajib hosting publik dengan URL yang bisa diakses server Meta** — dan harus tetap hidup *saat* Meta menarik gambarnya. Ini beban operasional nyata untuk aplikasi yang merender on-the-fly.
3. **Rantai token headless harus dijaga tetap hidup.** Token IG Business = **60 hari** dan harus di-refresh secara berkala. Plus ada aturan: **28 hari tanpa pakai = akses API dicabut**, dan **90 hari tanpa pakai = permission harus di-regrant user**. Ini risiko nyata untuk aplikasi kampus yang sepi saat libur.
4. **Tidak bisa publish langsung dari file lokal/binary** — satu-satunya exception adalah resumable upload via `rupload.facebook.com`, dan itu **khusus video**, bukan gambar.

Yang **bukan** blocker: biaya (tidak ada biaya per publish yang dipublikasikan), App Review (tidak wajib untuk kasus single-admin — lihat §8).

### (c) Prasyarat yang harus disiapkan user

| Prasyarat | Wajib? | Detail |
|---|---|---|
| **Akun IG Professional** | **YA** | Business atau Creator untuk feed. **Story hanya Business.** |
| **Instagram App ID + App Secret** | **YA** | Dari `App Dashboard > Instagram > API setup with Instagram login > Business login settings`. |
| **App Meta type "Business"** | **YA** | Docs: *"If your current Meta app type is **not** a Business type app you will need to create a new app and select **Business**."* |
| **Public image host** | **YA** | URL HTTPS yang bisa diakses Meta, tanpa auth, bertahan > beberapa menit. |
| **Facebook Page** | **Tergantung jalur API** | Tidak perlu jika pakai **Instagram Login**. Wajib jika pakai **Facebook Login**. |
| **Business Verification** | **TIDAK** untuk kasus ini | Docs: *"If your app only serves your Instagram professional account or an account you manage, Standard Access is all your app needs."* |
| **App Review** | **TIDAK** untuk kasus ini | Docs: *"If your app will only be used by app users who have a role on the app itself, App Review is not required."* |
| **Budget** | **~Rp0** | Tidak ada biaya per publish yang dipublikasikan. |

### Rekomendasi jalur

Untuk proyek ini, **Instagram API with Instagram Login** (`graph.instagram.com`) adalah jalur terbaik: tidak butuh Facebook Page, onboarding turun dari rata-rata 12 langkah ke 2 langkah, dan menyertakan Insights + Messaging yang tidak ada di jalur lain ([Migration guide](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/migration-guide)).

**Tapi ada caveat penting (lihat §4.2):** jalur ini tidak punya mekanisme *system user* yang terdokumentasi. Untuk headless, token diambil dari **App Dashboard** dan valid 60 hari, jadi ada trade-off: refresh manual, dibanding jalur Facebook yang mendukung system user.

---

## 1. Content Publishing API untuk Gambar (Feed Image)

### 1.1 Status: AKTIF, tidak deprecated

Changelog resmi **tidak** memuat entri deprecation untuk Content Publishing API atau `media_publish`. Sebaliknya, API ini justru **masih aktif dikembangkan** — changelog terbaru 22 Juni 2026 menambahkan fitur `is_ai_generated` dan metrics baru ([Changelog](https://developers.facebook.com/docs/instagram-platform/changelog)).

Timeline resmi:

| Tanggal | Peristiwa | Sumber |
|---|---|---|
| 26 Jan 2021 | Content Publishing API luncur, **Business only**, limit 25 post/24h | [Blog](https://developers.facebook.com/blog/post/2021/01/26/introducing-instagram-content-publishing-api) |
| 15 Mar 2022 | Carousel posts | [Changelog](https://developers.facebook.com/docs/instagram-platform/changelog) |
| 28 Jun 2022 | Reels | [Changelog](https://developers.facebook.com/docs/instagram-platform/changelog) |
| 16 Mei 2023 | Stories ditambahkan | [Blog](https://developers.facebook.com/blog/post/2023/05/16/introducing-stories-publishing-to-the-content-publishing-api-on-instagram) |
| **12 Jun 2023** | **Creator accounts bisa publish** + limit 25 → **50** | [Blog](https://developers.facebook.com/blog/post/2023/06/12/introducing-new-features-and-expanded-user-types-to-the-instagram-content-publishing-api) |
| 4 Des 2024 | **Instagram Basic Display API di-deprecated** (bukan Content Publishing) | [Changelog](https://developers.facebook.com/docs/instagram-platform/changelog) |
| 24 Mar 2025 | Field `alt_text` untuk image posts | [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing) |
| 3 Des 2025 | Trial Reels + `DELETE /{ig-media-id}` | [Changelog](https://developers.facebook.com/docs/instagram-platform/changelog) |
| 22 Apr 2026 | Partnership ads label (`branded_content_sponsor_ids`, `is_paid_partnership`) | [Changelog](https://developers.facebook.com/docs/instagram-platform/changelog) |
| **22 Jun 2026** | **`is_ai_generated`** (self-disclosure AI) | [Changelog](https://developers.facebook.com/docs/instagram-platform/changelog) |

> **Penting:** Yang di-deprecated pada Des 2024 adalah **Instagram Basic Display API** (API lama untuk baca data dasar). Itu **bukan** Content Publishing API. Banyak artikel pihak ketiga mencampur keduanya.

### 1.2 Endpoint persis

**Langkah 1 — buat container:**

```
POST https://graph.instagram.com/v26.0/{IG_USER_ID}/media
     (atau https://graph.facebook.com/v26.0/{IG_USER_ID}/media untuk jalur Facebook Login)

Body:
  image_url     = "https://cdn.example.com/menfes/123.jpg"   ← WAJIB, URL PUBLIK
  caption       = "..."            (opsional, maks 2200 karakter)
  alt_text      = "..."            (opsional, maks 1000 karakter, image posts only)
  location_id   = "..."            (opsional, ID Facebook Page lokasi)
  user_tags     = [{username, x, y}] (opsional)
  is_ai_generated = true            (opsional, sejak 22 Jun 2026)
  access_token  = <TOKEN>
```

Response sukses: `{ "id": "<IG_CONTAINER_ID>" }`

**Langkah 2 — publish:**

```
POST https://graph.instagram.com/v26.0/{IG_USER_ID}/media_publish
Body:
  creation_id  = "<IG_CONTAINER_ID>"    ← WAJIB
  access_token = <TOKEN>
```

Response sukses: `{ "id": "<IG_MEDIA_ID>" }`

Sumber: [IG User Media — Creating](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media#creating) dan [IG User Media Publish](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish#creating).

### 1.3 Permissions / scopes

| Jalur | Permissions | Scopes di login |
|---|---|---|
| **Instagram Login** | `instagram_business_basic`, `instagram_business_content_publish` | Sama dengan nama permission-nya |
| **Facebook Login** | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` | — |

Untuk Facebook Login, `pages_show_list` dibutuhkan untuk dapat daftar Page lewat `GET /me/accounts` ([Permissions Reference](https://developers.facebook.com/docs/permissions/reference/instagram_content_publish)).

Task yang wajib di-Page: user harus bisa melakukan **`MANAGE`** atau **`CREATE_CONTENT`** di Page yang terhubung dengan IG tersebut ([Overview — Tasks](https://developers.facebook.com/documentation/instagram-platform/overview#tasks)).

### 1.4 Spesifikasi gambar yang WAJIB dipenuhi

Dari [IG User Media — Image Specifications](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media#image-specifications):

| Atribut | Nilai |
|---|---|
| Format | **JPEG saja** |
| File size | Maks **8 MB** |
| Aspect ratio | **4:5 sampai 1.91:1** |
| Min width | 320 (di-scale up bila kurang) |
| Max width | 1440 (di-scale down bila lebih) |
| Color space | sRGB (lain dikonversi otomatis) |

**Relevansi untuk proyek:** canvas 1080×1080 = rasio 1:1, yang **berada di dalam** rentang yang valid, dan lebar 1080 < 1440. Jadi ukuran saat ini sudah aman. Yang perlu diubah hanya **PNG → JPEG**.

### 1.5 ⚠️ Ketidakkonsistenan pada batas 100 vs 50 post/hari

Docs resmi **saling bertentangan** soal angka limit. Saya laporkan apa adanya:

| Sumber | Angka |
|---|---|
| [Content Publishing → Rate Limit](https://developers.facebook.com/documentation/instagram-platform/content-publishing#rate-limit) | *"limited to **100** API-published posts within a 24-hour moving period"* |
| [Content Publishing → Carousel](https://developers.facebook.com/documentation/instagram-platform/content-publishing#limitations) (bagian yang sama!) | *"Accounts are limited to **50** published posts within a 24-hour period"* |
| [IG User Media Publish → Limitations](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish#limitations) | *"can only publish **50** posts within a 24 hour moving period"* |
| [IG Content Publishing Limit](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit#fields) | `quota_total` — *"currently **50**"* |
| [Blog 12 Jun 2023](https://developers.facebook.com/blog/post/2023/06/12/introducing-new-features-and-expanded-user-types-to-the-instagram-content-publishing-api) | naik dari 25 → **50** |

**Rekomendasi:** Jangan hardcode angka manapun. Query `GET /{ig-user-id}/content_publishing_limit` saat runtime — field `config.quota_total` memberi angka aktual dari server. Satu-satunya nomor yang **pasti** di dokumen: naik dari **25 → 50** pada 12 Juni 2023, tidak ada perubahan afterward yang tercatat di changelog. Angka "100" di guide kemungkinan docs drift. → **perlu verifikasi runtime**

### 1.6 Tidak ada scheduling native

Tidak ada parameter `published=false` maupun `scheduled_publish_time` di `/{ig-user-id}/media`. →  Endpoint publishing selalu menerbitkan segera setelah `media_publish` dipanggil.

Untuk kebutuhan "post setelah approve", ini justru **ideal** — tidak perlu scheduler native. Jadwalkan di sisi server kita sendiri (setelah approve diproses). Konten pun masih aman: container **expire setelah 24 jam** ([IG User Media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media#limitations)), jadi kita bisa tahan container beberapa jam sebelum publish.

---

## 2. Syarat Akun: Business vs Creator vs Personal

### 2.1 Tabel status per tipe akun

| Tipe akun | Feed image | Reels | Story |
|---|---|---|---|
| **Personal** (consumer) | ❌ | ❌ | ❌ |
| **Creator** (professional) | ✅ sejak **12 Jun 2023** | ✅ | ❌ |
| **Business** (professional) | ✅ | ✅ | ✅ |

### 2.2 Personal: TIDAK BISA

Docs stating keras: *"Your app users must have an **Instagram professional account**. An Instagram professional account can be for a business or creator."* ([Overview — App users](https://developers.facebook.com/documentation/instagram-platform/overview#app-users)). Dan: *"The Instagram API with Facebook Login **cannot access Instagram consumer accounts** (i.e., non-Business or non-Creator Instagram accounts)."* ([Instagram API with Facebook Login → Limitations](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login))

**Tidak ada jalur resmi sama sekali untuk Personal account di 2026.** Instagram Basic Display API yang dulu mendukungnya sudah di-deprecated 4 Desember 2024 dan *"All requests to the Instagram Basic Display API will return an error message."*

### 2.3 Story: HANYA Business — ini yang mudah terlewat

Ini poin paling krusial dan paling sering disalahpahami:

> *"Content Publishing is available to all Instagram Professional accounts, **except Stories, which are only available to business accounts**."*
> — [Instagram API with Facebook Login → Limitations](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login)

Ini inhibitor yang paling realistis: kalau requirements-nya include Story dan akun IG-nya bertipe Creator, **tidak akan jalan**. Akunnya wajib di-switch ke Business.

Catatan: halaman **Instagram Login** tidak menyatakan pembatasan Story yang sama eksplisit. Apakah jalur `graph.instagram.com` juga membatasi Story ke Business, atau itu hanya dokumentasi jalur Facebook Login — **perlu verifikasi**. Error yang community laporkan (`#10 The user is not an Instagram Business` saat `media_type=STORIES` dengan akun Creator) konsisten dengan pembatasan Business-only, tapi itu laporan user di forum, bukan docs.

### 2.4 Perlindersan Business vs Creator pada tiap fitur

| Fitur | Business | Creator |
|---|---|---|
| Feed image | ✅ | ✅ (sejak Jun 2023) |
| Reels | ✅ | ✅ |
| Story | ✅ | ❌ |
| Hashtag Search | ✅ | ❌ (tidak ada di kedua jalur Instagram Login) |
| Product tagging | ✅ (FB Login saja) | ❌ |
| Insights | ✅ | ✅ |
| Messaging | ✅ | ✅ |

### 2.5 Apakah harus punya / link Facebook Page?

**Tergantung jalur API:**

| Jalur | Butuh FB Page? |
|---|---|
| **Instagram Login** (`graph.instagram.com`) | **TIDAK.** Docs: *"This API setup **does not require a Facebook Page** to be linked to the Instagram professional account."* ([Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)) |
| **Facebook Login** (`graph.facebook.com`) | **YA, wajib.** Dan wajib ter-*link* ke IG account, serta user harus punya task MANAGE/CREATE_CONTENT di Page tersebut. |

Untuk proyek "Menfes Harkat Nekatt" yang dikelola satu admin: **Instagram Login jauh lebih ringan** — tidak perlu bikin dan mengelola Page.

---

## 3. Access Token: Jenis, Masa Berlaku, Refresh, dan Headless

### 3.1 Tabel jenis token

| Jenis token | Sumber | Bisa dipakai untuk IG publish? |
|---|---|---|
| **Instagram User access token** (long-lived) | OAuth via Business Login for Instagram, atau generate dari App Dashboard | ✅ — token ini yang dipakai endpoint `/media` & `/media_publish` |
| **Facebook User access token** (long-lived) | OAuth via Facebook Login for Business | ✅ (jalur `graph.facebook.com`) |
| **Facebook Page access token** | Ditukar dari user token via `GET /me/accounts` | ✅ — guide menyebutnya, tapi referensi endpoint menyebut "User". Both work. |
| **System User access token** | Business Manager > System Users | ⚠️ **Tidak terdokumentasi eksplisit untuk IG publishing** — lihat §3.4 |
| **App access token** | `client_id` + `client_secret` | ❌ tidak punya izin publishing |

### 3.2 Masa berlaku

| Token | Masa berlaku | Sumber |
|---|---|---|
| Authorization code | **1 jam**, sekali pakai | [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) |
| Short-lived user token | **1 jam** | [Overview](https://developers.facebook.com/documentation/instagram-platform/overview) |
| **Long-lived user token** | **60 hari** | [Overview](https://developers.facebook.com/documentation/instagram-platform/overview), [Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) |
| Long-lived token via App Dashboard (IG Login) | **60 hari** | [IG Login Get Started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started) |

Peringatan eksplisit dari docs: *"Do not depend on these lifetimes remaining the same — they may change without warning or expire early."* ([Access Tokens](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens))

### 3.3 Cara refresh (Instagram Login)

Dua endpoint, keduanya di `graph.instagram.com`:

**Exchange short → long-lived:**
```
GET https://graph.instagram.com/access_token
  ?grant_type=ig_exchange_token
  &client_secret={INSTAGRAM_APP_SECRET}
  &access_token={SHORT_LIVED_TOKEN}
```

**Refresh long-lived yang akan expire:**
```
GET https://graph.instagram.com/refresh_access_token
  ?grant_type=ig_refresh_token
  &access_token={LONG_LIVED_TOKEN}
```

**Syarat refresh** (harus ketiganya terpenuhi):
- Token existing **minimal berumur 24 jam**
- Token existing **masih valid** (belum expired)
- User sudah memberi permission **`instagram_business_basic`**

> ⚠️ **Batas yang sering terlewat:** *"Tokens that have not been refreshed in 60 days will expire and can no longer be refreshed."* Kalau sampai lewat 60 hari tanpa di-refresh, token mati permanen dan tidak bisa diselamatkan — harus login ulang.

### 3.4 Mana yang tepat untuk otomatisasi server-side (headless/cron)?

Ada **dua jalur headless**, dan keduanya punya caveat berbeda:

#### Opsi A — Instagram Login + token dari App Dashboard

Ini yang **paling terdokumentasi** untuk kasus "akun milik sendiri":

> *"If your app serves only your Instagram professional accounts, or accounts you manage, **you do not need to implement a login flow**. However, you will need to configure the business login settings in the App Dashboard to obtain an Instagram app ID and an Instagram app secret, as well as obtain long-lived access tokens to use in your API calls."*
> — [Overview — Authentication and authorization](https://developers.facebook.com/documentation/instagram-platform/overview)

Praktisnya ([IG Login Get Started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started)): `App Dashboard > Instagram > API setup with Instagram business login > Generate token`. Token dari App Dashboard ini **sudah long-lived dan valid 60 hari**.

- ✅ Tidak ada user yang perlu login
- ✅ Selesai dalam 10 menit setup
- ❌ Token harus di-refresh manual lewat dashboard setiap <60 hari
- ❌ Tidak ada automation yang terdokumentasi untuk refresh token jalur ini
- ❌ Tidak ada system user

#### Opsi B — Facebook Login + System User

System user secara eksplisit dirancang untuk ini:

> *"System User access tokens let your app perform **programmatic, automated actions on Ad objects or Pages** without requiring input from an app user or re-authentication."*
> — [Access Tokens — System User](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens#systemusertokens)

Cara buat: `Business settings > System Users > +Add` → assign app dengan permission **Manage app** → **Generate token** dengan permissions yang diperlukan.

- ✅ Resmi dirancang untuk server-side/headless
- ✅ Tidak ada user login saat runtime
- ✅ Ada cara retrieve Page token: `GET /me/accounts?access_token={SYSTEM_USER_TOKEN}` ([System User API Calls](https://developers.facebook.com/docs/marketing-api/businessmanager/systemuser/api-calls))
- ❌ **Wajib** punya Facebook Page + Business Manager + link ke IG
- ⚠️ **Peringatan eksplisit dari docs:** *"If you try to use system user tokens to work on ad objects or Pages **on behalf of a real user** of your software, you **cannot** link this user to those actions unless you take them through Facebook Login."* — sehingga **harus ada minimal satu login Facebook interaktif saat onboarding**, danach baru headless.
- ⚠️ Docs Instagram Platform **tidak pernah menyebut system user token** sebagai token yang valid untuk `/media` dan `/media_publish`. → **perlu verifikasi**

#### ⚠️ Jawabannya belum sepenuhnya bisa dipastikan dari primary source

Semua referensi endpoint Instagram Platform menyebut **"User access token"** — bukan system user token. Dokumentasi system user yang ada hanya mencakup **Marketing API** dan **Pages API**, tidak pernah menyebut Instagram Platform.

Yang bisa saya nyatakan dengan aman dari docs:
- ✅ System user token **resmi** untuk Pages API, dan IG publish **tidak** butuh Page yang dipegang app
- ❌ **Tidak** ada konfirmasi resmi bahwa system user token valid untuk endpoint `/media` dan `/media_publish` di jalur IG mana pun

Yang **tidak** bisa saya nyatakan tanpa menebak:
- Apakah system user token bisa langsung dipakai di `POST /{ig-user-id}/media` dengan IG account milik sendiri
- ApakahIG Platform punya mekanisme refresh otomatis untuk system user token

**Rekomendasi praktis:** Mulai dengan **Opsi A** (Instagram Login + App Dashboard token) untuk MVP — cepat, tanpa Facebook Page, dan tidak memerlukan App Review. Upgrade ke Opsi B hanya jika token refresh manual jadi tidak|—
dan **uji langsung** apakah system user token diterima oleh endpoint publishing sebelum meng-commit arsitektur. Ini **wajib di-spike**, jangan diasumsikan.

### 3.5 Risiko "tidur" — wajib dip alerted ke tim

Dua aturan Meta yang bisa mematikan integrasi secara diam-diam:

| Aturan | Periode | Akibat | Sumber |
|---|---|---|---|
| **Akses API dicabut** | **28 hari** tanpa dipakai | *"We may suspend or end your App's access to any Platform APIs, permissions, or features that your App has not used or accessed within a **28-day period** with or without notice to you."* | [Platform Terms §7.e.iii](https://developers.facebook.com/terms) |
| **Permission harus di-regrant** | **90 hari** tanpa dipakai | *"If your app does not use a permission for 90 days, usually due to user inactivity, your app user must regrant your app that permission."* | [Permissions Reference](https://developers.facebook.com/docs/permissions/reference/instagram_content_publish) |

Untuk aplikasi kampus seperti Menfes Harkat Nekatt yang **sepi saat libur semester**, ini bukan teori. Rekomendasi: jalankan *heartbeat* API ringan (misal `GET /{ig-user-id}`) setiap 7 hari via cron, plus monitoring token 60 hari.

---

## 4. Dua Jalur API: Instagram Login vs Facebook Login

### 4.1 Perbandingan lengkap

Sumber utama: [Instagram Platform Overview](https://developers.facebook.com/documentation/instagram-platform/overview)

| Aspek | **Instagram API with Instagram Login** | **Instagram API with Facebook Login** |
|---|---|---|
| Host URL | **`graph.instagram.com`** | **`graph.facebook.com`** (+ `rupload.facebook.com` untuk video) |
| Token type | Instagram User | Facebook User atau Page |
| Login type | **Business Login for Instagram** | **Facebook Login for Business** |
| **Facebook Page** | **❌ tidak perlu** | **✅ wajib** |
| Permissions | `instagram_business_basic`, `instagram_business_content_publish` | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` |
| **Content publishing** | **✅** | **✅** |
| Comment moderation | ✅ | ✅ |
| Messaging | ✅ (langsung) | via Messenger Platform |
| Insights | ✅ | ✅ |
| Mentions | ✅ | ✅ |
| **Hashtag search** | **❌** | **✅** |
| **Product tagging** | **❌** | **✅** |
| **Partnership Ads** | **❌** | **✅** |
| **Resumable video upload** | **❌** | **✅** (`upload_type=resumable`) |
| Onboarding | rata-rata turun dari 12 → **2 langkah** | lebih banyak langkah |
| Business Login params | `enable_fb_login` (default `true`), `force_reauth` | — |

### 4.2 Kapan masing-masing championed, dan apakah ada yang deprecated?

**Keduanya aktif dan didukung. Tidak ada yang di-deprecated.**

Status per [Instagram Platform Overview](https://developers.facebook.com/documentation/instagram-platform/overview) dan [Changelog](https://developers.facebook.com/docs/instagram-platform/changelog):

| Tanggal | Peristiwa |
|---|---|
| **23 Jul 2024** | **Instagram API with Instagram Login diperkenalkan** — *"A Facebook Page will no longer be required"*, host `graph.instagram.com`, permissions `instagram_business_*`. ([Changelog](https://developers.facebook.com/docs/instagram-platform/changelog)) |
| 17 Sep 2024 | Scope values di Instagram Login diganti: `business_basic` → `instagram_business_basic`, dll. |
| **27 Jan 2025** | **Scope values LAMA di-deprecated.** Docs: *"Failure to do so will result in your app being unable to call the Instagram endpoints."* (Tanggal ini sempat dikoreksi dari 17 Des 2024 → 27 Jan 2025.) |
| 14 Jun 2025 | Deprecation params di Business Login: `enable_fb_login`, `force_authentication` (digantikan `force_reauth`) |
| 6 Feb 2026 | `enable_fb_login` **diperkenalkan lagi** sebagai parameter OAuth (default `true`) |
| 21 Jan 2025 | Insights API masuk ke jalur Instagram Login |

**Arah championed Meta:** jelas condong ke **Instagram Login** untuk kasus baru — karena menghapus kebutuhan Facebook Page dan menyederhanakan onboarding secara dramatis dari ~12 langkah ke 2 ([Migration guide](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/migration-guide)). Docs menyebut peningkatan "onboarding success rates" secara signifikan.

Namun jalur Facebook Login **tetap dipertahankan** dan tidak di-announce akan mati — justru berubah fitur (product tagging, partnership ads, resumable upload, hashtag search).

> **⚠️ Inkonsistensi docs yang perlu diwaspadai:** parameter `enable_fb_login` di-deprecated 14 Jun 2025, tapi 6 Feb 2026 docs memperkenalkannya lagi sebagai parameter OAuth yang *supported*. Docs-nya sendiri masih menampilkan warning deprecation lama di halaman yang sama. → **perlu verifikasi** di dashboard.

### 4.3 Rekomendasi untuk Menfes Harkat Nekatt

**Instagram Login**, alasan:
- Tidak perlu Facebook Page (satu akun IG milik satu admin — Facebook Page adalah beban operasional tanpa manfaat)
- 2 scope saja, bukan 4-5
- Tidak butuh `ads_management`/`ads_read` yang sometimes require Ads role
- Menuju messaging/insights di masa depan tanpa pivot arsitektur

**Tetap memakai Facebook Login** yang mulai di-deprecate juga masuk akal kalau tim memang butuh fitur yang hanya ada di jalur itu, kemungkinan besar butuh update credential tiap 60 hari.

---

## 5. ⚠️ SYARAT KRITIS: Host Gambar di URL Publik

**Ini menentukan arsitektur. Jawabannya tegas: YA, wajib.**

### 5.1 Docs, kutipan langsung

> **"Media on a public server** — We cURL media used in publishing attempts, so the media must be hosted on a **publicly accessible server at the time of the attempt**."
> — [Content Publishing → Requirements](https://developers.facebook.com/documentation/instagram-platform/content-publishing#requirements)

Dan pada parameter `image_url`:

> *"The path to the image. **We will cURL the image** using the URL that you specify so **it must be on a public server**."*
> — [IG User Media → image_url](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media#query-string-parameters)

Pesan error yang paling sering muncul kalau URL-nya tidak bisa diakses:

| HTTP | Code | Subcode | Message |
|---|---|---|---|
| 400 | 9004 | 2207052 | *"The media could not be fetched from this uri: {uri}"* |
| 400 | -2 | 2207003 | *"It takes too long to download the media"* — timeout |
| 400 | -2 | 2207020 | *"The media you are trying to access has expired. Please try to upload again."* |

Sumber: [Error Codes](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes)

### 5.2 Apakah bisa upload binary langsung? Untuk gambar: **TIDAK**

Ada mekanisme upload binary, tapi **khusus video**:

```
POST https://rupload.facebook.com/ig-api-upload/v25.0/<IG_MEDIA_CONTAINER_ID>
Authorization: OAuth <TOKEN>
offset: 0
file_size: <bytes>
--data-binary "@file.mp4"          ← atau: file_url: <URL>
```

Syarat aktifnya:
- Docs menyebut eksplisit: *"`upload_type=resumable` — Create a resumable upload session to upload **large videos**... **Only for apps that have implemented Facebook Login for Business**."*
- Contoh official-nya `Your_file_local_path.extension` selalu berupa video
- Header `offset` + `file_size` adalah pola chunked upload video

**Tidak ada `upload_type=resumable` di jalur Instagram Login**, dan tidak ada mekanisme binary upload untuk gambar di kedua jalur.

### 5.3 File lokal? **TIDAK bisa langsung**

Mengikuti logika yang sama: `image_url` harus URL HTTP(S) yang bisa di-cURL server Meta. Buffer di memory, `blob:` URL, `data:` URI, atau path filesystem lokal semuanya **gagal** — dan paling likely gagal dengan code `9004 / 2207052`.

### 5.4 Implikasi arsitektur untuk Menfes Harkat Nekatt

Pipeline yang harus dibangun:

```
[Admin Approve menfes]
        ↓
[Render 1080×1080 di server]  ← pindahkan logic canvas ke server (node-canvas / sharp / satori)
        ↓
[Convert ke JPEG, quality ~85-90]   ← WAJIB, bukan PNG
        ↓
[Upload ke public storage]  ← S3 / Cloudflare R2 / Supabase Storage / Vercel Blob
        ↓
[Dapat URL: https://cdn.menfs.app/menfes/abc123.jpg]
        ↓
[POST /{ig-user-id}/media { image_url, caption, alt_text }]
        ↓
[POST /{ig-user-id}/media_publish { creation_id }]
        ↓
[Simpan media_id ke DB menfes]
```

Pertimbangan operasional:

| Concern | Mitigasi |
|---|---|
| URL harus hidup saat Meta cURL | Jangan hapus file dari storage minimal ~1 jam setelah publish sukses (idealnya 24 jam) |
| URL harus tanpa auth | Signed URL dari S3/R2 **berfungsi** selama signature belum expired — tapi beri TTL yangcomfortable |
| Anti-hotlink | Pastikan tidak diblokir User-Agent Meta atau referer |
| HTTPS | Docs sangat menyarankan IETF character set, US ASCII saja. Query string panjang (signed URL) perlu URL-encode. |
| Redirect | Hindari redirect; langsung 200 ke file |

---

## 6. Rate Limits & Error Codes

### 6.1 Rate limits

#### A. Limit publishing (per akun IG)

| Limit | Nilai | Diterapkan di |
|---|---|---|
| Post per 24 jam (moving period) | **50** menurut endpoint reference & `quota_total`; **100** menurut guide (inkonsisten — lihat §1.5) | `POST /{IG_ID}/media_publish` |
| Container dibuat per 24 jam (rolling) | **400** | `POST /{IG_ID}/media` |
| Carousel | maks **10** item; **1** post dihitung | — |
| Masa hidup container | **24 jam** lalu `EXPIRED` | — |
| Cerita (story) masa hidup | **24 jam** | — |

Query usage:
```
GET /{IG_USER_ID}/content_publishing_limit?fields=quota_usage,config&since={unix_ts}
```

Response:
```json
{ "data": [{
    "quota_usage": 2,
    "config": { "quota_total": 50, "quota_duration": 86400 }
}]}
```

`quota_duration` = 86400 detik = 24 jam.

#### B. Rate limit call umum (Instagram Platform BUC)

```
Calls within 24 hours = 4800 * Number of Impressions
```

Dimana "Impressions" = berapa kali konten akun IG user masuk ke layar seseorang dalam 24 jam terakhir. ([Rate Limits — Instagram Platform](https://developers.facebook.com/docs/graph-api/overview/rate-limiting#instagram-graph-api))

**Untuk akun kampus kecil, ini bukan masalah** — 4.800 call/hari sudah sangat longgar. Tetap, **publishing image butuh ~2-3 API call per post**, jadi 50 post ≈ 150 call. Tidak masalah.

Saat rate limit kena, error code-nya: **`80002`** (Instagram BUC), atau `4` (app-level), `17` (user-level), `613` (custom). ([Rate Limits → Error Codes](https://developers.facebook.com/docs/graph-api/overview/rate-limiting#error-codes))

### 6.2 Error codes yang paling mungkin ditemui

Diurutkan dari **paling relevan untuk proyek ini**:

| HTTP | Code | Subcode | Arti | Solusi resmi |
|---|---|---|---|---|
| 400 | 36001 | 2207005 | *"The image format is not supported"* | **PNG ditolak — pakai JPEG** |
| 400 | 36000 | 2207004 | *"The image is too large to download. It should be less than 8 MiB"* | Kompres gambar |
| 400 | 36003 | 2207009 | *"aspect ratio cannot be published"* | Aspect ratio harus 4:5 – 1.91:1 |
| 400 | 36004 | 2207010 | Caption kepanjangan | Maks 2200 karakter, 30 hashtag, 20 @tag |
| 400 | 9004 | 2207052 | *"The media could not be fetched from this uri"* | **URL tidak publik / mati / terblokir** |
| 400 | -2 | 2207003 | *"It takes too long to download the media"* | Retry; atau file terlalu besar / server lambat |
| 400 | 9007 | 2207027 | *"The media is not ready for publishing, please wait"* | **Tunggu `status_code` = `FINISHED`** |
| 400 | 24 | 2207008 | *"media builder ... does not exist or has been expired"* | **Retry 1-2x dalam 30 detik–2 menit**, lalu buat container baru |
| 400 | 24 | 2207006 | *"The media with {media-id} cannot be found"* | Permission hilang atau token expired |
| 400 | 9 | 2207042 | *"You reached maximum number of posts allowed by Content Publishing API"* | Kuota harian habis |
| 400 | 25 | 2207050 | *"The Instagram account is restricted"* | Akun IG inactive/checkpointed — user harus login & selesaikan |
| 400 | 4 | 2207051 | *"We restrict certain activity to protect our community"* | **Diduga spam** — kurangi frekuensi posting |
| 403 | 200 | — | *"calling app is missing the ads_management permission"* | Butuh `ads_management` (kasus role di Business Manager) |
| 400 | -1 | 2207032 | *"Create media fail, please try to re-create media"* | Gagal buat container — retry |
| 400 | -1 | 2207053 | *"unknown upload error"* | Buat container baru (umumnya video) |

Sumber lengkap: [Instagram Error Codes](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes)

> **Code 4 / subcode 2207051 (spam protection) adalah risiko khas untuk "anonymous message board".** Kalau konten menfes terlihat seperti spam (banyak posting identik, atau caption yang selalu sama), Meta bisa memblokir. Mitigasi: varyasi caption, jangan post terlalu cepat, dan fisik **jangan** screenshot penuh nama yang sama berulang. Ini juga Tips Pintar untuk Dari user privacy standpoint.

### 6.3 Container status & polling

`GET /{IG_CONTAINER_ID}?fields=status_code`

| `status_code` | Arti |
|---|---|
| `IN_PROGRESS` | Masih diproses |
| `FINISHED` | **Siap dipublish** |
| `PUBLISHED` | Sudah terbit |
| `ERROR` | Gagal — cek field `status` (mengandung error subcode) |
| `EXPIRED` | Tidak dipublish dalam 24 jam |

Rekomendasi resmi: *"query a container's status **once per minute, for no more than 5 minutes**."*

### 6.4 Strategi retry

| Skenario | Aksi |
|---|---|
| Subcode `2207008` (container expired/tidak ada) | Retry `media_publish` 1–2x dalam 30 detik–2 menit. Kalau gagal, **buat container baru dari awal** |
| Subcode `2207027` (not ready) | Poll `status_code` tiap menit, maks 5x. Jangan langsung retry `media_publish` |
| Subcode `2207003` (timeout download) | Retry dengan backoff. Pastikan URL stabil |
| Subcode `2207004` (terlalu besar) / `2207005` (format) | **Jangan retry** — perbaiki input (compress / convert ke JPEG) |
| Subcode `2207042` (kuota habis) | **Jangan retry** hari ini. Jadwalkan ulang besok |
| Subcode `2207051` (spam) | **Jangan retry.** Backoff panjang, kurangi frekuensi |
| Token expired | Refresh token, retry sekali. Kalau gagal total → alert ke admin, jangan loop diam-diam |

**Idempotency:** `media_publish` **tidak** bersifat idempotent dan **tidak** ada idempotency key di API. Kalau publish sukses tapi response hilang (network timeout), retry bisa membuat **post duplikat**. Mitigasi: cek dulu apakah `status_code` container sudah `PUBLISHED` sebelum retry. Ini detail penting untuk sistem auto-publish.

---

## 7. Reels, Stories, Hashtag, Location, Alt-Text

### 7.1 Ringkasan dukungan

| Fitur | Didukung? | Detail |
|---|---|---|
| **Feed image** | ✅ | JPEG, maks 8MB, AR 4:5–1.91:1 |
| **Carousel** | ✅ | Maks 10 item (gambar + video) |
| **Reels** | ✅ | `media_type=REELS`, video MOV/MP4 |
| **Story (image)** | ✅ | `media_type=STORIES`, **hanya akun Business** |
| **Story (video)** | ✅ | Maks 60 detik, maks 100MB |
| **Hashtag** | ✅ | Di dalam field `caption` (bukan parameter terpisah) |
| **@mention** | ✅ | Di `caption` (maks 20) atau `user_tags` (koordinat) |
| **Location** | ✅ | `location_id` = ID **Facebook Page** yang punya data lokasi |
| **Alt text** | ✅ | **Image posts saja** |
| **Product tag** | ⚠️ | Hanya FB Login, butuh Instagram Shop |
| **Sticker (link/poll/location)** | ❌ | Docs: *"Publishing stickers (i.e., link, poll, location) is not supported"* |
| **Filter** | ❌ | Docs: *"Filters are not supported"* |
| **Shopping tag** | ❌ | Docs: *"Shopping tags are not supported"* |

### 7.2 Hashtag

**Tidak ada parameter `hashtags` terpisah.** Hashtag ditulis di dalam `caption` sebagai teks biasa:

```
caption="Menfes hari ini #Kampus #MenfesHarkatNekatt #Anonymous"
```

Dukungan hashtag sudah ada sejak **8 Februari 2018** ([Changelog](https://developers.facebook.com/docs/instagram-platform/changelog)).

Batas caption ([IG User Media → caption](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media#query-string-parameters)):
- **Maks 2200 karakter**
- **Maks 30 hashtag**
- **Maks 20 @tag**
- Mention langsung di caption → user yang disebut akan dapat notifikasi saat container dipublish

⚠️ **Caption tidak didukung di item gambar/video dalam carousel** (*"Not supported on images or videos in carousels"*).

### 7.3 Location

```
location_id = {LOCATION_PAGE_ID}   // ID Facebook Page yang merepresentasikan lokasi fisik
```

[`location_id` di docs](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media#query-string-parameters). Cara memperolehnya: pakai **Pages Search API**, cari Pages yang namanya cocok, parse `location` field, verifikasi Page itu punya data lokasi.

Error kalau Page-nya tidak punya data lokasi: **`INSTAGRAM_PLATFORM_API__INVALID_LOCATION_ID`**.

⚠️ **Tidak didukung di item carousel.**

Untuk Menfes Harkat Nekatt: **sulit di-automate** karena butuh Page ID Meta yang spesifik per lokasi. Saran: hardcode satu Page ID untuk lokasi kampus di config, atau **skip** location.

### 7.4 Alt text (accessibility caption)

Ditambahkan **24 Maret 2025**:

> *"On March 24, 2025, we introduced the new `alt_text` field for image posts on the `/<INSTAGRAM_PROFESSIONAL_ACCOUNT_ID>/media` endpoint. **Reels and stories are not supported.**"*
> — [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)

Spesifikasi ([`alt_text` di docs](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media#query-string-parameters)):
- **Untuk image posts saja**
- **Maks 1000 karakter**
- Hanya didukung pada **single image** atau **image media dalam carousel**
- ❌ Reels ❌ Story

Ini **bagus untuk proyek ini** — karena menfes board bersifat tekstual, alt text bisa berisi isi menfes yang sudah dianonimkan. Improves accessibility.

### 7.5 Story — perbedaan requirements vs feed

| Aspek | Feed image | Story image |
|---|---|---|
| `media_type` | (kosong / default) | **`STORIES`** wajib |
| Akun | Business atau Creator | **Business saja** |
| Aspect ratio | 4:5 – 1.91:1 | **Rekomendasi 9:16** |
| Resolusi maks | Width 1440 | — |
| File size | 8 MB | 8 MB |
| Format | JPEG | JPEG |
| Caption | ✅ (2200/30/20) | ❌ (tidak ada di story container) |
| Alt text | ✅ | ❌ |
| Sticker | ❌ | ❌ |
| `user_tags` | x/y **wajib** | x/y opsional |
| Masa hidup | Permanen | **24 jam** |
| Count quota | Ya | Ya (termasuk 50/100) |

Contoh request Story ([Image Story Containers](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media#image-story-containers)):

```
POST /{IG_USER_ID}/media
  ?image_url={URL}
  &media_type=STORIES
  &user_tags=[{username:ig_user_name}]
  &access_token={TOKEN}
```

> **Implikasi besar untuk proyek:** gambar IG story sekarang 1080×1080 (1:1). Instagram akan memotong atau letterbox. Untuk Story, harus render ulang pada **1080×1920** (9:16). Dua ukuran render berbeda, atau dua template.

### 7.6 Reels

```
POST /{IG_USER_ID}/media
  ?media_type=REELS
  &video_url={URL}
  &caption={...}
  &share_to_feed=true
  &access_token={TOKEN}
```

Spesifikasi ([Reel Specifications](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media#reel-specifications)): MOV/MP4, maks 1920px, durasi 3 detik–15 menit, maks 300MB, H264/HEVC, AAC audio.

⚠️ Reels **tidak bisa** masuk carousel.

> Reels **tidak relevan** untuk Menfes Harkat Nekatt saat ini (kontennya statis), tapi dicatat agar lengkap. Ada fitur **Trial Reels** (`trial_params` dengan `graduation_strategy`: `MANUAL` atau `SS_PERFORMANCE`) sejak 3 Des 2025 — menarik untuk strategi trial konten sebelum publish ke followers.

### 7.7 Parameter lain yang tersedia (per 22 Jun 2026)

| Parameter | Efek |
|---|---|
| `is_ai_generated=true` | Menambahkan label "AI info" pada post. **Berlaku untuk kedua jalur API.** Hanya di carousel container (memberi error di children). |
| `branded_content_sponsor_ids` | Tag maksimal 2 brand partner. FB Login saja. |
| `is_paid_partnership` | Label "Paid partnership". FB Login saja. |

Untuk anonymous message board, `is_ai_generated` kemungkinan besar tidak relevan (konten dari manusia). Tapi jika suatu saat pakai AI untuk generate gambar, ini wajib.

---

## 8. App Review & Business Verification

### 8.1 Kabar baiknya: untuk kasus single-admin, App Review TIDAK wajib

Ini poin yang paling sering disalahpahami. Docs eksplisit:

> *"If your app will be used by anyone **without a Role** on the app or a role in a Business that has claimed the app, it must first undergo App Review. **If your app will only be used by app users who have a role on the app itself, App Review is not required.**"*
> — [App Review](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review)

Dan untuk access level:

> *"**Standard Access** ... If your app only serves your Instagram professional account or an account you manage, **Standard Access is all your app needs**."*
> — [Overview → Access levels](https://developers.facebook.com/documentation/instagram-platform/overview#access-levels)

Dit reinforce oleh Business Verification docs:

> *"**If your app will only be used by app users who have a role on the app itself you do not need to complete verification**; these users can grant your app any permissions at any time and all features are always active."*
> — [Business Verification](https://developers.facebook.com/documentation/development/release/business-verification)

**Implikasi untuk Menfes Harkat Nekatt:** kalau satu admin meng Collegiate akun, app, dan Page-nya sendiri → **Standard Access cukup, tanpa App Review, tanpa Business Verification, tanpa Live Mode**. Ini mengubah calculus biaya waktu secara drastis.

### 8.2 Kapan App Review MENJADI wajib

| Situasi | Yang dibutuhkan |
|---|---|
| Admin publishing ke akun IG-nya sendiri | Standard Access. **No App Review.** |
| App dipakai user lain yang **bukan** role di app | **App Review + Business Verification + Advanced Access** |
| Multi-tenant (banyak user, masing-masing IG-nya) | App Review + Business Verification |
| Ingin fitur di luar 2 scope | App Review per-permission |

### 8.3 Advanced Access — syarat dan biaya waktu

[Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels):

> *"**As of February 1, 2023** apps requesting advanced access for permissions may have to be connected to a **verified business**."*

Kebutuhan Advanced Access:
1. **Business Verification** di Business Manager
2. **App Review** — Meta akan **menguji app Anda**. Docs: *"If we are unable to access your app to test it, **your entire submission will be rejected**."*
3. Screencast/walkthrough yang menunjukkan alur persetujuan permission
4. Data handling questions
5. **Annual Data Use Checkup** setelahnya

> **Peringatan khusus untuk app private/intranet:** Docs menyediakan pengecualian — *"If reviewers are unable to test your app because it is behind a private intranet, has no user interface, or has not implemented Facebook Login for Business, you can request approval **only** for: `instagram_basic`, `instagram_manage_comments`."* — perhatikan **`instagram_content_publish` tidak ada di daftar itu**. Jadi kalau nanti butuh App Review untuk sebuah dashboard admin yang tertutup, permissions publishing mungkin tidak bisa di-review. → **perlu verifikasi**

### 8.4 Checklist materi App Review (kalau nanti perlu)

Untuk `instagram_content_publish` ([Permissions Reference](https://developers.facebook.com/docs/permissions/reference/instagram_content_publish)):

**Use Case Description:**
> *"Provide specific examples of why your app requires the `instagram_content_publish` permission to create and publish organic feed photo and video posts on behalf of other businesses."*

**Screencast Requirements:**
- Tunjukkan proses Facebook login lengkap di platform app Anda
- Tunjukkan pembuatan photo post baru
- Tunjukkan post tervalidasi ke feed user

Untuk `instagram_business_content_publish` (jalur IG Login), screencast-nya serupa tapi *"Demonstrate the complete Instagram login process"*.

Docs ini menyorot satu aturan penting: *"**Only select permissions that your app needs to function as intended. Selecting unneeded permissions is a common reason for rejection during app review.**"*

### 8.5 Test users

Tidak ada konsep "test users" khusus di docs Instagram Platform. Yang relevan adalah **App Roles**: Standard Access permissions hanya bisa diminta dari user yang punya role di app. Untuk testing, tambahkan akun admin sebagai role di app.

---

## 9. Biaya

### 9.1 Tidak ada biaya per publish

**Tidak ada satu pun halaman dokumentasi Meta yang menyebut biaya per publish, per API call, atau tarif (rate card) untuk Content Publishing API.** Saya cek Platform Terms dan docs rate limiting — keduanya hanya membahas kuota, tidak pernah menyebut tagihan.

Lisensi yang diberikan Meta bersifat **royalty-free**:

> *"you grant us a non-exclusive, transferable, sublicensable, **royalty-free**, worldwide license to: host, use, distribute, modify, run, copy, publicly perform or display, translate, and create derivative works of any information, data, and other content made available by you..."*
> — [Platform Terms §2.b.i.1](https://developers.facebook.com/terms)

### 9.2 ⚠️ Tapi Meta tidak menjamin gratis selamanya

Clause yang harus dipahami tim, wording persisnya:

> *"**We do not guarantee that Platform will always be free.**"*
> — [Platform Terms §11.f](https://developers.facebook.com/terms) (last updated 3 Februari 2026)

Artinya: gratis **sekarang**, tapi secara kontraktual bisa berubah. Jangan tulis di pitch deck bahwa "Instagram API gratis selamanya".

### 9.3 Biaya riil (non-Meta)

| Item | Estimasi | Catatan |
|---|---|---|
| Meta API | **Rp0** | Tidak ada biaya per publish |
| Meta Business Verification | Rp0 | Coment costs time + dokumen legal |
| Public image hosting | **Rp0 – Rp50rb/bulan** | R2/Spaces free tier cukup untuk traffic kampus; Supabase Pro $25/bulan bila perlu |
| Server/cron | Rp0 – Rp100rb/bulan | Bila sudah punya VPS, nol |
| **App Review (bila perlu)** | **Waktu, bukan uang** | 1-4 minggu + screencast + Business Verification |

> Bandingkan: tools pihak ketiga (Later, Buffer, Hootsuite) berbiaya **Rp300rb – Rp2 juta/bulan**. Meta API gratis adalah argumen terkuat untuk build in-house.

### 9.4 API ini gratis — justru lebih murah

Strukturnya jelas: Instagram Content Publishing API sendiri gratis, sementara produk Meta yang **berbayar** adalah messaging lewat Messenger Platform (beberapa model per-konversi) dan iklan. Untuk use case "auto-post gambar", kita tidak menyentuh produk berbayar itu sama sekali.

---

## 10. Ringkasan Ekologis: Yang Perlu Diketahui Tim

### 10.1 Timeline keputusan

| Langkah | Estimasi effort | Blocker |
|---|---|---|
| 1. Pastikan akun IG adalah **Business** (bukan Personal/Creator, Kalau butuh Story) | 5 menit | ❗ **Hard blocker** |
| 2. Bikin Meta App (type **Business**), add product **Instagram** | 15 menit | — |
| 3. Ambil Instagram App ID + Secret dari `Business login settings` | 5 menit | — |
| 4. Generate long-lived token dari App Dashboard (60 hari) | 5 menit | — |
| 5. **Spike**: publish 1 gambar uji dari URL publik | 30 menit | Validasi end-to-end |
| 6. Pindahkan render canvas ke server, ubah PNG → JPEG | 2-4 jam | Issue utama #1 & #2 |
| 7. Integrasikan ke flow approve | 2-4 jam | — |
| 8. Setup cron refresh token + heartbeat 7 hari | 1-2 jam | **JANGAN Lupa** |
| **Total MVP** | **± 1-2 hari kerja** | |

### 10.2 5 jebakan yang harus diwaspadai

| # | Jebakan | Mitigasi |
|---|---|---|
| 1 | Kirim PNG → error `36001` | Convert ke JPEG sebelum upload |
| 2 | Kirim dari `blob:`/local URL → error `9004` | Upload ke public storage dulu |
| 3 | Publish langsung setelah `POST /media` tanpa poll → `9007` | Poll `status_code` = `FINISHED` |
| 4 | Lupa URL expired dihapus → intermittent `9004` | Jangan hapus file < 24 jam setelah publish |
| 5 | Token 60 hari habis → seluruh auto-post mati diam-diam | Cron refresh + alert + heartbeat 7 hari |

### 10.3 Pertanyaan yang masih perlu diverifikasi

Item berikut **tidak bisa dijawab dengan pasti dari primary source** — jangan diasumsikan:

| # | Pertanyaan | Mengapa belum pasti | Cara verifikasi |
|---|---|---|---|
| 1 | **System User token bisa dipakai di `/{ig-user-id}/media`?** | Docs IG Platform hanya menyebut "User access token"; docs system user hanya cover Marketing + Pages API | Spike langsung. Test dengan token system user. Ini **wajib diuji sebelum arsitektur final** |
| 2 | **Limit 50 atau 100 post/hari?** | Docs resmi bertentangan (§1.5) | `GET /{ig-user-id}/content_publishing_limit` → baca `config.quota_total` |
| 3 | **Story via Instagram Login juga Business-only?** | Restriksi hanya tertulis di halaman Facebook Login | Test `media_type=STORIES` dengan akun Creator di `graph.instagram.com` |
| 4 | **Mekanisme refresh token jalur App Dashboard?** | Docs hanya menjelaskan refresh untuk token dari OAuth flow | Cek dashboard; kemungkinan perlu re-generate manual tiap 60 hari |
| 5 | **`enable_fb_login` deprecated atau aktif?** | Changelog 14 Jun 2025 bilang deprecated; docs 6 Feb 2026 memperkenalkannya lagi | Cek Instagram OAuth docs terbaru saat implementasi |
| 6 | **`instagram_content_publish` bisa di-review untuk private app?** | Docs mengecualikan `instagram_business_content_publish` dari daftar private-app exception | Tanya Meta support / lihat form App Review |

### 10.4 Sumber utama (semua resmi)

| Topik | URL |
|---|---|
| Content Publishing guide | https://developers.facebook.com/documentation/instagram-platform/content-publishing |
| IG User Media reference | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media |
| IG User Media Publish | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish |
| IG Content Publishing Limit | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit |
| IG Container | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container |
| Error Codes | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes |
| Instagram Platform Overview | https://developers.facebook.com/documentation/instagram-platform/overview |
| **Changelog Instagram Platform** | https://developers.facebook.com/docs/instagram-platform/changelog |
| Changelog Graph API (versi) | https://developers.facebook.com/docs/graph-api/changelog |
| API with Instagram Login | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login |
| Business Login for Instagram | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login |
| IG Login Get Started | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started |
| Migration guide | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/migration-guide |
| API with Facebook Login | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login |
| FB Login Get Started | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started |
| Access Tokens | https://developers.facebook.com/documentation/facebook-login/guides/access-tokens |
| System Users | https://developers.facebook.com/docs/marketing-api/businessmanager/systemuser |
| Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting |
| Access Levels | https://developers.facebook.com/docs/graph-api/overview/access-levels |
| Permissions Reference | https://developers.facebook.com/docs/permissions/reference |
| App Review | https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review |
| Business Verification | https://developers.facebook.com/documentation/development/release/business-verification |
| Platform Versioning | https://developers.facebook.com/docs/graph-api/guides/versioning |
| **Meta Platform Terms** | https://developers.facebook.com/terms |
| Blog: Content Publishing luncur | https://developers.facebook.com/blog/post/2021/01/26/introducing-instagram-content-publishing-api |
| Blog: Creator accounts + limit 50 | https://developers.facebook.com/blog/post/2023/06/12/introducing-new-features-and-expanded-user-types-to-the-instagram-content-publishing-api |
| Blog: Stories publishing | https://developers.facebook.com/blog/post/2023/05/16/introducing-stories-publishing-to-the-content-publishing-api-on-instagram |

---

## Catatan Metodologi

Semua fakta di dokumen ini tertelusur ke halaman di atas. Hal yang **tidak** ada di primary source ditandai eksplisit sebagai **"perlu verifikasi"** di §10.3 — tidak ada endpoint, scope, atau angka yang dikarang.

Beberapa inkonsistensi internal di docs Meta (limit 50 vs 100, `enable_fb_login` deprecated vs aktif) dilaporkan apa adanya di §1.5 dan §10.3, bukan "dibulatkan" menjadi satu angka.

Karena area ini berubah cepat (changelog terakhir 22 Juni 2026, versi API v26.0 baru saja rilis 29 Juli 2026), **cek ulang official changelog sebelum implementasi**, dan setiap kali kamu menemukan dokumentasi yang berbeda.
