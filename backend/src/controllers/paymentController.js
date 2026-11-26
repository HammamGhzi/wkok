const crypto = require('crypto');
const prisma = require('../lib/prisma');

const DOKU_BASE_URL = 'https://api.doku.com';
const HARGA_MENFES = 1000; // Rp 1.000
const GRATIS_PER_HARI = 1; // Kiriman pertama gratis

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip + process.env.JWT_SECRET).digest('hex').substring(0, 16);
}

function awalHariIniWib() {
  const now = new Date();
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const nowWib = now.getTime() + WIB_OFFSET_MS;
  return new Date(nowWib - (nowWib % (24 * 60 * 60 * 1000)) - WIB_OFFSET_MS);
}

/**
 * Buat signature DOKU Non-SNAP
 * Digest = Base64(SHA256(minified JSON body))
 * Component = Client-Id\nRequest-Id\nRequest-Timestamp\nRequest-Target\nDigest
 * Signature = HMACSHA256=Base64(HMAC-SHA256(component, secretKey))
 */
function buatSignature(clientId, secretKey, requestId, timestamp, path, bodyStr) {
  const digest = crypto.createHash('sha256').update(bodyStr, 'utf8').digest('base64');
  const component = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${path}`,
    `Digest:${digest}`,
  ].join('\n');
  const signature = 'HMACSHA256=' + crypto.createHmac('sha256', secretKey).update(component, 'utf8').digest('base64');
  return { signature, digest };
}

/**
 * GET /api/payment/check
 * Cek apakah IP perlu bayar untuk kiriman berikutnya
 */
async function cekStatusBayar(req, res) {
  try {
    // Feature flag — kalau payment belum aktif, selalu return tidak perlu bayar
    if (process.env.PAYMENT_ENABLED === 'false') {
      return res.json({ perluBayar: false, sudahBayar: false });
    }

    const ipHash = hashIp(req.ip);
    if (!ipHash) return res.json({ perluBayar: false, sudahBayar: false });

    const awal = awalHariIniWib();

    const jumlahKiriman = await prisma.menfes.count({
      where: { ipHash, createdAt: { gte: awal } },
    });

    if (jumlahKiriman < GRATIS_PER_HARI) {
      return res.json({ perluBayar: false, sudahBayar: false, sisaGratis: GRATIS_PER_HARI - jumlahKiriman });
    }

    const paymentSukses = await prisma.payment.findFirst({
      where: { ipHash, status: 'SUCCESS', paidAt: { gte: awal } },
      orderBy: { paidAt: 'desc' },
    });

    if (paymentSukses) {
      return res.json({ perluBayar: false, sudahBayar: true });
    }

    const paymentPending = await prisma.payment.findFirst({
      where: { ipHash, status: 'PENDING', expiredAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (paymentPending) {
      return res.json({
        perluBayar: true,
        sudahBayar: false,
        checkoutUrl: paymentPending.checkoutUrl,
        invoiceNumber: paymentPending.invoiceNumber,
      });
    }

    return res.json({ perluBayar: true, sudahBayar: false });
  } catch (err) {
    console.error('Cek status bayar error:', err);
    res.status(500).json({ error: 'Gagal cek status pembayaran.' });
  }
}

/**
 * POST /api/payment/create
 * Buat invoice DOKU dan return URL checkout
 */
async function buatPayment(req, res) {
  try {
    // Feature flag — set PAYMENT_ENABLED=false di env untuk pause
    if (process.env.PAYMENT_ENABLED === 'false') {
      return res.status(503).json({ error: 'Fitur pembayaran belum aktif.' });
    }

    const ipHash = hashIp(req.ip);
    if (!ipHash) return res.status(400).json({ error: 'IP tidak terdeteksi.' });

    const clientId = process.env.DOKU_CLIENT_ID;
    const secretKey = process.env.DOKU_SECRET_KEY;

    if (!clientId || !secretKey) {
      return res.status(500).json({ error: 'Konfigurasi payment belum lengkap.' });
    }

    const invoiceNumber = `HF-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const path = '/checkout/v1/payment';
    const expiredAt = new Date(Date.now() + 60 * 60 * 1000); // 60 menit

    const frontendUrl = process.env.FRONTEND_URL || 'https://harkatfess.vercel.app';
    const backendUrl = process.env.BACKEND_URL || 'https://menfs.onrender.com';

    const body = {
      order: {
        amount: HARGA_MENFES,
        invoice_number: invoiceNumber,
        callback_url: `${backendUrl}/api/payment/notification`,
      },
      payment: {
        payment_due_date: 60,
      },
    };

    const bodyStr = JSON.stringify(body);
    const { signature } = buatSignature(clientId, secretKey, requestId, timestamp, path, bodyStr);

    const response = await fetch(`${DOKU_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': clientId,
        'Request-Id': requestId,
        'Request-Timestamp': timestamp,
        'Signature': signature,
      },
      body: bodyStr,
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json();

    if (!response.ok || !data.response?.payment?.url) {
      console.error('DOKU error status:', response.status);
      console.error('DOKU error body:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gagal membuat halaman pembayaran.' });
    }

    const checkoutUrl = data.response.payment.url;

    await prisma.payment.create({
      data: {
        invoiceNumber,
        ipHash,
        amount: HARGA_MENFES,
        status: 'PENDING',
        checkoutUrl,
        expiredAt,
      },
    });

    res.json({ checkoutUrl, invoiceNumber });
  } catch (err) {
    console.error('Buat payment error:', err);
    res.status(500).json({ error: 'Gagal membuat pembayaran.' });
  }
}

/**
 * POST /api/payment/notification
 * Webhook dari DOKU setelah pembayaran
 */
async function notifikasiPayment(req, res) {
  try {
    const { order, transaction } = req.body || {};
    const invoiceNumber = order?.invoice_number;
    const transactionStatus = transaction?.status;

    if (!invoiceNumber) return res.status(400).json({ error: 'Invoice tidak valid.' });

    const payment = await prisma.payment.findUnique({ where: { invoiceNumber } });
    if (!payment) return res.status(404).json({ error: 'Payment tidak ditemukan.' });

    let status = payment.status;
    let paidAt = payment.paidAt;

    if (transactionStatus === 'SUCCESS') {
      status = 'SUCCESS';
      paidAt = new Date();
    } else if (transactionStatus === 'FAILED' || transactionStatus === 'EXPIRED') {
      status = transactionStatus;
    }

    await prisma.payment.update({
      where: { invoiceNumber },
      data: { status, paidAt },
    });

    console.log(`[Payment] ${invoiceNumber} → ${status}`);
    res.json({ message: 'OK' });
  } catch (err) {
    console.error('Notifikasi payment error:', err);
    res.status(500).json({ error: 'Gagal proses notifikasi.' });
  }
}

/**
 * GET /api/payment/status/:invoiceNumber
 * Cek status payment tertentu
 */
async function statusPayment(req, res) {
  try {
    const { invoiceNumber } = req.params;
    const ipHash = hashIp(req.ip);

    const payment = await prisma.payment.findUnique({ where: { invoiceNumber } });
    if (!payment || payment.ipHash !== ipHash) {
      return res.status(404).json({ error: 'Payment tidak ditemukan.' });
    }

    res.json({ status: payment.status, invoiceNumber });
  } catch (err) {
    console.error('Status payment error:', err);
    res.status(500).json({ error: 'Gagal cek status payment.' });
  }
}

module.exports = { cekStatusBayar, buatPayment, notifikasiPayment, statusPayment };
