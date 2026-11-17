import type { LevelWire } from '../../common/token/access-enums';
import { LEVEL_TEXT } from '../roleplay/roleplay.prompts';

export type SlotWire = 'A' | 'B';

/** Word range per slot (product spec). */
export const SLOT_WORDS: Record<SlotWire, [number, number]> = {
  A: [150, 200],
  B: [200, 300],
};
export const MIN_TARGET_WORDS = 8;

export interface GenerateContext {
  level: LevelWire;
  week: number;
  slot: SlotWire;
  // The week's Kosakata (from the frontend's bundled course content).
  words: string[];
  tense?: { name: string; use?: string };
}

// Spec: ≥ 8 words of the week's Kosakata, the week's tense focus, the rest
// common for the level (± 95% known), topics close to everyday Indonesian
// life. Output JSON exactly as the product spec.
/** Paragraph plan that lands in the slot's range: models follow structure
 * better than word counts, and write ~20–30% less than the plan says
 * (measured with Gemini Flash), so the plan aims above the middle. */
const SHAPE: Record<SlotWire, { paragraphs: number; words: number }> = {
  A: { paragraphs: 5, words: 44 },
  B: { paragraphs: 6, words: 55 },
};

export const generateInstruction = (c: GenerateContext): string => {
  const [min, max] = SLOT_WORDS[c.slot];
  const shape = SHAPE[c.slot];
  return `You write graded reading texts for Indonesian learners of English.

Level: ${LEVEL_TEXT[c.level]}.
Week ${c.week} vocabulary (Kosakata): ${c.words.join(', ')}
${c.tense ? `Grammar focus of the week: ${c.tense.name}${c.tense.use ? ` (${c.tense.use})` : ''}. Use it naturally and often.` : ''}

LENGTH: the English text must have ${min}–${max} words. Write exactly ${shape.paragraphs} paragraphs of about ${shape.words} words each (3–5 sentences per paragraph). Texts shorter than ${min} words are rejected.
- Use at least ${MIN_TARGET_WORDS} different words or phrases from the week's vocabulary, naturally, in their normal forms (inflections are fine). List exactly the ones you used in "target_words_used", spelled as in the vocabulary list.
- About 95% of the words must already be familiar at this level: apart from the week's vocabulary, only common words. Short, clear sentences. The English must be correct and natural; never force a word in.
- A topic close to everyday life in Indonesia: work, shopping, family, travel, social media, school, food. Use Indonesian names and places where it fits.
- "paragraphs": each item has "en" (the English paragraph) and "id" (a natural Indonesian translation of that paragraph).
- "glossary": words in the text that are NOT in the week's vocabulary and may be hard at this level (at most 10), each with "meaning_id" (short Indonesian meaning in this context).
- "mcq": exactly 3 comprehension questions in simple English, each with 4 different "options", "answer_index" (0-based) and "explanation_id" (Indonesian, quoting the text).
- "true_false": one "statement" about the text, boolean "answer", "explanation_id" (Indonesian).
- "find_word": "prompt_id" in Indonesian ("Temukan kata di teks yang artinya …") and "answer_word": that word exactly as it appears in the text.
- "title": short English title (max 6 words).`;
};

const str = { type: 'string' } as const;

export const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    title: str,
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { en: str, id: str },
        required: ['en', 'id'],
      },
    },
    target_words_used: { type: 'array', items: str },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        properties: { word: str, meaning_id: str },
        required: ['word', 'meaning_id'],
      },
    },
    mcq: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          question: str,
          options: { type: 'array', items: str, minItems: 4, maxItems: 4 },
          answer_index: { type: 'integer' },
          explanation_id: str,
        },
        required: ['question', 'options', 'answer_index', 'explanation_id'],
      },
    },
    true_false: {
      type: 'object',
      properties: {
        statement: str,
        answer: { type: 'boolean' },
        explanation_id: str,
      },
      required: ['statement', 'answer', 'explanation_id'],
    },
    find_word: {
      type: 'object',
      properties: { prompt_id: str, answer_word: str },
      required: ['prompt_id', 'answer_word'],
    },
  },
  required: [
    'title',
    'paragraphs',
    'target_words_used',
    'glossary',
    'mcq',
    'true_false',
    'find_word',
  ],
} as const;

// Tap-a-word lookup for a word that is in neither Kosakata nor the glossary.
export const lookupInstruction = (level: LevelWire) =>
  `You explain one English word to an Indonesian learner (${LEVEL_TEXT[level]}) who tapped it while reading.
Return its dictionary form ("lemma", e.g. "went" → "go", "studies" → "study"), a short Indonesian meaning that fits the sentence ("meaning_id", max 8 words, no explanation), and a simple pronunciation guide written with Indonesian spelling, not IPA ("pron", e.g. "kə-MYUT" for commute, "WENT" for went).`;

export const LOOKUP_SCHEMA = {
  type: 'object',
  properties: {
    lemma: { type: 'string' },
    meaning_id: { type: 'string' },
    pron: { type: 'string' },
  },
  required: ['lemma', 'meaning_id', 'pron'],
} as const;
