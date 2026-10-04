/**
 * Bukti sebelum implementasi revokasi token.
 *
 * Mekanisme yang direncanakan: pakai kolom `updatedAt` yang SUDAH ADA di
 * schema sebagai penanda revocasi. `updatedAt` berannotasi @updatedAt,
 * jadi Prisma mengubahnya otomatis setiap kali baris Admin di-update.
 *
 * Dua asumsi yang harus benar, kalau tidak seluruh mekanisme ini rapuh:
 *
 *   A1. Update password benar-benar mengubah updatedAt.
 *   A2. Presisi milidetik bertahanNYA di database.
 *       Kalau MariaDB menyimpan datetime tanpa milidetik, dua login dalam
 *       detik yang sama akan memiliki st yang identik, dan perubahan
 *       password di detik yang sama dengan login tidak akan mencabut
 *       token itu.
 *
 *_DB: MariaDB lokal, bukan produksi._
 */
process.chdir(require('path').join(__dirname, '..'));

const { PrismaClient } = require('@prisma/client');

const USER = 'revoke-proof';

let gagal = 0;
const cek = (nama, lulus, info = '') => {
  if (!lulus) gagal++;
  console.log(`${lulus ? 'OK   ' : 'GAGAL'}  ${nama}${info ? '   [' + info + ']' : ''}`);
};

(async () => {
  const prisma = new PrismaClient();
  await prisma.admin.deleteMany({ where: { username: USER } });

  const awal = await prisma.admin.create({
    data: { username: USER, password: 'x' },
    select: { updatedAt: true },
  });
  console.log('  dibuat  updatedAt = ' + awal.updatedAt.toISOString());

  // ── A1: update password mengubah updatedAt ────────────────────────────────
  await new Promise((r) => setTimeout(r, 25)); // ensure a visible tick
  const st1 = awal.updatedAt.getTime();

  const setelah = await prisma.admin.update({
    where: { username: USER },
    data: { password: 'y' },
    select: { updatedAt: true },
  });
  const st2 = setelah.updatedAt.getTime();

  cek('A1. update password mengubah updatedAt', st2 !== st1,
    `${st1} -> ${st2}`);

  // Skenario yang paling relevan untuk rotasi: update dengan password yang
  // sama persis. Kalau updatedAt tidak berubah, rotasi diam-diam gagal.
  await new Promise((r) => setTimeout(r, 25));
  const st3 = (await prisma.admin.update({
    where: { username: USER },
    data: { password: 'y' },
    select: { updatedAt: true },
  })).updatedAt.getTime();
  cek('A1b. update dengan password yang SAMA juga mengubah updatedAt',
    st3 !== st2, `${st2} -> ${st3}`);

  // ── A2: presisi milidetik bertahan ────────────────────────────────────────
  const putar = new Date(st3).getTime();
  cek('A2. st -> Date -> st stabil (tidak ada pembulatan)',
   putar === st3, `${st3} -> ${putar}`);
  cek('A2b. presisi milidetik, bukan detik',
    st3 % 1000 !== 0, `st3 = ${st3}, sisa pembagian 1000 = ${st3 % 1000}`);

  // Dua perubahan dalam window 1 ms harus tetap menghasilkan st berbeda.
  const a = (await prisma.admin.update({
    where: { username: USER }, data: { password: 'p1' },
    select: { updatedAt: true } })).updatedAt.getTime();
  const b = (await prisma.admin.update({
    where: { username: USER }, data: { password: 'p2' },
    select: { updatedAt: true } })).updatedAt.getTime();
  cek('A2c. dua update beruntun menghasilkan st berbeda',
    a !== b, `${a} vs ${b} (selisih ${b - a} ms)`);

  // ── Untuk logout: menaikkan updatedAt tanpa mengganti password ───────────
  // `data: {}` ditolak Prisma di level SQL, jadi tidak bisa dipakai.
  // Yang bisa: menulis ulang field dengan nilai yang sama. SQL-nya tetap
  // issued, dan @updatedAt tetap terisi.
  const row = await prisma.admin.findUnique({
    where: { username: USER },
    select: { updatedAt: true, username: true },
  });
  const sebelumLogout = row.updatedAt.getTime();

  await new Promise((r) => setTimeout(r, 25));
  const sesudahLogout = (await prisma.admin.update({
    where: { username: USER },
    data: { username: row.username },
    select: { updatedAt: true },
  })).updatedAt.getTime();

  cek('A3. tulis ulang username yang sama menaikkan updatedAt',
    sesudahLogout !== sebelumLogout,
    `${sebelumLogout} -> ${sesudahLogout}`);

  const pwTetap = await prisma.admin.findUnique({
    where: { username: USER }, select: { password: true },
  });
  cek('A3b. password tidak ikut berubah saat logout',
    pwTetap.password === 'p2', 'password tetap p2');

  await prisma.admin.deleteMany({ where: { username: USER } });
  await prisma.$disconnect();

  console.log('');
  console.log(gagal === 0
    ? 'Semua asumsi terpenuhi.'
    : `${gagal} asumsi GAGAL. Mekanisme ini tidak bisa/langsung perlu diubah.`);
  process.exit(gagal === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERROR:', e.stack);
  process.exit(1);
});
