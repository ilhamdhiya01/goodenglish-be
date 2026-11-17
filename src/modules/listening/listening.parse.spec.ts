import {
  countWords,
  ListeningContentError,
  parseGenerated,
  validateContent,
} from './listening.parse';

const words = (n: number) =>
  Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

const q = (o: Partial<Record<string, unknown>> = {}) => ({
  question: 'Where are they?',
  options: ['At a cafe', 'At home', 'At school', 'At the bank'],
  answer_index: 0,
  explanation_id: 'Mereka memesan kopi.',
  ...o,
});

const base = (o: Record<string, unknown> = {}) => ({
  title: 'Morning coffee',
  type: 'dialog',
  lines: [
    { speaker: 'A', text: words(30) },
    { speaker: 'B', text: words(30) },
  ],
  questions: [q(), q(), q()],
  ...o,
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as ListeningContentError).code;
  }
  return 'ok';
};

describe('validateContent', () => {
  it('accepts a good dialogue and counts its words', () => {
    const c = validateContent(base());
    expect(c.wordCount).toBe(60);
    expect(c.questions[0]).toEqual({
      question: 'Where are they?',
      options: ['At a cafe', 'At home', 'At school', 'At the bank'],
      answerIndex: 0,
      explanationId: 'Mereka memesan kopi.',
    });
  });

  it('enforces 40–120 words', () => {
    expect(
      code(() =>
        validateContent(
          base({
            lines: [
              { speaker: 'A', text: words(20) },
              { speaker: 'B', text: words(19) },
            ],
          }),
        ),
      ),
    ).toBe('listening_word_count');
    expect(
      code(() =>
        validateContent(
          base({
            lines: [
              { speaker: 'A', text: words(61) },
              { speaker: 'B', text: words(60) },
            ],
          }),
        ),
      ),
    ).toBe('listening_word_count');
  });

  it('needs two speakers in a dialogue and only A in a monologue', () => {
    expect(
      code(() =>
        validateContent(base({ lines: [{ speaker: 'A', text: words(50) }] })),
      ),
    ).toBe('listening_bad_lines');
    expect(code(() => validateContent(base({ type: 'monolog' })))).toBe(
      'listening_bad_lines',
    );
    expect(
      code(() =>
        validateContent(
          base({ type: 'monolog', lines: [{ speaker: 'A', text: words(50) }] }),
        ),
      ),
    ).toBe('ok');
  });

  it('needs exactly 3 questions with 4 distinct options and a valid answer', () => {
    expect(code(() => validateContent(base({ questions: [q(), q()] })))).toBe(
      'listening_bad_questions',
    );
    expect(
      code(() =>
        validateContent(
          base({ questions: [q(), q(), q({ options: ['a', 'b', 'c'] })] }),
        ),
      ),
    ).toBe('listening_bad_questions');
    expect(
      code(() =>
        validateContent(
          base({ questions: [q(), q(), q({ options: ['a', 'A', 'c', 'd'] })] }),
        ),
      ),
    ).toBe('listening_bad_questions');
    expect(
      code(() =>
        validateContent(
          base({ questions: [q(), q(), q({ answer_index: 4 })] }),
        ),
      ),
    ).toBe('listening_bad_questions');
    expect(
      code(() =>
        validateContent(
          base({ questions: [q(), q(), q({ explanation_id: ' ' })] }),
        ),
      ),
    ).toBe('listening_bad_questions');
  });

  it('needs a title', () => {
    expect(code(() => validateContent(base({ title: '  ' })))).toBe(
      'listening_bad_title',
    );
  });

  it('accepts the camelCase shape used by admin edits', () => {
    const c = validateContent(
      base({
        questions: [1, 2, 3].map(() => ({
          question: 'Q?',
          options: ['a', 'b', 'c', 'd'],
          answerIndex: 2,
          explanationId: 'Karena…',
        })),
      }),
    );
    expect(c.questions[2].answerIndex).toBe(2);
  });
});

describe('parseGenerated / countWords', () => {
  it('parses Gemini JSON and falls back to the requested type', () => {
    const { type, ...rest } = base();
    expect(type).toBe('dialog');
    expect(parseGenerated(JSON.stringify(rest), 'dialog').type).toBe('dialog');
    expect(() => parseGenerated('{"title": "x"', 'dialog')).toThrow();
  });

  it('counts contractions and numbers as one word each', () => {
    expect(
      countWords([{ text: "I'm at the café at 9:30, it's 5 dollars." }]),
    ).toBe(10);
  });
});
