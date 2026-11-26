import { createHash, createHmac, createSign, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { config } from 'dotenv';
config();

const clientId = process.env.DOKU_CLIENT_ID;
const secretKey = process.env.DOKU_SECRET_KEY;
const privateKey = readFileSync('./doku-private.pem', 'utf8');

// Step 1: Get B2B Access Token (Asymmetric RSA)
const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const stringToSign = clientId + '|' + timestamp;
const signer = createSign('SHA256');
signer.update(stringToSign);
const asymSig = signer.sign(privateKey, 'base64');

const tokenRes = await fetch('https://api.doku.com/authorization/v1/access-token/b2b', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CLIENT-KEY': clientId,
    'X-TIMESTAMP': timestamp,
    'X-SIGNATURE': asymSig,
  },
  body: JSON.stringify({ grantType: 'client_credentials' }),
});
const tokenData = await tokenRes.json();
if (tokenRes.status !== 200) { console.error('Token error:', tokenData); process.exit(1); }
const accessToken = tokenData.accessToken;
console.log('Token OK');

// Step 2: Buat Checkout Payment (SNAP Symmetric HMAC-SHA512)
const paymentPath = '/checkout/v1/payment';
const requestId = randomUUID();
const payTs = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const body = {
  order: {
    amount: 1000,
    invoice_number: 'INV-' + Date.now(),
    callback_url: 'https://menfs.onrender.com/api/payment/notification',
  },
  payment: { payment_due_date: 60 },
};
const bodyStr = JSON.stringify(body);

// SNAP Symmetric: METHOD:PATH:AccessToken:lowercase(hex(sha256(minify(body)))):TIMESTAMP
const bodyHash = createHash('sha256').update(bodyStr).digest('hex').toLowerCase();
const strToSign = `POST:${paymentPath}:${accessToken}:${bodyHash}:${payTs}`;
const symSig = createHmac('sha512', secretKey).update(strToSign).digest('base64');

console.log('strToSign:', strToSign.substring(0, 80) + '...');

// Non-SNAP signature juga (checkout endpoint hybrid)
const digest = createHash('sha256').update(bodyStr).digest('base64');
const nonSnapComponent = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${payTs}\nRequest-Target:${paymentPath}\nDigest:${digest}`;
const nonSnapSig = 'HMACSHA256=' + createHmac('sha256', secretKey).update(nonSnapComponent).digest('base64');

const payRes = await fetch('https://api.doku.com' + paymentPath, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'X-TIMESTAMP': payTs,
    'X-SIGNATURE': symSig,
    'X-PARTNER-ID': clientId,
    'X-EXTERNAL-ID': requestId,
    'Client-Id': clientId,
    'Request-Id': requestId,
    'Request-Timestamp': payTs,
    'Signature': nonSnapSig,
    'CHANNEL-ID': 'PC',
  },
  body: bodyStr,
});

const payData = await payRes.json();
console.log('Payment status:', payRes.status);
console.log('Payment response:', JSON.stringify(payData, null, 2));
