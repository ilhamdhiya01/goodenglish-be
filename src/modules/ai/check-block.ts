import {
  AI_MISTAKE_CATEGORIES,
  MISTAKE_CATEGORIES,
  categoryOrFallback,
  type MistakeCategory,
} from '../../common/mistake-categories';
import {
  NO_RULE,
  cheatRuleList,
  ruleOrNone,
  type CheatRuleId,
} from '../../common/cheat-rules';

// When the chat checks a learner's English sentence, the model ends its
// answer with a line `<<<CEK` and one JSON object. The learner never sees
// it: the stream stops forwarding text at the marker, and the JSON is sent
// as its own SSE event (`check`) for "Buku kesalahanku".

export const CHECK_MARKER = '<<<CEK';

export interface SentenceCheck {
  /** The learner's sentence that was checked, as written. */
  original: string;
  isCorrect: boolean;
  corrected: string;
  explanationId: string;
  category: MistakeCategory;
  /** The Cheat sheet rule the mistake breaks, when one fits. */
  rule?: CheatRuleId;
}

/** Prompt lines that ask for the block (part of the chat instruction). */
export const CHECK_INSTRUCTION = `
- Khusus saat kamu mengoreksi kalimat bahasa Inggris buatan pelajar (format koreksi di atas), akhiri jawabanmu dengan baris baru berisi persis ${CHECK_MARKER} lalu satu baris JSON:
  {"original": "kalimat bahasa Inggris pelajar yang kamu cek, persis seperti ditulis", "is_correct": true atau false, "corrected": "kalimat yang benar (sama dengan kalimat pelajar kalau sudah benar)", "explanation_id": "alasan singkat bahasa Indonesia, 1 kalimat", "category": "id kategori", "rule": "id aturan"}
  "category" wajib salah satu id ini: ${AI_MISTAKE_CATEGORIES.map((id) => `${id} (${MISTAKE_CATEGORIES[id]})`).join('; ')}.
  "rule" adalah aturan Cheat sheet yang dilanggar kalimat itu, pilih satu id dari daftar ini, atau "${NO_RULE}" bila tidak ada yang benar-benar cocok (jangan memaksakan):
${cheatRuleList()}
  Bagian ini tidak terlihat pelajar: jangan menyebutnya dan jangan menulis apa pun setelah JSON. Untuk pertanyaan biasa, jangan tulis ${CHECK_MARKER}.`;

/**
 * Splits a text stream at CHECK_MARKER. `push` returns the text that may be
 * shown now (a tail that could be the start of the marker is held back);
 * `end` returns what is left to show and the raw block after the marker.
 */
export class CheckSplitter {
  private buf = '';
  private block: string | null = null;

  push(chunk: string): string {
    if (this.block !== null) {
      this.block += chunk;
      return '';
    }
    this.buf += chunk;
    const at = this.buf.indexOf(CHECK_MARKER);
    if (at >= 0) {
      const out = this.buf.slice(0, at);
      this.block = this.buf.slice(at + CHECK_MARKER.length);
      this.buf = '';
      return out;
    }
    // Hold back the longest tail that is a prefix of the marker.
    let keep = Math.min(CHECK_MARKER.length - 1, this.buf.length);
    while (keep > 0 && !CHECK_MARKER.startsWith(this.buf.slice(-keep))) keep--;
    const out = this.buf.slice(0, this.buf.length - keep);
    this.buf = this.buf.slice(this.buf.length - keep);
    return out;
  }

  end(): { text: string; block: string | null } {
    const text = this.buf;
    this.buf = '';
    return { text, block: this.block };
  }
}

const str = (v: unknown) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';

/** The JSON after the marker, checked; null when unusable. */
export const parseCheck = (block: string | null): SentenceCheck | null => {
  if (!block) return null;
  const from = block.indexOf('{');
  const to = block.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(block.slice(from, to + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const isCorrect = o.is_correct === true || o.is_correct === 'true';
  const notCorrect = o.is_correct === false || o.is_correct === 'false';
  const corrected = str(o.corrected).slice(0, 600);
  const explanationId = str(o.explanation_id).slice(0, 400);
  if ((!isCorrect && !notCorrect) || (notCorrect && !corrected)) return null;
  return {
    original: str(o.original).slice(0, 600),
    isCorrect,
    corrected,
    explanationId,
    category: categoryOrFallback(o.category),
    ...(ruleOrNone(o.rule) ? { rule: ruleOrNone(o.rule) } : {}),
  };
};

/**
 * Streams an answer through `write` as SSE text frames, minus the hidden
 * block, then `event: check` when the block is usable. Returns the text the
 * learner saw (what gets stored). Errors from the stream propagate; the
 * text so far has been written by then.
 */
export const pipeAnswer = async (
  stream: AsyncIterable<string>,
  write: (event: string | null, data: unknown) => void,
  seen: { text: string } = { text: '' },
): Promise<string> => {
  const split = new CheckSplitter();
  const show = (text: string) => {
    if (!text) return;
    seen.text += text;
    write(null, { text });
  };
  for await (const text of stream) show(split.push(text));
  const rest = split.end();
  show(rest.block === null ? rest.text : rest.text.trimEnd());
  const check = parseCheck(rest.block);
  if (check) write('check', check);
  return seen.text;
};
