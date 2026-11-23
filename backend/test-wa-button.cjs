/**
 * Uji pesan tombol "Post ke IG" yang dikirim dari Export WA.
 *
 * Dua hal yang harus benar:
 *  1. Tombol native flow tidak bisa dikirim lewat sendMessage(). Baileys
 *     mengira itu media dan melempar "Invalid media type". Pesan harus
 *     dirakit dengan generateWAMessageFromContent lalu relayMessage().
 *  2. Link cadangan harus ikut di body pesan yang sama dengan tombol, bukan
 *     pesan terpisah — admin minta satu chat, satu gelembung.
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

test('tombol Post ke IG dirakit sebagai interactiveMessage dan link ikut di body yang sama', async () => {
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

  const interaktif = message.interactiveMessage;
  assert.ok(interaktif, 'payload harus interactiveMessage');
  assert.match(interaktif.body.text, /post-ig\/token-pendek/, 'link cadangan ada di body');
  const tombol = interaktif.nativeFlowMessage?.buttons?.[0];
  assert.equal(tombol?.name, 'quick_reply');
  assert.deepEqual(JSON.parse(tombol.buttonParamsJson), {
    display_text: 'Post ke IG',
    id: 'igpub:token-pendek',
  });
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
