import { parseHelp, parseSummary, parseTurn } from './roleplay.parse';

describe('parseTurn', () => {
  const turn = (o: object) => JSON.stringify(o);

  it('keeps earlier steps, adds new ones and drops out-of-range indexes', () => {
    const r = parseTurn(
      turn({
        reply: ' Sure! ',
        steps_done: [2, 9, -1, 1.5],
        mission_complete: false,
      }),
      4,
      [0],
    );
    expect(r).toEqual({
      reply: 'Sure!',
      stepsDone: [0, 2],
      missionComplete: false,
    });
  });

  it('never unticks a step the model forgot', () => {
    const r = parseTurn(
      turn({ reply: 'Ok', steps_done: [], mission_complete: false }),
      3,
      [0, 1],
    );
    expect(r.stepsDone).toEqual([0, 1]);
  });

  it('is complete once every step is ticked', () => {
    const r = parseTurn(
      turn({ reply: 'Bye', steps_done: [1, 2], mission_complete: false }),
      3,
      [0],
    );
    expect(r.missionComplete).toBe(true);
  });

  it('ticks every step when the model says the mission is complete', () => {
    const r = parseTurn(
      turn({ reply: 'Bye', steps_done: [0], mission_complete: true }),
      3,
      [],
    );
    expect(r).toMatchObject({ missionComplete: true, stepsDone: [0, 1, 2] });
  });

  it('throws on an empty reply or broken JSON', () => {
    expect(() =>
      parseTurn(turn({ reply: ' ', steps_done: [] }), 2, []),
    ).toThrow();
    expect(() => parseTurn('{"reply": "Hi', 2, [])).toThrow();
    expect(() => parseTurn(undefined, 2, [])).toThrow();
    expect(() => parseTurn('[]', 2, [])).toThrow();
  });
});

describe('parseHelp', () => {
  it('returns at most two complete suggestions', () => {
    const r = parseHelp(
      JSON.stringify({
        suggestions: [
          { en: 'Can I have a latte?', id: 'Boleh minta latte?' },
          { en: 'No meaning' },
          { en: 'How much is it?', id: 'Berapa harganya?' },
          { en: 'Extra', id: 'Ekstra' },
        ],
      }),
    );
    expect(r).toEqual([
      { en: 'Can I have a latte?', id: 'Boleh minta latte?' },
      { en: 'How much is it?', id: 'Berapa harganya?' },
    ]);
  });

  it('throws when nothing usable came back', () => {
    expect(() => parseHelp(JSON.stringify({ suggestions: [] }))).toThrow();
  });
});

describe('parseSummary', () => {
  const phrases = [
    'Can I have …, please?',
    'Anything else?',
    'For here or to go?',
  ];
  const base = {
    mission_complete: true,
    summary_id: 'Bagus! Kamu berhasil memesan.',
    corrections: [],
    more_natural: [],
    key_phrases_used: [],
  };
  const parse = (o: object) =>
    parseSummary(JSON.stringify({ ...base, ...o }), phrases);

  it('maps the fields to camelCase', () => {
    const r = parse({
      corrections: [
        {
          original: 'I want two coffee',
          corrected: 'I want two coffees',
          explanation_id: 'Benda jamak pakai -s.',
          category: 'kata-tertukar',
        },
      ],
      more_natural: [
        { original: 'I want a latte', natural: "I'd like a latte" },
      ],
    });
    expect(r).toEqual({
      missionComplete: true,
      summary: 'Bagus! Kamu berhasil memesan.',
      corrections: [
        {
          original: 'I want two coffee',
          corrected: 'I want two coffees',
          explanation: 'Benda jamak pakai -s.',
          category: 'kata-tertukar',
        },
      ],
      moreNatural: [
        { original: 'I want a latte', natural: "I'd like a latte" },
      ],
      keyPhrasesUsed: [],
    });
  });

  it('falls back to "kesalahan" for an unknown category', () => {
    const r = parse({
      corrections: [
        {
          original: 'He go',
          corrected: 'He goes',
          explanation_id: 'x',
          category: 'grammar',
        },
      ],
    });
    expect(r.corrections[0].category).toBe('kesalahan');
  });

  it('drops corrections that only change case or punctuation (speech noise)', () => {
    const r = parse({
      corrections: [
        {
          original: 'hi im rani',
          corrected: "Hi, I'm Rani.",
          explanation_id: 'x',
          category: 'kesalahan',
        },
        {
          original: 'two latte',
          corrected: 'two lattes',
          explanation_id: 'x',
          category: 'kesalahan',
        },
      ],
    });
    expect(r.corrections.map((c) => c.corrected)).toEqual(['two lattes']);
  });

  it('caps corrections at 5 and more_natural at 2', () => {
    const c = (i: number) => ({
      original: `bad ${i}`,
      corrected: `good ${i}`,
      explanation_id: 'x',
      category: 'tense',
    });
    const n = (i: number) => ({ original: `a ${i}`, natural: `b ${i}` });
    const r = parse({
      corrections: [1, 2, 3, 4, 5, 6, 7].map(c),
      more_natural: [1, 2, 3].map(n),
    });
    expect(r.corrections).toHaveLength(5);
    expect(r.moreNatural).toHaveLength(2);
  });

  it('only reports key phrases from the scenario list, as written there', () => {
    const r = parse({
      key_phrases_used: [
        'anything else',
        'Can I have …, please?',
        'Thanks a lot',
      ],
    });
    expect(r.keyPhrasesUsed).toEqual([
      'Can I have …, please?',
      'Anything else?',
    ]);
  });

  it('throws without a summary or mission flag', () => {
    expect(() => parse({ summary_id: '' })).toThrow();
    expect(() => parse({ mission_complete: 'yes' })).toThrow();
  });
});
