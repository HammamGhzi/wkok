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
 * Buat signature DOKU
 * Format: "Client-Id:{{clientId}}\nRequest-Id:{{requestId}}\nRequest-Timestamp:{{timestamp}}\nRequest-Target:{{path}}\nDigest:{{digest}}"
 */
function buatSignature(clientId, secretKey, requestId, timestamp, path, body) {
  const digest = 'SHA-256=' + crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64');
  const componentToSign = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${timestamp}\nRequest-Target:${path}\nDigest:${digest}`;
  const signature = crypto.createHmac('sha256', secretKey).update(componentToSign).digest('base64');
  return { signature, digest };
}

/**
 * GET /api/payment/check
 * Cek apakah IP perlu bayar untuk kiriman berikutnya
 */
async function cekStatusBayar(req, res) {
  try {
    const ipHash = hashIp(req.ip);
    if (!ipHash) return res.json({ perluBayar: false, sudahBayar: false });

    const awal = awalHariIniWib();

    // Hitung kiriman hari ini
    const jumlahKiriman = await prisma.menfes.count({
      where: { ipHash, createdAt: { gte: awal } },
    });

    // Kalau masih dalam batas gratis
    if (jumlahKiriman < GRATIS_PER_HARI) {
      return res.json({ perluBayar: false, sudahBayar: false, sisaGratis: GRATIS_PER_HARI - jumlahKiriman });
    }

    // Cek apakah sudah ada payment SUCCESS hari ini yang belum dipakai
    const paymentSukses = await prisma.payment.findFirst({
      where: {
        ipHash,
        status: 'SUCCESS',
        paidAt: { gte: awal },
      },
      orderBy: { paidAt: 'desc' },
    });

    if (paymentSukses) {
      return res.json({ perluBayar: false, sudahBayar: true });
    }

    // Cek apakah ada payment PENDING yang masih aktif
    const paymentPending = await prisma.payment.findFirst({
      where: {
        ipHash,
        status: 'PENDING',
        expiredAt: { gt: new Date() },
      },
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
    const ipHash = hashIp(req.ip);
    if (!ipHash) return res.status(400).json({ error: 'IP tidak terdeteksi.' });

    const clientId = process.env.DOKU_CLIENT_ID;
    const secretKey = process.env.DOKU_SECRET_KEY;

    if (!clientId || !secretKey) {
      return res.status(500).json({ error: 'Konfigurasi payment belum lengkap.' });
    }

    // Buat invoice number unik
    const invoiceNumber = `HF-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const path = '/checkout/v1/payment';

    // Expired 15 menit dari sekarang
    const expiredAt = new Date(Date.now() + 15 * 60 * 1000);
    const expiredAtStr = expiredAt.toISOString().replace(/\.\d{3}Z$/, 'Z');

    const successUrl = `${process.env.FRONTEND_URL || 'https://harkatfess.vercel.app'}?payment=success&inv=${invoiceNumber}`;
    const failedUrl = `${process.env.FRONTEND_URL || 'https://harkatfess.vercel.app'}?payment=failed`;

    const body = {
      order: {
        invoice_number: invoiceNumber,
        line_items: [
          {
            name: 'Kirim Menfes Harkatfess',
            price: HARGA_MENFES,
            quantity: 1,
          },
        ],
        amount: HARGA_MENFES,
        currency: 'IDR',
        callback_url: `${process.env.BACKEND_URL || 'https://menfs.onrender.com'}/api/payment/notification`,
        auto_redirect: false,
      },
      payment: {
        payment_due_date: 15,
      },
      customer: {
        id: ipHash,
        name: 'Pengirim Anonim',
        email: `${ipHash}@harkatfess.app`,
      },
      additional_info: {
        success_url: successUrl,
        failed_url: failedUrl,
      },
    };

    const { signature, digest } = buatSignature(clientId, secretKey, requestId, timestamp, path, body);

    const response = await fetch(`${DOKU_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': clientId,
        'Request-Id': requestId,
        'Request-Timestamp': timestamp,
        'Signature': `HMACSHA256=${signature}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json();

    if (!response.ok || !data.response?.payment?.url) {
      console.error('DOKU error status:', response.status);
      console.error('DOKU error body:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gagal membuat halaman pembayaran.' });
    }

    const checkoutUrl = data.response.payment.url;

    // Simpan ke database
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
 * Cek status payment tertentu (dipoll frontend setelah redirect balik)
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
