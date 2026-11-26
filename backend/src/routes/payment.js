const express = require('express');
const { cekStatusBayar, buatPayment, notifikasiPayment, statusPayment } = require('../controllers/paymentController');

const router = express.Router();

// GET /api/payment/check — cek apakah IP perlu bayar
router.get('/check', cekStatusBayar);

// POST /api/payment/create — buat invoice DOKU
router.post('/create', buatPayment);

// POST /api/payment/notification — webhook dari DOKU
router.post('/notification', notifikasiPayment);

// GET /api/payment/status/:invoiceNumber — cek status payment
router.get('/status/:invoiceNumber', statusPayment);

module.exports = router;
