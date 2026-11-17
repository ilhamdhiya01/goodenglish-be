import {
  ReadingContentError,
  appearsIn,
  countWords,
  parseGenerated,
  parseLookup,
  validateText,
} from './reading.parse';

const WEEK = [
  'commute',
  'deadline',
  'wake up',
  'study',
  'stop',
  'busy',
  'colleague',
  'make',
  'meeting',
  'traffic',
];

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const questions = (): Record<string, unknown>[] => [
  ...[0, 1, 2].map(() => ({
    type: 'mcq',
    question: 'Why is Rina late?',
    options: ['Traffic', 'Rain', 'Sleep', 'Money'],
    answer_index: 0,
    explanation_id: 'Teks menyebut "traffic".',
  })),
  {
    type: 'true_false',
    statement: 'Rina takes the bus.',
    answer: false,
    explanation_id: 'Dia naik motor.',
  },
  {
    type: 'find_word',
    prompt_id: 'Temukan kata yang artinya "rekan kerja"',
    answer: 'colleagues',
  },
];

// 8 week words (with inflections) + filler to reach the slot length.
const body =
  'Rina commutes to work. Her deadline is today. She wakes up early and studies. ' +
  'The bus stopped. She is busy. Her colleagues are making tea before the meeting.';

const raw = (o: object = {}, extra = 150) => ({
  title: 'A busy Monday',
  paragraphs: [
    { en: body, id: 'Rina pergi kerja.' },
    { en: filler(extra), id: 'Terjemahan.' },
  ],
  target_words_used: [
    'commute',
    'deadline',
    'wake up',
    'study',
    'stop',
    'busy',
    'colleague',
    'make',
    'meeting',
  ],
  glossary: [{ word: 'tea', meaning_id: 'teh' }],
  questions: questions(),
  ...o,
});

describe('appearsIn', () => {
  it('matches regular inflections and phrases', () => {
    expect(appearsIn('She studies hard', 'study')).toBe(true);
    expect(appearsIn('The car stopped', 'stop')).toBe(true);
    expect(appearsIn('He is making tea', 'make')).toBe(true);
    expect(appearsIn('I woke up', 'wake up')).toBe(false);
    expect(appearsIn('She wakes up at 5', 'wake up')).toBe(true);
    expect(appearsIn('Pick it up now', 'pick up')).toBe(true);
    expect(appearsIn('pick up sth', 'pick up sth')).toBe(true);
    expect(appearsIn('A stopwatch', 'stop')).toBe(false);
  });
});

describe('validateText', () => {
  it('accepts a good text without warnings', () => {
    const { content, warnings } = validateText(raw(), 'A', WEEK);
    expect(warnings).toEqual([]);
    expect(content.wordCount).toBe(countWords([body, filler(150)]));
    expect(content.questions.map((q) => q.type)).toEqual([
      'mcq',
      'mcq',
      'mcq',
      'true_false',
      'find_word',
    ]);
    expect(content.glossary).toEqual([{ word: 'tea', meaningId: 'teh' }]);
  });

  it('warns (not rejects) on length, few week words and false claims', () => {
    const { warnings } = validateText(
      raw({
        paragraphs: [{ en: 'Rina is busy at the meeting.', id: 'x' }],
        target_words_used: ['busy', 'traffic'],
      }),
      'B',
      WEEK,
    );
    const codes = warnings.map((w) => w.code);
    expect(codes).toEqual([
      'word_count',
      'few_target_words',
      'targets_not_in_text',
      'find_word_not_in_text',
    ]);
    expect(warnings[1]).toMatchObject({ found: 2, min: 8 });
    expect(warnings[2]).toMatchObject({ words: ['traffic'] });
  });

  it('keeps only claimed words that really appear', () => {
    const { content } = validateText(
      raw({ target_words_used: ['busy', 'traffic'] }),
      'A',
      WEEK,
    );
    expect(content.targetWordsUsed).toEqual(['busy']);
  });

  it('rejects a broken shape', () => {
    const bad = (o: object) => () => validateText(raw(o), 'A', WEEK);
    expect(bad({ title: ' ' })).toThrow(ReadingContentError);
    expect(bad({ paragraphs: [] })).toThrow('reading_bad_paragraphs');
    expect(bad({ paragraphs: [{ en: 'x', id: '' }] })).toThrow(
      'reading_bad_paragraphs',
    );
    expect(bad({ questions: questions().slice(0, 4) })).toThrow(
      'reading_bad_questions',
    );
    const q = questions();
    q[0] = { ...q[0], options: ['a', 'a', 'b', 'c'] };
    expect(bad({ questions: q })).toThrow('reading_bad_questions');
    const q2 = questions();
    q2[3] = { ...q2[0] };
    expect(bad({ questions: q2 })).toThrow('reading_bad_questions');
  });

  it('reads the find_word key from answer_word (Gemini schema)', () => {
    const q = questions();
    q[4] = {
      type: 'find_word',
      prompt_id: 'Temukan',
      answer_word: 'colleagues',
    };
    const { content } = validateText(raw({ questions: q }), 'A', WEEK);
    expect(content.questions[4]).toEqual({
      type: 'find_word',
      promptId: 'Temukan',
      answer: 'colleagues',
    });
  });

  it("accepts Gemini's shape: one field per question type", () => {
    const [m1, m2, m3, tf, fw] = questions();
    const { content } = validateText(
      raw({
        questions: undefined,
        mcq: [m1, m2, m3],
        true_false: tf,
        find_word: { prompt_id: 'Temukan', answer_word: 'colleagues' },
      }),
      'A',
      WEEK,
    );
    expect(content.questions.map((q) => q.type)).toEqual([
      'mcq',
      'mcq',
      'mcq',
      'true_false',
      'find_word',
    ]);
    expect(content.questions[4]).toMatchObject({ answer: 'colleagues' });
    expect(fw).toBeDefined();
  });

  it('parses Gemini JSON', () => {
    expect(parseGenerated(JSON.stringify(raw()), 'A', WEEK).content.title).toBe(
      'A busy Monday',
    );
    expect(() => parseGenerated('{', 'A', WEEK)).toThrow();
  });
});

describe('parseLookup', () => {
  it('cleans the answer', () => {
    expect(
      parseLookup(
        JSON.stringify({ lemma: ' Go ', meaning_id: 'pergi', pron: 'gou' }),
      ),
    ).toEqual({ lemma: 'go', meaningId: 'pergi', pron: 'gou' });
    expect(() => parseLookup(JSON.stringify({ lemma: 'go' }))).toThrow();
  });
});
