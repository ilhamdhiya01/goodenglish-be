import type { LevelWire } from '../../common/token/access-enums';
import { LEVEL_TEXT } from '../roleplay/roleplay.prompts';

export const MIN_WORDS = 40;
export const MAX_WORDS = 120;
export const QUESTIONS = 3;
export const OPTIONS = 4;

export type ListeningTypeWire = 'dialog' | 'monolog';

export interface GenerateContext {
  level: LevelWire;
  week: number;
  type: ListeningTypeWire;
  // Vocabulary of that week (from the frontend's bundled course content).
  words: string[];
  tense?: { name: string; use?: string };
}

// Spec: use the week's vocabulary and tense focus; every other word must be
// common for the level. Output JSON exactly as the product spec.
export const generateInstruction = (c: GenerateContext): string =>
  `You write listening-comprehension material for Indonesian learners of English.

Level: ${LEVEL_TEXT[c.level]}.
Week ${c.week} vocabulary to use (use 4–8 of these naturally, not as a list): ${c.words.join(', ')}
${c.tense ? `Grammar focus of the week: ${c.tense.name}${c.tense.use ? ` (${c.tense.use})` : ''}. Use it several times.` : ''}

Write ONE ${
    c.type === 'dialog'
      ? 'short, natural dialogue between two people, speaker "A" and speaker "B", taking turns'
      : 'monologue: a public announcement or a voice message, all lines by speaker "A"'
  } from everyday life or work.
- ${MIN_WORDS + 20}–${MAX_WORDS - 20} words in total across all lines (never under ${MIN_WORDS} or over ${MAX_WORDS}).
- Apart from the week's vocabulary, only common words for this level. Short sentences. No slang that is hard to hear.
- It is spoken aloud by a text-to-speech voice: write numbers, times and prices so they read naturally, no emojis, no stage directions.
- The English must be correct and natural. Learners copy what they hear: never force a vocabulary word into a sentence where it doesn't fit (e.g. no "for three days ago"); skip it instead.
- ${c.type === 'dialog' ? 'Each line is one turn of 1–2 sentences.' : 'Split the monologue into 3–6 lines of 1–2 sentences each.'}

Then write exactly ${QUESTIONS} multiple-choice questions about what was SAID (details, purpose, what happens next), answerable only by listening:
- "question" in simple English; exactly ${OPTIONS} "options", one correct, the others plausible; "answer_index" is the 0-based index of the correct option.
- "explanation_id": 1 short sentence in Indonesian saying why the answer is right, quoting the key words from the audio.
- "title": a short English title (max 6 words).`;

export const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    type: { type: 'string', enum: ['dialog', 'monolog'] },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string', enum: ['A', 'B'] },
          text: { type: 'string' },
        },
        required: ['speaker', 'text'],
      },
    },
    questions: {
      type: 'array',
      minItems: QUESTIONS,
      maxItems: QUESTIONS,
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            minItems: OPTIONS,
            maxItems: OPTIONS,
            items: { type: 'string' },
          },
          answer_index: { type: 'integer' },
          explanation_id: { type: 'string' },
        },
        required: ['question', 'options', 'answer_index', 'explanation_id'],
      },
    },
  },
  required: ['title', 'type', 'lines', 'questions'],
} as const;
