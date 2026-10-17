// Uji logika murni pemecahan baris jadi kartu. Jalankan: npm test (di folder frontend).
//
// Yang diuji hanya pemotongan array, bukan tampilan kartu. Tampilan diverifikasi
// terpisah di peramban sungguhan.
import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkLines } from './splitLines.js';

test('chunkLines memecah baris sesuai batas per kartu', () => {
  assert.deepStrictEqual(chunkLines(['a', 'b', 'c', 'd', 'e'], 2), [
    ['a', 'b'],
    ['c', 'd'],
    ['e'],
  ]);
});

test('chunkLines tepat di batas tetap satu kartu', () => {
  assert.deepStrictEqual(chunkLines(['a', 'b', 'c'], 3), [['a', 'b', 'c']]);
});

test('chunkLines input kosong jadi satu kartu placeholder', () => {
  assert.deepStrictEqual(chunkLines([], 5), [[]]);
});

test('chunkLines baris lebih sedikit dari batas', () => {
  assert.deepStrictEqual(chunkLines(['a'], 5), [['a']]);
});
