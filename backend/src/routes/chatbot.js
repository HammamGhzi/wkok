const express = require('express');
const { cariJawaban } = require('../lib/chatbot');

const router = express.Router();

/**
 * POST /api/chatbot
 * Body: { pertanyaan: string }
 * Response: { jawaban: string }
 */
router.post('/', async (req, res) => {
  const { pertanyaan } = req.body || {};

  if (!pertanyaan || typeof pertanyaan !== 'string') {
    return res.status(400).json({ error: 'Field pertanyaan wajib diisi.' });
  }

  const trimmed = pertanyaan.trim();
  if (trimmed.length === 0) {
    return res.status(400).json({ error: 'Pertanyaan tidak boleh kosong.' });
  }
  if (trimmed.length > 300) {
    return res.status(400).json({ error: 'Pertanyaan maksimal 300 karakter.' });
  }

  try {
    const { jawaban } = await cariJawaban(trimmed);
    res.json({ jawaban });
  } catch (err) {
    console.error('Chatbot error:', err.message);
    res.status(500).json({ error: 'Gagal memproses pertanyaan.' });
  }
});

module.exports = router;
