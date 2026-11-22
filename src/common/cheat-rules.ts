// One id per rule of the Cheat sheet (goodenglish-fe const/cheatsheet.constant.ts,
// rule blocks' `id` — keep the two lists in sync). The AI picks one when it
// records a mistake, so "Lihat aturannya" in Ulang can show exactly that
// rule instead of a whole section. The id is "<section>/<slug>"; the title
// is what the model reads.
export const CHEAT_RULES = {
  'aturan-dasar/be-tanpa-kata-kerja':
    'Tidak ada kata kerja → wajib pakai be (am/is/are/was/were)',
  'aturan-dasar/jangan-be-dobel': 'Ada kata kerja → jangan tambah be',
  'aturan-dasar/setelah-be':
    'Setelah be, kata kerja hanya boleh V-ing (sedang) atau V3 (di-)',
  'aturan-dasar/setelah-kata-bantu':
    'Setelah do/does/did, can/will/should/must, dan to → selalu V1',
  'aturan-dasar/v2-sendiri':
    'V2 selalu berdiri sendiri, tanpa kata bantu dan tanpa -s',
  'am-is-are/benda-jamak-they':
    'Benda jamak → they / them, bukan cuma untuk orang',
  'tense/he-she-it-s':
    'Kebiasaan atau fakta dengan he / she / it → V1 + -s / -es',
  'tense/being-sifat':
    'be + being + kata sifat → sikap sementara, bukan sifat tetap',
  'tense/i-wish': 'I wish + were / V2 / could → andai (tidak nyata)',
  'sudah-belum/have-v3':
    'Tanya sudah / belum / pernah → Have/Has + subjek + V3?',
  'sudah-belum/yet':
    'yet → belum. Di pertanyaan dan kalimat negatif, di akhir kalimat',
  'sudah-belum/already': 'already → sudah. Di kalimat positif',
  'pasif/be-ikut-waktu': 'Pasif: be ikut waktu, V3 tetap',
  'pasif/aktif-atau-pasif':
    'Pelaku jelas → kalimat aktif. Pelaku tidak penting atau tidak diketahui → pasif',
  'pertanyaan/preposisi-di-akhir': 'Preposisi di pertanyaan → pindah ke akhir',
  'pertanyaan/hari-jam-tanggal':
    'Tanya hari / jam / tanggal → What day / time / date is it?',
  'a-an-the/satu-negatif': 'Satu kalimat → satu negatif saja',
  'preposisi-lain/bahasa-in': 'Bahasa → in (in English)',
  'preposisi-lain/good-at': 'Jago melakukan sesuatu → good at (+ V-ing)',
  'preposisi-lain/keadaan-in': 'Sedang berada dalam suatu keadaan → in',
  'preposisi-lain/sifat-preposisi': 'Kata sifat + preposisi → hafalkan sepaket',
  'kata-tertukar/like-looks-like':
    'like → suka. looks like / sounds like → seperti',
  'kata-tertukar/look-at':
    'Ada bendanya → look at. Tidak ada benda → look saja',
  'kata-tertukar/see-hear-ing':
    'Melihat kejadian → see / hear + objek + V-ing (tanpa is/was)',
  'kata-tertukar/matter':
    'matter → penting (kata kerja) atau masalah (kata benda)',
  'kata-tertukar/must-be':
    'must be → pasti (menebak dengan yakin), bukan harus',
  'waktu/anymore': 'anymore → sudah tidak lagi. Di akhir kalimat dan butuh not',
  'urutan-kata/s-kata-kerja-utama':
    '-s menempel ke kata kerja utama, bukan ke never / always / usually',
  'urutan-kata/something-sifat':
    'something / anything / nothing + kata sifat → kata sifat di belakang',
} as const;

export type CheatRuleId = keyof typeof CHEAT_RULES;
export const CHEAT_RULE_IDS = Object.keys(CHEAT_RULES) as CheatRuleId[];

/** What the model answers when no single rule fits. */
export const NO_RULE = 'none';

/** For prompts: one "id (title)" per line. */
export const cheatRuleList = (): string =>
  CHEAT_RULE_IDS.map((id) => `  ${id} (${CHEAT_RULES[id]})`).join('\n');

/** A known rule id, or undefined (also for "none" and anything else). */
export const ruleOrNone = (v: unknown): CheatRuleId | undefined =>
  typeof v === 'string' && (CHEAT_RULE_IDS as string[]).includes(v.trim())
    ? (v.trim() as CheatRuleId)
    : undefined;
