import {
  FALLBACK_CATEGORY,
  ROLEPLAY_CATEGORY_IDS,
  type RoleplayCategory,
} from './roleplay.prompts';
import type {
  RoleplayCorrectionDto,
  RoleplayNaturalDto,
  RoleplaySuggestionDto,
} from './dto/roleplay.dto';

// Gemini enforces the JSON schemas, but a truncated or odd reply must turn
// into a clean 502 (and a retry), never reach the learner half-formed. Each
// parser throws on anything it can't use and tidies what it can.

type Obj = Record<string, unknown>;

const parseObject = (raw: string | undefined): Obj => {
  const json: unknown = JSON.parse(raw ?? '');
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Malformed roleplay result');
  }
  return json as Obj;
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface ParsedTurn {
  reply: string;
  stepsDone: number[];
  missionComplete: boolean;
}

// `before`: steps already ticked. Steps never untick, out-of-range indexes
// are dropped, and the mission counts as done once every step is ticked or
// the model says so (then every step is ticked, to keep the two in line).
export const parseTurn = (
  raw: string | undefined,
  stepCount: number,
  before: number[],
): ParsedTurn => {
  const json = parseObject(raw);
  const reply = str(json.reply);
  if (!reply) throw new Error('Empty roleplay reply');
  const ticked = new Set(before);
  for (const v of list(json.steps_done)) {
    if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < stepCount)
      ticked.add(v as number);
  }
  const all = Array.from({ length: stepCount }, (_, i) => i);
  const missionComplete =
    json.mission_complete === true || all.every((i) => ticked.has(i));
  return {
    reply,
    stepsDone: missionComplete ? all : [...ticked].sort((a, b) => a - b),
    missionComplete,
  };
};

export const parseHelp = (raw: string | undefined): RoleplaySuggestionDto[] => {
  const json = parseObject(raw);
  const suggestions = list(json.suggestions)
    .map((s) => (s && typeof s === 'object' ? (s as Obj) : {}))
    .map((s) => ({ en: str(s.en), id: str(s.id) }))
    .filter((s) => s.en && s.id)
    .slice(0, 2);
  if (!suggestions.length) throw new Error('No roleplay suggestions');
  return suggestions;
};

export interface ParsedSummary {
  missionComplete: boolean;
  summary: string;
  corrections: RoleplayCorrectionDto[];
  moreNatural: RoleplayNaturalDto[];
  keyPhrasesUsed: string[];
}

// Compares words only: case, punctuation and apostrophes ("im" / "I'm") are
// what speech recognition gets wrong, not the learner.
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const same = (a: string, b: string) => words(a) === words(b);

// `phrases`: the scenario's key phrases; only those can be "used".
export const parseSummary = (
  raw: string | undefined,
  phrases: string[],
): ParsedSummary => {
  const json = parseObject(raw);
  const summary = str(json.summary_id);
  if (!summary || typeof json.mission_complete !== 'boolean') {
    throw new Error('Malformed roleplay summary');
  }
  const corrections = list(json.corrections)
    .map((c) => (c && typeof c === 'object' ? (c as Obj) : {}))
    .map((c) => {
      const category = str(c.category) as RoleplayCategory;
      return {
        original: str(c.original),
        corrected: str(c.corrected),
        explanation: str(c.explanation_id),
        category: ROLEPLAY_CATEGORY_IDS.includes(category)
          ? category
          : FALLBACK_CATEGORY,
      };
    })
    // A "correction" that only changes case or punctuation is exactly the
    // speech-recognition noise the prompt says to ignore.
    .filter(
      (c) =>
        c.original &&
        c.corrected &&
        c.explanation &&
        !same(c.original, c.corrected),
    )
    .slice(0, 5);
  const moreNatural = list(json.more_natural)
    .map((c) => (c && typeof c === 'object' ? (c as Obj) : {}))
    .map((c) => ({ original: str(c.original), natural: str(c.natural) }))
    .filter((c) => c.original && c.natural && !same(c.original, c.natural))
    .slice(0, 2);
  const used = list(json.key_phrases_used).map(str).filter(Boolean);
  const keyPhrasesUsed = phrases.filter((p) => used.some((u) => same(u, p)));
  return {
    missionComplete: json.mission_complete,
    summary,
    corrections,
    moreNatural,
    keyPhrasesUsed,
  };
};
