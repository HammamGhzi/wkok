// Origin dipisah supaya FAQ chatbot (butuh kunci AI) bisa beda server dari
// backend yang memegang sesi WhatsApp. Slash akhir dibuang dulu: Vercel
// sering mengisi VITE_API_URL dengan "https://host/", yang kalau ditempel
// menghasilkan "//api" dan ditolak backend.
function bersihkan(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

export function ruteApi({ apiUrl, chatbotUrl }) {
  const utama = bersihkan(apiUrl);
  // Kosong = dev, chatbot ikut proxy /api seperti endpoint lain.
  const bot = bersihkan(chatbotUrl) || utama;
  const base = (origin) => (origin ? `${origin}/api` : '/api');

  return { BASE_URL: base(utama), CHATBOT_BASE_URL: base(bot) };
}
