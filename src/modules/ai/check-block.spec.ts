import {
  CHECK_MARKER,
  CheckSplitter,
  parseCheck,
  pipeAnswer,
} from './check-block';

const run = (chunks: string[]) => {
  const s = new CheckSplitter();
  const shown = chunks.map((c) => s.push(c)).join('');
  const end = s.end();
  return { shown: shown + end.text, block: end.block };
};

describe('CheckSplitter', () => {
  it('passes plain answers through untouched', () => {
    expect(run(['Halo, ', 'ini jawaban < 3 dan << 5.'])).toEqual({
      shown: 'Halo, ini jawaban < 3 dan << 5.',
      block: null,
    });
  });

  it('cuts the block even when the marker is split across chunks', () => {
    const json = '{"is_correct": false, "corrected": "I go."}';
    const full = `Belum tepat. **I go.**\n${CHECK_MARKER}\n${json}`;
    for (let i = 1; i < full.length; i++) {
      const r = run([full.slice(0, i), full.slice(i)]);
      expect(r.shown).toBe('Belum tepat. **I go.**\n');
      expect(r.block?.trim()).toBe(json);
    }
  });

  it('never shows any part of the marker', () => {
    const r = run(['Benar.', '\n<', '<<', 'CE', 'K {"is_correct":true}']);
    expect(r.shown).toBe('Benar.\n');
    expect(r.shown).not.toContain('<');
  });
});

describe('parseCheck', () => {
  it('reads and cleans the JSON', () => {
    expect(
      parseCheck(
        '\n```json\n{"is_correct": false, "corrected": " She goes  home. ", "explanation_id": "Pakai -s.", "category": "aturan-dasar"}\n```',
      ),
    ).toEqual({
      original: '',
      isCorrect: false,
      corrected: 'She goes home.',
      explanationId: 'Pakai -s.',
      category: 'aturan-dasar',
    });
  });

  it('keeps the checked sentence', () => {
    expect(
      parseCheck(
        '{"original": "She go home.", "is_correct": false, "corrected": "She goes home."}',
      )?.original,
    ).toBe('She go home.');
  });

  it('falls back to "kesalahan" for an unknown category', () => {
    expect(
      parseCheck(
        '{"is_correct": false, "corrected": "x", "category": "grammar"}',
      )?.category,
    ).toBe('kesalahan');
    expect(
      parseCheck(
        '{"is_correct": false, "corrected": "x", "category": "menyimak"}',
      )?.category,
    ).toBe('kesalahan');
  });

  it('keeps a known Cheat sheet rule and drops "none" or unknown ones', () => {
    const rule = (r: string) =>
      parseCheck(
        `{"is_correct": false, "corrected": "She goes home.", "category": "tense", "rule": "${r}"}`,
      )?.rule;
    expect(rule('tense/he-she-it-s')).toBe('tense/he-she-it-s');
    expect(rule('none')).toBeUndefined();
    expect(rule('tense/made-up')).toBeUndefined();
    expect(
      parseCheck('{"is_correct": false, "corrected": "x"}'),
    ).not.toHaveProperty('rule');
  });

  it('returns null for broken or incomplete blocks', () => {
    expect(parseCheck(null)).toBeNull();
    expect(parseCheck('{"is_correct": fals')).toBeNull();
    expect(parseCheck('{"corrected": "x"}')).toBeNull();
    expect(parseCheck('{"is_correct": false, "corrected": ""}')).toBeNull();
    expect(parseCheck('{"is_correct": true}')).toMatchObject({
      isCorrect: true,
    });
  });
});

describe('pipeAnswer', () => {
  const stream = (chunks: string[]) =>
    (async function* () {
      for (const c of chunks) {
        await Promise.resolve();
        yield c;
      }
    })();

  it('hides the block, sends it as event: check, returns the shown text', async () => {
    const writes: [string | null, unknown][] = [];
    const answer = await pipeAnswer(
      stream([
        'Belum tepat. **She goes home.**\n<<',
        '<CEK\n{"is_correct": false, "corrected": "She goes home.",',
        ' "explanation_id": "Pakai -s.", "category": "aturan-dasar"}',
      ]),
      (e, d) => writes.push([e, d]),
    );
    expect(answer).toBe('Belum tepat. **She goes home.**\n');
    expect(
      writes
        .filter(([e]) => e === null)
        .map(([, d]) => (d as { text: string }).text)
        .join(''),
    ).toBe(answer);
    expect(writes.at(-1)).toEqual([
      'check',
      {
        original: '',
        isCorrect: false,
        corrected: 'She goes home.',
        explanationId: 'Pakai -s.',
        category: 'aturan-dasar',
      },
    ]);
  });

  it('sends no check event for an ordinary answer', async () => {
    const writes: [string | null, unknown][] = [];
    const answer = await pipeAnswer(
      stream(['Since untuk titik waktu.']),
      (e, d) => writes.push([e, d]),
    );
    expect(answer).toBe('Since untuk titik waktu.');
    expect(writes.some(([e]) => e === 'check')).toBe(false);
  });
});
