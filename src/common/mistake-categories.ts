// "Buku kesalahanku" categories: one fixed list shared with the frontend
// (goodenglish-fe const/mistake-categories.constant.ts — keep the ids in
// sync). Most are Cheat sheet section ids; the id is what's stored, the
// title is what the model reads.
export const MISTAKE_CATEGORIES = {
  // Described by what the Cheat sheet section actually covers: the -s for
  // he/she/it lives in "Kapan pakai tense apa", so it's a tense mistake.
  'aturan-dasar':
    'Lima aturan dasar (kata kerja atau be wajib ada, bentuk kata kerja setelah be / kata bantu)',
  'am-is-are': 'am / is / are (lupa kata be)',
  tense: 'Tense (kapan pakai tense apa, termasuk -s untuk he/she/it)',
  'sudah-belum': 'Sudah, belum, pernah (present perfect)',
  pasif: 'Kalimat pasif (di-)',
  pertanyaan: 'Membuat pertanyaan & kalimat negatif',
  'a-an-the': 'a / an / the',
  jamak: 'Jamak & kata benda tak terhitung',
  'to-atau-ing': 'to + V1 atau V-ing',
  preposisi: 'Preposisi tempat, waktu & kendaraan',
  'preposisi-lain': 'Preposisi setelah kata kerja / kata sifat',
  'kata-tertukar': 'Kata yang sering tertukar',
  waktu: 'Waktu & frekuensi',
  'urutan-kata': 'Urutan kata',
  terjemahan: 'Terjemahan langsung dari bahasa Indonesia',
  kolokasi: 'Kolokasi, register & nada',
  menyimak: 'Menyimak (salah dengar)',
  kesalahan: 'Lainnya',
} as const;

export type MistakeCategory = keyof typeof MISTAKE_CATEGORIES;
export const MISTAKE_CATEGORY_IDS = Object.keys(
  MISTAKE_CATEGORIES,
) as MistakeCategory[];
/** Used when the model returns something outside the list. */
export const FALLBACK_MISTAKE_CATEGORY: MistakeCategory = 'kesalahan';

/** Categories the AI may choose from (Menyimak is for dictation only). */
export const AI_MISTAKE_CATEGORIES = MISTAKE_CATEGORY_IDS.filter(
  (id) => id !== 'menyimak',
);

export const categoryOrFallback = (v: unknown): MistakeCategory =>
  typeof v === 'string' &&
  (AI_MISTAKE_CATEGORIES as string[]).includes(v.trim())
    ? (v.trim() as MistakeCategory)
    : FALLBACK_MISTAKE_CATEGORY;
