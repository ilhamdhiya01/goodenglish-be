import {
  MAX_WORDS,
  MIN_WORDS,
  OPTIONS,
  QUESTIONS,
  type ListeningTypeWire,
} from './listening.prompts';

export interface ListeningLine {
  speaker: 'A' | 'B';
  text: string;
}

export interface ListeningQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanationId: string;
}

export interface ListeningContent {
  title: string;
  type: ListeningTypeWire;
  lines: ListeningLine[];
  questions: ListeningQuestion[];
  wordCount: number;
}

/** Why content was refused; also the API error code (listening_*). */
export class ListeningContentError extends Error {
  constructor(
    readonly code:
      | 'listening_bad_title'
      | 'listening_bad_lines'
      | 'listening_word_count'
      | 'listening_bad_questions',
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

export const countWords = (lines: { text: string }[]) =>
  lines.reduce(
    (n, l) =>
      n + (l.text.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) ?? []).length,
    0,
  );

// The rules every item must meet, whether Gemini wrote it or an admin
// edited it: 40–120 words, speakers A/B (only A in a monologue, both in a
// dialogue), exactly 3 questions with 4 distinct options, a valid answer
// and an Indonesian explanation.
export const validateContent = (raw: {
  title?: unknown;
  type?: unknown;
  lines?: unknown;
  questions?: unknown;
}): ListeningContent => {
  const title = str(raw.title).slice(0, 160);
  if (!title) throw new ListeningContentError('listening_bad_title');
  const type: ListeningTypeWire = raw.type === 'monolog' ? 'monolog' : 'dialog';

  const lines = list(raw.lines)
    .map(obj)
    .map((l): ListeningLine => ({
      speaker: str(l.speaker).toUpperCase() === 'B' ? 'B' : 'A',
      text: str(l.text).slice(0, 600),
    }))
    .filter((l) => l.text);
  if (!lines.length || lines.length > 30) {
    throw new ListeningContentError('listening_bad_lines');
  }
  const speakers = new Set(lines.map((l) => l.speaker));
  if (type === 'monolog' && speakers.has('B')) {
    throw new ListeningContentError('listening_bad_lines');
  }
  if (type === 'dialog' && speakers.size < 2) {
    throw new ListeningContentError('listening_bad_lines');
  }
  const wordCount = countWords(lines);
  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) {
    throw new ListeningContentError('listening_word_count');
  }

  const questions = list(raw.questions)
    .map(obj)
    .map((q) => {
      const options = list(q.options).map(str);
      const idx = q.answer_index ?? q.answerIndex;
      return {
        question: str(q.question).slice(0, 300),
        options,
        answerIndex: typeof idx === 'number' ? idx : -1,
        explanationId: str(q.explanation_id ?? q.explanationId).slice(0, 400),
      };
    });
  const ok =
    questions.length === QUESTIONS &&
    questions.every(
      (q) =>
        q.question &&
        q.explanationId &&
        q.options.length === OPTIONS &&
        q.options.every((o) => o && o.length <= 200) &&
        new Set(q.options.map((o) => o.toLowerCase())).size === OPTIONS &&
        Number.isInteger(q.answerIndex) &&
        q.answerIndex >= 0 &&
        q.answerIndex < OPTIONS,
    );
  if (!ok) throw new ListeningContentError('listening_bad_questions');
  return { title, type, lines, questions, wordCount };
};

/** Gemini's reply → content; throws on anything unusable (→ 502). */
export const parseGenerated = (
  raw: string | undefined,
  wanted: ListeningTypeWire,
): ListeningContent => {
  const json: unknown = JSON.parse(raw ?? '');
  const o = obj(json);
  return validateContent({ ...o, type: o.type ?? wanted });
};
