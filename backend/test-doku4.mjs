import { createHash, createHmac, randomUUID } from 'crypto';
import { config } from 'dotenv';
config();

const clientId = process.env.DOKU_CLIENT_ID;
const secretKey = process.env.DOKU_SECRET_KEY;

const requestId = randomUUID();
const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const path = '/checkout/v1/payment';

// Body persis seperti dokumentasi basic request
const body = {
  order: {
    amount: 1000,
    invoice_number: 'INV-' + Date.now(),
  },
  payment: {
    payment_due_date: 60,
  },
};

// Stringify TANPA spasi (minified)
const bodyStr = JSON.stringify(body);
console.log('Body:', bodyStr);

// Digest: SHA256 base64 dari body
const digest = createHash('sha256').update(bodyStr, 'utf8').digest('base64');
console.log('Digest:', digest);

// Component to sign: persis format dokumentasi
const component = [
  `Client-Id:${clientId}`,
  `Request-Id:${requestId}`,
  `Request-Timestamp:${timestamp}`,
  `Request-Target:${path}`,
  `Digest:${digest}`,
].join('\n');

console.log('Component:\n' + component);

// Signature: HMAC-SHA256 base64
const rawSig = createHmac('sha256', secretKey).update(component, 'utf8').digest('base64');
const signature = 'HMACSHA256=' + rawSig;
console.log('Signature:', signature);

// Hit API
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
