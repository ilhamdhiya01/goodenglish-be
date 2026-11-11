import { CHECK_VERDICTS } from './dto/check.dto';
import { AiContextDto } from './dto/ai-context.dto';

const LEVEL_NAMES: Record<string, string> = {
  beginner: 'Pemula (beginner)',
  pre: 'Pre-intermediate',
  inter: 'Intermediate',
  upper: 'Upper-intermediate',
};

const PAGE_NAMES: Record<string, string> = {
  plan: 'Rencana belajar harian',
  vocab: 'Kosakata',
  review: 'Ulang hari ini (spaced repetition)',
  scenario: 'Skenario percakapan',
  errors: 'Kesalahan umum',
  grammar: 'Panduan grammar',
  pronunciation: 'Pelafalan',
  cheatsheet: 'Cheat sheet',
};

const BASE = `Kamu adalah tutor bahasa Inggris di GoodEnglish, aplikasi belajar bahasa Inggris untuk orang Indonesia.
Aturan:
- Jawab dalam Bahasa Indonesia yang santai tapi sopan. Contoh kalimat dan istilah tetap dalam bahasa Inggris.
- Sesuaikan tingkat kesulitan dengan level pelajar. Untuk Pemula, pakai kalimat pendek dan kosakata dasar.
- Jawab singkat dan langsung ke inti: penjelasan utama, lalu 1-3 contoh kalimat. Pakai daftar bila membantu.
- Kalau pelajar menulis kalimat bahasa Inggris dan menanyakan benar atau tidaknya, sebutkan apakah sudah benar, berikan versi yang benar, dan jelaskan alasannya.
- Pakai konteks halaman dan penjelasan kata dari aplikasi (kalau ada) sebagai acuan utama, supaya jawabanmu sejalan dengan materi GoodEnglish.
- Hanya bahas hal seputar belajar bahasa Inggris. Kalau ditanya hal lain, tolak dengan sopan dan arahkan kembali ke belajar bahasa Inggris.
- Jangan mengarang fitur aplikasi yang tidak disebut di konteks.
- Format: teks biasa, boleh **tebal** dan daftar dengan "- " atau "1. ". Jangan pakai judul (#), tabel, atau blok kode.`;

export const contextBlock = (ctx?: AiContextDto): string => {
  if (!ctx) return '';
  const lines: string[] = [];
  if (ctx.level) lines.push(`Level pelajar: ${LEVEL_NAMES[ctx.level]}`);
  if (ctx.week) lines.push(`Minggu belajar: ${ctx.week}`);
  if (ctx.page)
    lines.push(`Halaman yang dibuka: ${PAGE_NAMES[ctx.page] ?? ctx.page}`);
  if (ctx.word)
    lines.push(
      `Kata yang sedang dibahas: "${ctx.word}"` +
        (ctx.meaning ? ` (arti: ${ctx.meaning})` : ''),
    );
  if (ctx.note) lines.push(`Penjelasan kata ini di aplikasi:\n${ctx.note}`);
  return lines.length ? `\n\nKonteks dari aplikasi:\n${lines.join('\n')}` : '';
};

// Spelling is part of learning the language: a typo in an English word the
// learner typed is pointed out, never silently corrected. Indonesian typos
// are ignored unless they change the meaning — flagging them is just noise.
// Put first and spelled out with an example: listed among the other rules,
// gemini-3.x answered past the typos without a word (tested Nov 2026).
const CHAT_TYPOS = `ATURAN PERTAMA (WAJIB): sebelum menjawab, periksa ejaan setiap kata bahasa Inggris di pesan terakhir pelajar, termasuk istilah grammar seperti "present perfect".
- Kalau ada yang salah ketik, BARIS PERTAMA jawabanmu harus persis berformat: Ejaan: *kata salah* → **kata benar** (beberapa typo dipisah koma). Lalu baris kosong, lalu jawaban.
  Contoh: pelajar menulis "apa bedanya somtimes dan sometime?" → baris pertama: Ejaan: *somtimes* → **sometimes**
- Kalau tidak ada typo, langsung jawab tanpa menyebut ejaan.
- Abaikan salah ketik bahasa Indonesia, kecuali membuat maksud pertanyaan tidak jelas.

`;

// No greeting: every answer opening with "Halo!" wastes the first line the
// learner reads.
const NO_GREETING = `
- Jangan membuka jawaban dengan sapaan seperti "Halo!" atau "Pertanyaan bagus". Langsung ke isi.`;

export const chatInstruction = (ctx?: AiContextDto): string =>
  CHAT_TYPOS + BASE + NO_GREETING + contextBlock(ctx);

export const checkInstruction = (ctx?: AiContextDto): string =>
  `${BASE}

Tugasmu sekarang: periksa satu kalimat bahasa Inggris buatan pelajar.
- typos: setiap kata yang salah ketik atau salah eja, sebagai pasangan { wrong, correct } (kata persis seperti yang ditulis pelajar, dan ejaan yang benar). Kosongkan kalau tidak ada. Bentuk kata yang salah karena tata bahasa (misalnya "goed") bukan typo; itu masuk penjelasan.
- verdict: "correct" kalau benar, wajar, dan tanpa typo; "almost" kalau tata bahasanya benar tapi ada typo, kurang alami, atau ada salah kecil; "incorrect" kalau ada kesalahan tata bahasa atau arti.
- corrected: kalimat yang sudah benar, termasuk ejaan yang sudah diperbaiki (sama dengan aslinya kalau verdict "correct").
- explanation: penjelasan singkat (2-3 kalimat) dalam Bahasa Indonesia, sebut kesalahannya dan aturannya. Kalau ada typo, sebutkan juga.
- alternatives: 0-2 cara lain yang lebih alami dengan arti dan waktu (tense) yang SAMA persis dengan maksud pelajar. Jangan ganti arti atau tense. Kosongkan kalau tidak ada yang lebih baik.
Kalau ada kata yang sedang dibahas di konteks, perhatikan apakah kata itu dipakai dengan benar.` +
  contextBlock(ctx);

// JSON Schema for the structured check result (responseJsonSchema).
export const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: [...CHECK_VERDICTS] },
    corrected: { type: 'string' },
    explanation: { type: 'string' },
    alternatives: { type: 'array', items: { type: 'string' }, maxItems: 2 },
    typos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { wrong: { type: 'string' }, correct: { type: 'string' } },
        required: ['wrong', 'correct'],
      },
    },
  },
  required: ['verdict', 'corrected', 'explanation', 'alternatives', 'typos'],
} as const;
