// Uji pemisahan origin: FAQ chatbot dan backend utama boleh beda server.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ruteApi } from './origin.js';

test('chatbot dan backend utama bisa ke origin berbeda', () => {
  const rute = ruteApi({
    apiUrl: 'https://harkatnekatt.onrender.com/',
    chatbotUrl: 'https://menfs.onrender.com',
  });

  assert.equal(rute.BASE_URL, 'https://harkatnekatt.onrender.com/api');
  assert.equal(rute.CHATBOT_BASE_URL, 'https://menfs.onrender.com/api');
});

test('tanpa origin chatbot, chatbot ikut backend utama', () => {
  const rute = ruteApi({ apiUrl: 'http://localhost:3001', chatbotUrl: '' });

  assert.equal(rute.BASE_URL, 'http://localhost:3001/api');
  assert.equal(rute.CHATBOT_BASE_URL, 'http://localhost:3001/api');
});
