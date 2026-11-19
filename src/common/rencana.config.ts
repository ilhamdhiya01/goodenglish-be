// Every threshold of the daily plan ("Rencana") the backend needs, in one
// place. The frontend has its own copy for the rules it evaluates:
// goodenglish-fe const/rencana.config.ts.

export const RENCANA = {
  /** Main peran: learner turns of a full session and a short practice. */
  roleplayFullTurns: 12,
  roleplayShortTurns: 6,
  /** Activity reports: per request, oldest day accepted, longest read. */
  reportBatchMax: 100,
  reportMaxAgeDays: 60,
  reportFetchMaxDays: 120,
  /** Size of a report's free-form `data` (JSON text). */
  reportDataMaxChars: 2000,
  /** "Pakai": sentences checked in one AI call (one quota unit). */
  checkSentencesMax: 3,
  checkSentenceMaxChars: 300,
  /** Week numbers a level can have. */
  maxWeek: 52,
  /** Grammar topics a week can practise (Panduan grammar + Bertanya "r"). */
  grammarTopics: [
    'whb',
    'irr',
    'prep',
    'bedo',
    'tense',
    'thit',
    'conj',
    'r',
  ] as const,
} as const;

export type GrammarTopic = (typeof RENCANA.grammarTopics)[number];
