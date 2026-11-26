import { createHash, createHmac, createSign, randomUUID } from 'crypto';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
config();

const clientId = process.env.DOKU_CLIENT_ID;
const secretKey = process.env.DOKU_SECRET_KEY;
const privateKey = readFileSync('./doku-private.pem', 'utf8');

// SNAP Asymmetric: get access token dulu
const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// Step 1: Get B2B Access Token
// String to sign: clientId + '|' + timestamp
const stringToSign = clientId + '|' + timestamp;
const signer = createSign('SHA256');
signer.update(stringToSign);
const asymmetricSignature = signer.sign(privateKey, 'base64');

console.log('Getting B2B token...');
const tokenRes = await fetch('https://api.doku.com/authorization/v1/access-token/b2b', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CLIENT-KEY': clientId,
    'X-TIMESTAMP': timestamp,
    'X-SIGNATURE': asymmetricSignature,
  },
  body: JSON.stringify({ grantType: 'client_credentials' }),
});

const tokenData = await tokenRes.json();
console.log('Token response status:', tokenRes.status);

if (tokenRes.status !== 200) {
  console.log('Token error:', JSON.stringify(tokenData, null, 2));
  process.exit(1);
}

const accessToken = tokenData.accessToken;
console.log('Got access token!');

// Step 2: Buat payment dengan Symmetric signature
const paymentPath = '/checkout/v1/payment';
const requestId = randomUUID();
const paymentTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const body = {
  partnerReferenceNo: 'INV-TEST-' + Date.now(),
  amount: { value: '1000.00', currency: 'IDR' },
  urlParam: [
    { url: 'https://menfs.onrender.com/api/payment/notification', type: 'PAY_NOTIFY', isDeeplink: 'N' },
    { url: 'https://harkatfess.vercel.app?payment=success', type: 'PAY_RETURN', isDeeplink: 'N' },
  ],
  paymentType: 'CHECKOUT',
  additionalInfo: { paymentDueDate: '2026-11-26T10:00:00+07:00' },
};
const bodyStr = JSON.stringify(body);

// SNAP Symmetric signature
const bodyHash = createHash('sha256').update(bodyStr).digest('hex').toLowerCase();
const symStringToSign = `POST:${paymentPath}:${accessToken}:${bodyHash}:${paymentTimestamp}`;
const symSignature = createHmac('sha256', secretKey).update(symStringToSign).digest('base64');

const digest = createHash('sha256').update(bodyStr).digest('base64');
const nonSnapSig = `HMACSHA256=${createHmac('sha256', secretKey).update(`Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${paymentTimestamp}\nRequest-Target:${paymentPath}\nDigest:${digest}`).digest('base64')}`;

console.log('Creating payment...');
const payRes = await fetch('https://api.doku.com' + paymentPath, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'X-TIMESTAMP': paymentTimestamp,
    'X-SIGNATURE': symSignature,
    'X-PARTNER-ID': clientId,
    'X-EXTERNAL-ID': requestId,
    'Client-Id': clientId,
    'Request-Id': requestId,
    'Request-Timestamp': paymentTimestamp,
    'Signature': nonSnapSig,
    'CHANNEL-ID': 'PC',
  },
  body: bodyStr,
});

const payData = await payRes.json();
console.log('Payment response status:', payRes.status);
console.log('Payment response:', JSON.stringify(payData, null, 2));
