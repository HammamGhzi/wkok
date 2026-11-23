import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMenfessToCanvas } from './drawMenfessCanvas.js';

test('renderMenfessToCanvas menunggu gambar latar selesai sebelum resolve', async () => {
  let gambar;
  globalThis.Image = class {
    constructor() {
      gambar = this;
      this.width = 200;
      this.height = 250;
    }
    set src(value) { this._src = value; }
    get src() { return this._src; }
  };
  globalThis.document = { fonts: { ready: Promise.resolve() } };

  const gambarDari = [];
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    drawImage() { gambarDari.push('latar'); },
    fillText() {},
    measureText(text) { return { width: String(text).length * 8 }; },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const template = {
    id: 'uji',
    name: 'uji',
    src: '/template/fess-lite.png',
    fallbackSrc: null,
    defaultRatio: '4:5',
    defaultFontSize: 36,
    fontFamily: 'sans-serif',
    textColor: '#000',
    lineHeightMultiplier: 1.5,
    bounds: { '4:5': { w: 0.8, padX: 0.06 } },
    defaultMessage: { posX: 50, posY: 50, rotate: 0 },
  };

  const hasil = renderMenfessToCanvas(canvas, { template, message: 'halo' });

  let selesai = false;
  Promise.resolve(hasil).then(() => { selesai = true; });
  await new Promise((r) => setTimeout(r, 5));

  assert.equal(selesai, false, 'render tidak boleh resolve sebelum img.onload');
  assert.equal(gambarDari.length, 0, 'latar belum boleh digambar sebelum gambar siap');

  await gambar.onload();
  await hasil;

  assert.deepEqual(gambarDari, ['latar'], 'latar digambar sebelum render selesai');
});
