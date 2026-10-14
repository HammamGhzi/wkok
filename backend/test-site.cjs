/**
 * Uji fitur buka/tutup menfess lewat HTTP nyata ke app lokal.
 *
 * Perilaku yang dijaga:
 *   1. GET /api/site/status publik dan selalu menyertakan jadwal jam buka;
 *   2. selama TERBUKA, submit menfes lolos (201);
 *   3. toggle admin menutup situs -> status publik ikut tertutup;
 *   4. selama TERTUTUP, submit menfes ditolak 403 berisi jadwal — inilah
 *      pengaman yang membuat layar tutup di halaman user tidak bisa
 *      ditembus lewat API langsung;
 *   5. toggle ditolak tanpa token (401) dan dengan tipe data salah (400);
 *   6. toggle membuka lagi -> submit kembali lolos;
 *   7. limit global 100 request/15 menit TIDAK mematikan GET /api/site/status —
 *      kalau endpoint ini bisa membalas 429, halaman user tidak tahu situs
 *      sedang tutup dan layar tutup jadi tidak bisa dipercaya.
 *   8. jadwal jam buka dievaluasi otomatis (unit, waktu tetap): dalam slot ->
 *      buka, di luar slot -> tutup, batas waktu diuji eksplisit, konversi
 *      UTC server ke WIB benar;
 *   9. sakelar admin kini bertiga: mode 'auto' (ikut jadwal) / 'buka' /
 *      'tutup' (paksa). Mode paksa MENANG atas jadwal, mode 'auto' membuka
 *      kembali mengikuti jadwal, mode tidak valid ditolak 400, dan bentuk
 *      lama { open: boolean } tetap diterima.
 *
 * DB: database yang sama dengan test lain. Karena toggle menulis baris
 * SiteSetting di database itu, test mengambil status AWAL dulu dan
 * mengembalikannya persis di blok finally — termasuk menghapus barisnya
 * kembali kalau memang belum pernah ada, supaya keadaan admin tidak
 * pernah berubah gara-gara test ini.
 */

process.chdir(__dirname);
const path = require('path');

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'OK   ' : 'GAGAL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

(async () => {
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';

  const app = require(path.join(__dirname, 'src/index.js'));
  await new Promise((r) => setTimeout(r, 700));
  const server = app.listen(0);
  await new Promise((r) => setTimeout(r, 300));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { PrismaClient } = require('@prisma/client');
  const bcrypt = require('bcryptjs');
  const prisma = new PrismaClient();

  const USER = 'site-test-admin';
  const PASS = 'password-site-123';
  await prisma.admin.deleteMany({ where: { username: USER } });
  await prisma.admin.create({
    data: { username: USER, password: await bcrypt.hash(PASS, 10) },
  });

  // Status awal situs sebelum test menyentuhnya — dipulihkan di finally.
  const statusAwal = await prisma.siteSetting.findUnique({ where: { id: 'utama' } });

  let n = 0;
  const req = async (path_, { method = 'GET', body, token } = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.79.0.${(n++ % 250) + 1}`,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${base}${path_}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const buatMenfes = (pesan) =>
    req('/api/menfes', { method: 'POST', body: { message: pesan } });

  const idsMenfes = [];
  try {
    // ─── 1. status publik ────────────────────────────────────────────────────
    console.log('── 1. status publik ──');
    let r = await req('/api/site/status');
    check('GET status -> 200', r.status === 200, `HTTP ${r.status}`);
    check('field open berupa boolean', typeof r.body?.open === 'boolean', String(r.body?.open));
    check('jadwal jam buka ikut dikirim (3 slot)',
      Array.isArray(r.body?.jamBuka) && r.body.jamBuka.length === 3,
      JSON.stringify(r.body?.jamBuka));

    // ─── 2. submit saat terbuka ──────────────────────────────────────────────
    console.log('\n── 2. submit saat situs terbuka ──');
    // Paksa terbuka dulu supaya hasilnya tidak bergantung pada keadaan admin.
    r = await req('/api/auth/login', {
      method: 'POST',
      body: { username: USER, password: PASS },
    });
    const token = r.body?.token;
    check('login sukses (HTTP 200)', r.status === 200 && !!token, `HTTP ${r.status}`);

    r = await req('/api/admin/site', { method: 'PATCH', body: { open: true }, token });
    check('toggle admin buka -> 200', r.status === 200 && r.body?.open === true, `HTTP ${r.status}`);

    r = await buatMenfes('menfes uji saat situs terbuka');
    if (r.body?.id) idsMenfes.push(r.body.id);
    check('submit terbuka -> 201', r.status === 201, `HTTP ${r.status}`);

    // ─── 3. tutup lewat toggle admin ────────────────────────────────────────
    console.log('\n── 3. tutup lewat toggle admin ──');
    r = await req('/api/admin/site', { method: 'PATCH', body: { open: false }, token });
    check('toggle admin tutup -> 200', r.status === 200 && r.body?.open === false, `HTTP ${r.status}`);

    r = await req('/api/site/status');
    check('status publik ikut tertutup', r.body?.open === false, String(r.body?.open));

    // ─── 4. submit saat tertutup ditolak ────────────────────────────────────
    console.log('\n── 4. submit saat situs tertutup ──');
    r = await buatMenfes('menfes uji saat situs tertutup');
    check('submit tertutup -> 403', r.status === 403, `HTTP ${r.status}`);
    check('pesan menyebut sedang tutup',
      (r.body?.error || '').includes('tutup'), r.body?.error);
    check('pesan menyertakan jadwal jam buka',
      (r.body?.error || '').includes('Jam buka'), r.body?.error);
    check('menfes tertutup tidak masuk database', !r.body?.id, String(r.body?.id));

    // ─── 5. pengaman endpoint toggle ────────────────────────────────────────
    console.log('\n── 5. pengaman endpoint toggle ──');
    r = await req('/api/admin/site', { method: 'PATCH', body: { open: true } });
    check('toggle tanpa token -> 401', r.status === 401, `HTTP ${r.status}`);

    r = await req('/api/admin/site', { method: 'PATCH', body: { open: 'buka' }, token });
    check('toggle dengan tipe data salah -> 400', r.status === 400, `HTTP ${r.status}`);

    // ─── 6. buka lagi, submit kembali lolos ─────────────────────────────────
    console.log('\n── 6. buka lagi lewat toggle admin ──');
    r = await req('/api/admin/site', { method: 'PATCH', body: { open: true }, token });
    check('toggle admin buka lagi -> 200', r.status === 200 && r.body?.open === true, `HTTP ${r.status}`);

    r = await req('/api/site/status');
    check('status publik terbuka lagi', r.body?.open === true, String(r.body?.open));

    r = await buatMenfes('menfes uji setelah situs dibuka lagi');
    if (r.body?.id) idsMenfes.push(r.body.id);
    check('submit terbuka lagi -> 201', r.status === 201, `HTTP ${r.status}`);

    // ─── 7. limit global tidak boleh mematikan cek status ───────────────────
    // Semua request di sini pakai SATU IP yang sama supaya kuota limit
    // (100/15 menit per IP) benar-benar menumpuk, seperti pengguna asli.
    console.log('\n── 7. limit global vs GET /api/site/status ──');
    const IP_TETAP = '10.79.88.88';
    const reqIP = (path_) =>
      fetch(`${base}${path_}`, { headers: { 'X-Forwarded-For': IP_TETAP } });

    // Bukti limit global-nya HIDUP: endpoint lain yang di-limit kena 429
    // setelah kuota 100 terpakai (tanpa ini, test di bawah bisa lolos
    // gara-gara limiternya malah hilang total).
    let kena429 = false;
    for (let i = 0; i < 110 && !kena429; i++) {
      if ((await reqIP('/api/auth/me')).status === 429) kena429 = true;
    }
    check('limit global tetap berlaku untuk endpoint lain (-> 429)', kena429);

    // Bukti status DIBEBASKAN: 110 request berturut-turut dengan IP yang
    // kuotanya sudah habis — tidak boleh ada satu pun yang dibalas selain 200.
    let ok = 0;
    for (let i = 0; i < 110; i++) {
      if ((await reqIP('/api/site/status')).status === 200) ok++;
    }
    check('GET status lolos 110x dengan IP yang kehabisan kuota',
      ok === 110, `${ok}/110 -> 200`);

    // ─── 8. evaluasi jadwal (unit, waktu tetap) ─────────────────────────────
    // Waktu diuji langsung lewat fungsi murni supaya hasilnya tidak
    // bergantung pada jam berapa test ini dijalankan.
    console.log('\n── 8. evaluasi jadwal jam buka (unit) ──');
    const ctl = require(path.join(__dirname, 'src/controllers/siteController.js'));
    const ada = (nama) => typeof ctl[nama] === 'function';
    const dj = (menit) => (ada('diJadwal') ? ctl.diJadwal(menit) : 'FUNGSI_KOSONG');
    const mw = (d) => (ada('menitWib') ? ctl.menitWib(d) : 'FUNGSI_KOSONG');
    const jam = (h, m = 0) => h * 60 + m;

    check('siteController mengekspor diJadwal', ada('diJadwal'), typeof ctl.diJadwal);
    check('siteController mengekspor menitWib', ada('menitWib'), typeof ctl.menitWib);

    check('09:00 -> buka (di dalam slot 08-10)', dj(jam(9)) === true, String(dj(jam(9))));
    check('10:00 -> tutup (batas akhir tidak termasuk)', dj(jam(10)) === false, String(dj(jam(10))));
    check('16:00 -> buka (batas awal termasuk)', dj(jam(16)) === true, String(dj(jam(16))));
    check('21:00 -> tutup (batas akhir tidak termasuk)', dj(jam(21)) === false, String(dj(jam(21))));
    check('13:00 -> buka (di dalam slot 12-14)', dj(jam(13)) === true, String(dj(jam(13))));
    check('17:30 -> buka (di dalam slot 16-21)', dj(jam(17, 30)) === true, String(dj(jam(17, 30))));
    check('11:00 -> tutup (di antara slot)', dj(jam(11)) === false, String(dj(jam(11))));
    check('00:00 -> tutup (tengah malam)', dj(jam(0)) === false, String(dj(jam(0))));

    // Server Render UTC, jadwal WIB (UTC+7): 01:00Z = 08:00 WIB = 480 menit.
    const menit1 = mw(new Date('2026-10-13T01:00:00Z'));
    const menit2 = mw(new Date('2026-10-13T18:00:00Z'));
    check('01:00Z = 08:00 WIB = 480 menit', menit1 === 480, String(menit1));
    check('18:00Z = 01:00 WIB (lewat tengah malam) = 60 menit', menit2 === 60, String(menit2));
    check('01:00Z jatuh di dalam jadwal WIB', dj(menit1) === true, String(dj(menit1)));

    // ─── 9. sakelar tiga posisi: auto / buka / tutup ────────────────────────
    console.log('\n── 9. mode auto (ikut jadwal) vs paksa ──');
    r = await req('/api/admin/site', { method: 'PATCH', body: { mode: 'auto' }, token });
    check('PATCH mode auto -> 200 + mode auto',
      r.status === 200 && r.body?.mode === 'auto', `HTTP ${r.status} ${JSON.stringify(r.body)}`);

    r = await req('/api/site/status');
    check('status publik ikut menyertakan mode', r.body?.mode === 'auto', String(r.body?.mode));
    // Di mode auto, open HARUS sama persis dengan hasil evaluasi jadwal
    // pada menit WIB sekarang — inilah "buka/tutup otomatis ikut jadwal".
    // Ekspektasi dihitung ulang di dekat tiap request supaya tidak mungkin
    // meleset gara-gara jam berpindah batas slot di tengah test.
    check('mode auto -> open = hasil jadwal sekarang',
      r.body?.open === dj(mw(new Date())),
      `open=${r.body?.open} jadwal=${dj(mw(new Date()))}`);

    r = await req('/api/admin/site', { method: 'PATCH', body: { mode: 'buka' }, token });
    check('PATCH mode buka -> 200', r.status === 200 && r.body?.mode === 'buka', `HTTP ${r.status}`);
    r = await req('/api/site/status');
    check('mode buka memaksa open=true (menang atas jadwal)',
      r.body?.open === true && r.body?.mode === 'buka',
      `open=${r.body?.open} mode=${r.body?.mode}`);

    r = await req('/api/admin/site', { method: 'PATCH', body: { mode: 'tutup' }, token });
    check('PATCH mode tutup -> 200', r.status === 200 && r.body?.mode === 'tutup', `HTTP ${r.status}`);
    r = await req('/api/site/status');
    check('mode tutup memaksa open=false (menang atas jadwal)',
      r.body?.open === false && r.body?.mode === 'tutup',
      `open=${r.body?.open} mode=${r.body?.mode}`);

    // Guard submit ikut mode — bukan cuma tampilan layar tutup.
    r = await buatMenfes('menfes uji saat mode tutup paksa');
    if (r.body?.id) idsMenfes.push(r.body.id);
    check('submit saat mode tutup -> 403', r.status === 403, `HTTP ${r.status}`);

    // Balik ke auto: yang menentukan open kembali jadwal, bukan override.
    r = await req('/api/admin/site', { method: 'PATCH', body: { mode: 'auto' }, token });
    check('balik ke auto -> 200', r.status === 200 && r.body?.mode === 'auto', `HTTP ${r.status}`);
    r = await req('/api/site/status');
    check('setelah auto, open kembali = jadwal sekarang',
      r.body?.open === dj(mw(new Date())), `open=${r.body?.open} jadwal=${dj(mw(new Date()))}`);

    r = await req('/api/admin/site', { method: 'PATCH', body: { mode: 'kacau' }, token });
    check('mode tidak valid -> 400', r.status === 400, `HTTP ${r.status}`);

    r = await req('/api/admin/site', { method: 'PATCH', body: {}, token });
    check('body kosong -> 400', r.status === 400, `HTTP ${r.status}`);

    // Bentuk lama { open: boolean } harus tetap diterima — dashboard lama
    // (atau tab admin yang belum ke-refresh) masih mengirim bentuk ini.
    r = await req('/api/admin/site', { method: 'PATCH', body: { open: true }, token });
    check('bentuk lama { open: true } masih jalan',
      r.status === 200 && r.body?.open === true && r.body?.mode === 'buka',
      `HTTP ${r.status} ${JSON.stringify(r.body)}`);
  } finally {
    // ─── bersihkan: pulihkan keadaan situs persis seperti awal ──────────────
    if (statusAwal) {
      await prisma.siteSetting.upsert({
        where: { id: 'utama' },
        // mode ikut dipulihkan: test tadi menulis override paksa di bagian 9,
        // dan keadaan admin tidak boleh berubah gara-gara test ini.
        update: { isOpen: statusAwal.isOpen, mode: statusAwal.mode ?? 'auto' },
        create: { id: 'utama', isOpen: statusAwal.isOpen, mode: statusAwal.mode ?? 'auto' },
      });
    } else {
      // Belum pernah ada barisnya: hapus kembali supaya DB kembali seperti
      // sebelum test (bawaan "terbuka" tetap berlaku).
      await prisma.siteSetting.deleteMany({ where: { id: 'utama' } });
    }
    if (idsMenfes.length) {
      await prisma.menfes.deleteMany({ where: { id: { in: idsMenfes } } });
    }
    await prisma.admin.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  }

  const failed = results.filter((x) => !x.pass);
  console.log('\n============================================================');
  console.log(`${results.length - failed.length}/${results.length} lulus`);
  console.log('============================================================');
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('Test site error:', err);
  process.exit(1);
});
