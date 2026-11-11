import { GoogleGenAI } from '@google/genai';

// Used until an admin picks one, and the first choice of the fallback list.
export const DEFAULT_MODEL = 'gemini-3.6-flash';

// What the model picker offers when Google can't be asked (no key yet, or
// the listing failed). Suggestions only: any model id can be saved.
export const MODEL_CATALOG = [
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];

// Models in the list API that can't hold a text conversation.
export const NON_CHAT_MODEL = /embedding|tts|image|live|audio|banana/i;

// Google answers a wrong key with 400 INVALID_ARGUMENT, not 401.
const INVALID_KEY = /API[ _]key not valid|API_KEY_INVALID/i;

export const isInvalidKeyError = (err: unknown): boolean => {
  const status = (err as { status?: number }).status;
  const message = err instanceof Error ? err.message : String(err);
  return status === 401 || status === 403 || INVALID_KEY.test(message);
};

// `retry`: Gemini answers 503 "high demand" now and then, and a second try a
// moment later usually works. The SDK only retries when told to: 3 attempts
// (≈0.8s, then ≈1.6s apart) on 408/429/5xx keeps a learner waiting a few
// seconds at most. Off for admin checks, which should fail fast.
export const createGemini = (apiKey: string, retry = true): GoogleGenAI =>
  new GoogleGenAI({
    apiKey,
    ...(retry
      ? {
          httpOptions: {
            retryOptions: { attempts: 3, initialDelay: 0.8, maxDelay: 4 },
          },
        }
      : {}),
  });

// "gemini-3.5-flash-lite" → [3, 5]: newer families first in the picker.
const version = (id: string): number[] =>
  (/^gemini-(\d+)(?:\.(\d+))?/.exec(id) ?? [])
    .slice(1)
    .map((n) => Number(n ?? 0));

export const newestFirst = (a: string, b: string): number => {
  const [va, vb] = [version(a), version(b)];
  for (let i = 0; i < 2; i++) {
    const d = (vb[i] ?? 0) - (va[i] ?? 0);
    if (d) return d;
  }
  return a.localeCompare(b);
};
