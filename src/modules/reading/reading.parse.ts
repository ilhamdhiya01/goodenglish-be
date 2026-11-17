import { MIN_TARGET_WORDS, SLOT_WORDS, type SlotWire } from './reading.prompts';

export interface ReadingParagraph {
  en: string;
  id: string;
}
export interface GlossaryEntry {
  word: string;
  meaningId: string;
}
export type ReadingQuestion =
  | {
      type: 'mcq';
      question: string;
      options: string[];
      answerIndex: number;
      explanationId: string;
    }
  | {
      type: 'true_false';
      statement: string;
      answer: boolean;
      explanationId: string;
    }
  | { type: 'find_word'; promptId: string; answer: string };

/** Content rules a text misses; saved with the draft and shown to admins. */
export type ReadingWarning =
  | { code: 'word_count'; count: number; min: number; max: number }
  | { code: 'few_target_words'; found: number; min: number }
  | { code: 'targets_not_in_text'; words: string[] }
  | { code: 'find_word_not_in_text'; word: string };

export interface ReadingContent {
  title: string;
  paragraphs: ReadingParagraph[];
  targetWordsUsed: string[];
  glossary: GlossaryEntry[];
  questions: ReadingQuestion[];
  wordCount: number;
}

/** Broken shape (not just a missed target): the API refuses it. */
export class ReadingContentError extends Error {
  constructor(
    readonly code:
      'reading_bad_title' | 'reading_bad_paragraphs' | 'reading_bad_questions',
  ) {
    super(code);
  }
}

type Obj = Record<string, unknown>;
const str = (v: unknown) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};

export const countWords = (texts: string[]) =>
  texts.reduce(
    (n, t) => n + (t.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) ?? []).length,
    0,
  );

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Regular inflections of one word: books, studies, stopped, making …
const forms = (w: string): string[] => {
  const out = new Set([w, `${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`]);
  if (/[^aeiou]y$/.test(w)) {
    out.add(`${w.slice(0, -1)}ies`);
    out.add(`${w.slice(0, -1)}ied`);
  }
  if (w.endsWith('e')) out.add(`${w.slice(0, -1)}ing`);
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w)) {
    out.add(`${w}${w.at(-1)}ed`);
    out.add(`${w}${w.at(-1)}ing`);
  }
  return [...out];
};

/**
 * Whether a vocabulary entry (a word or a phrase like "wake up", "sb/sth"
 * and "…" ignored) appears in the text, allowing regular inflections of
 * its first word. Irregular forms (went) only match when listed.
 */
export const appearsIn = (text: string, entry: string): boolean => {
  const words = entry
    .toLowerCase()
    .replace(
      /\([^)]*\)|…|\.\.\.|\bsb\b|\bsth\b|\bsomeone\b|\bsomething\b/g,
      ' ',
    )
    .replace(/[^a-z'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return false;
  const [first, ...rest] = words;
  const head = `(?:${forms(first).map(esc).join('|')})`;
  // Allow up to two words in between the parts of a phrase ("pick it up").
  const tail = rest.map((w) => `(?:\\s+\\S+){0,2}?\\s+${esc(w)}`).join('');
  return new RegExp(`\\b${head}${tail}\\b`, 'i').test(text);
};

/**
 * Validates a text (from Gemini or an admin edit). Broken shape throws;
 * missed targets (length, ≥ 8 week words, find_word answer) become warnings.
 */
export const validateText = (
  raw: {
    title?: unknown;
    paragraphs?: unknown;
    target_words_used?: unknown;
    targetWordsUsed?: unknown;
    glossary?: unknown;
    questions?: unknown;
    // Gemini's shape: one field per question type.
    mcq?: unknown;
    true_false?: unknown;
    find_word?: unknown;
  },
  slot: SlotWire,
  weekWords: string[],
): { content: ReadingContent; warnings: ReadingWarning[] } => {
  const title = str(raw.title).slice(0, 160);
  if (!title) throw new ReadingContentError('reading_bad_title');

  const paragraphs = list(raw.paragraphs)
    .map(obj)
    .map((p) => ({
      en: str(p.en).slice(0, 3000),
      id: str(p.id).slice(0, 3000),
    }))
    .filter((p) => p.en);
  if (
    !paragraphs.length ||
    paragraphs.length > 10 ||
    paragraphs.some((p) => !p.id)
  ) {
    throw new ReadingContentError('reading_bad_paragraphs');
  }
  const text = paragraphs.map((p) => p.en).join('\n');

  const rawQuestions =
    raw.questions !== undefined
      ? list(raw.questions)
      : [
          ...list(raw.mcq).map((q) => ({ ...obj(q), type: 'mcq' })),
          ...(raw.true_false !== undefined
            ? [{ ...obj(raw.true_false), type: 'true_false' }]
            : []),
          ...(raw.find_word !== undefined
            ? [{ ...obj(raw.find_word), type: 'find_word' }]
            : []),
        ];
  const questions = rawQuestions.map(obj).map((q): ReadingQuestion | null => {
    const type = str(q.type);
    const explanationId = str(q.explanation_id ?? q.explanationId).slice(
      0,
      400,
    );
    if (type === 'mcq') {
      const options = list(q.options).map(str);
      const idx = q.answer_index ?? q.answerIndex;
      return {
        type,
        question: str(q.question).slice(0, 300),
        options,
        answerIndex: typeof idx === 'number' ? idx : -1,
        explanationId,
      };
    }
    if (type === 'true_false') {
      return {
        type,
        statement: str(q.statement).slice(0, 300),
        answer: q.answer === true || q.answer === 'true',
        explanationId,
      };
    }
    if (type === 'find_word') {
      return {
        type,
        promptId: str(q.prompt_id ?? q.promptId).slice(0, 300),
        answer: str(q.answer_word ?? q.answer).slice(0, 60),
      };
    }
    return null;
  });
  const valid = questions.filter((q): q is ReadingQuestion => q !== null);
  const n = (t: string) => valid.filter((q) => q.type === t).length;
  const goodQuestion = (q: ReadingQuestion): boolean => {
    if (q.type === 'mcq') {
      return (
        !!q.question &&
        !!q.explanationId &&
        q.options.length === 4 &&
        q.options.every(Boolean) &&
        new Set(q.options.map((o) => o.toLowerCase())).size === 4 &&
        Number.isInteger(q.answerIndex) &&
        q.answerIndex >= 0 &&
        q.answerIndex < 4
      );
    }
    if (q.type === 'true_false') return !!q.statement && !!q.explanationId;
    return !!q.promptId && !!q.answer;
  };
  const ok =
    questions.length === 5 &&
    valid.length === 5 &&
    n('mcq') === 3 &&
    n('true_false') === 1 &&
    n('find_word') === 1 &&
    valid.every(goodQuestion);
  if (!ok) throw new ReadingContentError('reading_bad_questions');

  const glossary = list(raw.glossary)
    .map(obj)
    .map((g) => ({
      word: str(g.word).slice(0, 60),
      meaningId: str(g.meaning_id ?? g.meaningId).slice(0, 200),
    }))
    .filter((g) => g.word && g.meaningId)
    .slice(0, 20);

  const claimed = list(raw.target_words_used ?? raw.targetWordsUsed)
    .map(str)
    .filter(Boolean)
    .slice(0, 40);
  const wordCount = countWords(paragraphs.map((p) => p.en));

  const warnings: ReadingWarning[] = [];
  const [min, max] = SLOT_WORDS[slot];
  if (wordCount < min || wordCount > max) {
    warnings.push({ code: 'word_count', count: wordCount, min, max });
  }
  // Week words that really appear (whatever Gemini claimed).
  const found = new Set(
    [...weekWords, ...claimed]
      .filter((w) => appearsIn(text, w))
      .map((w) => w.toLowerCase()),
  );
  const fromWeek = weekWords.length
    ? weekWords.filter((w) => found.has(w.toLowerCase())).length
    : found.size;
  if (fromWeek < MIN_TARGET_WORDS) {
    warnings.push({
      code: 'few_target_words',
      found: fromWeek,
      min: MIN_TARGET_WORDS,
    });
  }
  const notInText = claimed.filter((w) => !appearsIn(text, w));
  if (notInText.length) {
    warnings.push({ code: 'targets_not_in_text', words: notInText });
  }
  const fw = valid.find((q) => q.type === 'find_word') as {
    answer: string;
  };
  if (!new RegExp(`\\b${esc(fw.answer)}\\b`, 'i').test(text)) {
    warnings.push({ code: 'find_word_not_in_text', word: fw.answer });
  }

  return {
    content: {
      title,
      paragraphs,
      targetWordsUsed: claimed.filter((w) => appearsIn(text, w)),
      glossary,
      questions: valid,
      wordCount,
    },
    warnings,
  };
};

export const parseGenerated = (
  raw: string | undefined,
  slot: SlotWire,
  weekWords: string[],
) => validateText(obj(JSON.parse(raw ?? '')), slot, weekWords);

/** Gemini's lookup answer → cleaned fields; throws when unusable. */
export const parseLookup = (raw: string | undefined) => {
  const o = obj(JSON.parse(raw ?? ''));
  const lemma = str(o.lemma).toLowerCase().slice(0, 60);
  const meaningId = str(o.meaning_id).slice(0, 200);
  const pron = str(o.pron).slice(0, 80);
  if (!lemma || !meaningId) throw new Error('Malformed lookup');
  return { lemma, meaningId, pron };
};
