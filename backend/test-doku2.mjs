import { createHash, createHmac, randomUUID } from 'crypto';
import { config } from 'dotenv';
config();

const clientId = process.env.DOKU_CLIENT_ID;
const secretKey = process.env.DOKU_SECRET_KEY;

// Debug: tampilkan karakter per karakter untuk cek hidden chars
console.log('clientId bytes:', Buffer.from(clientId).toString('hex'));
console.log('secretKey bytes:', Buffer.from(secretKey).toString('hex'));
console.log('clientId length:', clientId.length);
console.log('secretKey length:', secretKey.length);

const requestId = randomUUID();
const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const path = '/checkout/v1/payment';

const body = {
  order: {
    amount: 1000,
    invoice_number: 'INV-' + Date.now(),
  },
  payment: {
    payment_due_date: 60,
  },
};

const bodyStr = JSON.stringify(body);
console.log('\nbodyStr:', bodyStr);

const digest = createHash('sha256').update(bodyStr).digest('base64');
console.log('digest:', digest);

// Component to sign persis seperti dokumentasi
const component = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${timestamp}\nRequest-Target:${path}\nDigest:${digest}`;
console.log('\nComponent to sign:');
console.log(component);

const signature = 'HMACSHA256=' + createHmac('sha256', secretKey).update(component).digest('base64');
console.log('\nSignature:', signature);

const res = await fetch('https://api.doku.com' + path, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Client-Id': clientId,
    'Request-Id': requestId,
    'Request-Timestamp': timestamp,
    'Signature': signature,
  },
  body: bodyStr,
});

const data = await res.json();
console.log('\nStatus:', res.status);
console.log('Response:', JSON.stringify(data, null, 2));
