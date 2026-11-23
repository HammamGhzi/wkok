/**
 * Uji pesan tombol "Post ke IG" yang dikirim dari Export WA.
 *
 * Yang harus benar:
 *  1. native flow interactiveMessage tidak dirender di grup WA — pesannya
 *     ikut hilang beserta link di body-nya. Pakai templateMessage dengan
 *     quickReplyButton yang tampil di grup.
 *  2. Link cadangan ikut di content pesan yang sama dengan tombol, bukan
 *     pesan terpisah — admin minta satu chat, satu gelembung.
 *  3. Kirim dua kali ke menfes yang sama tetap menghasilkan token berbeda.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const waBot = require('./src/services/waBot');

function sockPalsu() {
  const relay = [];
  const terkirim = [];
  return {
    relay,
    terkirim,
    user: { id: '120363000000000001@s.whatsapp.net' },
    async relayMessage(jid, message, opts) {
      relay.push({ jid, message, opts });
      return { key: { id: opts.messageId } };
    },
    async sendMessage(...args) {
      terkirim.push(args);
      return { key: { id: 'plain' } };
    },
  };
}

test('tombol Post ke IG dirakit sebagai templateMessage dan link ikut di pesan yang sama', async () => {
  const sock = sockPalsu();
  const args = {
    menfesId: 'cm-uji-1',
    postIgToken: 'token-pendek',
    postIgUrl: 'https://harkatnekatt.onrender.com/api/wa/post-ig/token-pendek',
  };

  await waBot.kirimTombolPostIg(sock, '120363000000000002@g.us', args);

  assert.equal(sock.terkirim.length, 0, 'link tidak boleh jadi pesan sendMessage terpisah');
  assert.equal(sock.relay.length, 1, 'tombol harus dikirim sekali lewat relayMessage');
  const { jid, message, opts } = sock.relay[0];
  assert.equal(jid, '120363000000000002@g.us');
  assert.ok(opts.messageId, 'relay butuh messageId');

  const templat = message.templateMessage?.hydratedFourRowTemplate;
  assert.ok(templat, 'payload harus templateMessage.hydratedFourRowTemplate');
  assert.match(templat.hydratedContentText, /post-ig\/token-pendek/, 'link cadangan ada di content');
  const tombol = templat.hydratedButtons?.[0]?.quickReplyButton;
  assert.equal(tombol?.displayText, 'Post ke IG');
  assert.equal(tombol?.id, 'igpub:token-pendek');
});

test('token panjang tidak mengirim tombol dan pakai satu pesan teks', async () => {
  const sock = sockPalsu();
  const tokenPanjang = 'x'.repeat(300);

  await waBot.kirimTombolPostIg(sock, '120363000000000002@g.us', {
    menfesId: 'cm-uji-2',
    postIgToken: tokenPanjang,
    postIgUrl: `https://harkatnekatt.onrender.com/api/wa/post-ig/${tokenPanjang}`,
  });

  assert.equal(sock.relay.length, 0);
  assert.equal(sock.terkirim.length, 1, 'tetap kirim link sebagai satu pesan teks');
  assert.match(sock.terkirim[0][1].text, /post-ig\/xxx/);
});
