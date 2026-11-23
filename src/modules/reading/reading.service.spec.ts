import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AccessContext } from '../../common/types/access-context';
import { jakartaDay } from '../ai/ai-quota.service';
import { ReadingService } from './reading.service';
import {
  LOOKUPS_PER_MIN,
  sentenceCtx,
  WordLookupService,
} from './word-lookup.service';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../ai/gemini-json.service', () => ({ GeminiJsonService: class {} }));

const WEEK = [
  'commute',
  'deadline',
  'wake up',
  'study',
  'stop',
  'busy',
  'colleague',
  'make',
];
const body =
  'Rina commutes to work. Her deadline is today. She wakes up early and studies. ' +
  'The bus stopped. She is busy. Her colleagues are making tea.';
const filler = Array.from({ length: 150 }, (_, i) => `w${i}`).join(' ');
const questions: Record<string, unknown>[] = [
  ...[0, 1, 2].map(() => ({
    type: 'mcq',
    question: 'Why?',
    options: ['a', 'b', 'c', 'd'],
    answerIndex: 1,
    explanationId: 'Karena…',
  })),
  {
    type: 'true_false',
    statement: 'Rina is busy.',
    answer: true,
    explanationId: 'Ya.',
  },
  { type: 'find_word', promptId: 'Temukan "sibuk"', answer: 'busy' },
];
const good = () =>
  JSON.stringify({
    title: 'Monday',
    paragraphs: [
      { en: body, id: 'Rina…' },
      { en: filler, id: '…' },
    ],
    target_words_used: WEEK,
    glossary: [],
    questions: questions.map((q) => ({
      ...q,
      answer_index: q.answerIndex,
      explanation_id: q.explanationId,
      prompt_id: q.promptId,
    })),
  });

const row = (o: object = {}) => ({
  id: 'r1',
  level: 'PRE',
  week: 3,
  slot: 'A',
  status: 'DRAFT',
  title: 'Monday',
  paragraphs: [
    { en: body, id: 'Rina…' },
    { en: filler, id: '…' },
  ],
  targetWordsUsed: WEEK,
  glossary: [],
  questions,
  wordCount: 170,
  warnings: [],
  createdBy: 'Admin',
  publishedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const access = (o: Partial<AccessContext> = {}): AccessContext =>
  ({
    sessionId: 's',
    tokenId: 't1',
    label: 'Budi',
    role: 'USER',
    menus: ['READING'],
    levels: ['PRE'],
    expiresAt: null,
    aiDailyLimit: 30,
    roleplayDailyLimit: 5,
    ...o,
  }) as AccessContext;

const setup = (
  answer: () => Promise<string | undefined> = () => Promise.resolve(good()),
) => {
  const prisma = {
    readingText: {
      findMany: jest.fn().mockResolvedValue([row()]),
      findUnique: jest.fn().mockResolvedValue(row()),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn((a: { data: object }) => row(a.data)),
      update: jest.fn((a: { data: object }) => row(a.data)),
      delete: jest.fn(),
    },
    wordMeaning: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn((a: { create: object }) => a.create),
      update: jest.fn((a: { data: object }) => ({
        id: 'm1',
        word: 'went',
        level: 'PRE',
        sentence: '',
        lemma: 'go',
        meaningId: 'pergi',
        pron: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...a.data,
      })),
      delete: jest.fn(),
    },
  };
  const gemini = {
    generate: jest.fn(answer),
    failed: (err: unknown) =>
      err instanceof HttpException ? err : new BadGatewayException(),
  };
  return {
    prisma,
    gemini,
    service: new ReadingService(prisma as any, gemini as any),
    lookup: new WordLookupService(prisma as any, gemini as any),
  };
};

describe('ReadingService', () => {
  it('lists only published texts of an allowed level', async () => {
    const { service, prisma } = setup();
    const res = await service.listPublished(access(), 'pre');
    const where = (
      prisma.readingText.findMany.mock.calls[0] as unknown as [
        { where: { OR: { day: null | { gte: Date } }[] } },
      ]
    )[0].where;
    expect(where).toMatchObject({ level: 'PRE', status: 'PUBLISHED' });
    // Weekly texts always; daily ones from 6 days ago (WIB) on.
    const from = (where.OR[1].day as { gte: Date }).gte;
    expect(where.OR[0]).toEqual({ day: null });
    expect((jakartaDay().getTime() - from.getTime()) / 86_400_000).toBe(6);
    expect(res[0]).toMatchObject({ level: 'pre', slot: 'A', status: 'draft' });
    await expect(
      service.listPublished(access(), 'upper'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.listPublished(access({ menus: ['VOCAB'] as never }), 'pre'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('admin list: week 0 means the daily texts, not every week', async () => {
    const { service, prisma } = setup();
    await service.adminList({ level: 'pre', week: 0 });
    const q = prisma.readingText.findMany.mock.calls[0] as unknown as [
      { where: object },
    ];
    expect(q[0].where).toEqual({ level: 'PRE', week: 0 });
  });

  it('generates a draft with its warnings', async () => {
    const { service, prisma, gemini } = setup();
    const res = await service.generate(
      {
        level: 'pre',
        week: 3,
        slot: 'B',
        words: WEEK,
        tense: { name: 'Present simple' },
      },
      'Admin',
    );
    const prompt = gemini.generate.mock.calls[0] as unknown as [string];
    expect(prompt[0]).toContain(
      '200–300 words. Write exactly 6 paragraphs of about 55',
    );
    expect(prompt[0]).toContain('Present simple');
    const data = prisma.readingText.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({
      level: 'PRE',
      week: 3,
      slot: 'B',
      status: 'DRAFT',
    });
    // 170 words is short for slot B: saved anyway, with a warning.
    expect(res.warnings.map((w) => w.code)).toEqual(['word_count']);
  });

  it('maps Gemini failures', async () => {
    const bad = setup(() => Promise.resolve('{"title":""}'));
    await expect(
      bad.service.generate(
        { level: 'pre', week: 1, slot: 'A', words: [] },
        'A',
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
    // Broken twice: one retry, then 502.
    expect(bad.gemini.generate).toHaveBeenCalledTimes(2);
    const off = setup(() => Promise.reject(new ServiceUnavailableException()));
    await expect(
      off.service.generate(
        { level: 'pre', week: 1, slot: 'A', words: [] },
        'A',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // No key: no retry.
    expect(off.gemini.generate).toHaveBeenCalledTimes(1);
    expect(bad.prisma.readingText.create).not.toHaveBeenCalled();
  });

  it('retries once when the first answer is broken', async () => {
    let n = 0;
    const { service } = setup(() =>
      Promise.resolve(n++ === 0 ? '{"title":""}' : good()),
    );
    const res = await service.generate(
      { level: 'pre', week: 3, slot: 'A', words: WEEK },
      'Admin',
    );
    expect(res.title).toBe('Monday');
    expect(n).toBe(2);
  });

  it('re-validates edits and recomputes warnings', async () => {
    const { service, prisma } = setup();
    const res = await service.update('r1', { title: 'New', words: WEEK });
    expect(res.title).toBe('New');
    expect(res.warnings).toEqual([]);
    const data = prisma.readingText.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    // Editing keeps who made the text.
    expect(data).not.toHaveProperty('createdBy');

    const short = await service.update('r1', {
      paragraphs: [{ en: 'Rina is busy.', id: 'Rina sibuk.' }],
    });
    expect(short.warnings.map((w) => w.code)).toContain('word_count');

    await expect(
      service.update('r1', { questions: questions.slice(0, 3) as never }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('editing a daily text keeps it free of length and week-word warnings', async () => {
    const { service, prisma } = setup();
    prisma.readingText.findUnique.mockResolvedValue(
      row({ week: 0, day: new Date('2026-11-23T00:00:00Z'), wordCount: 40 }),
    );
    const res = await service.update('r1', {
      paragraphs: [{ en: 'A short text about busy bees.', id: 'Teks.' }],
    });
    expect(res.warnings).toEqual([]);
  });

  it('one published text per slot: 409 reading_slot_taken', async () => {
    const { service, prisma } = setup();
    prisma.readingText.findUnique.mockResolvedValue(row({ status: 'DRAFT' }));
    prisma.readingText.findFirst.mockResolvedValue({ id: 'other' });
    const err = await service
      .setPublished('r1', true)
      .catch((e: HttpException) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as HttpException).getResponse()).toMatchObject({
      message: 'reading_slot_taken',
    });
  });

  // Daily texts are all week 0 / slot A: only the same day may compete.
  it('the slot check of a daily text looks at its own day only', async () => {
    const { service, prisma } = setup();
    const day = new Date('2026-11-23T00:00:00Z');
    prisma.readingText.findUnique.mockResolvedValue(
      row({ week: 0, day, status: 'DRAFT' }),
    );
    await service.setPublished('r1', true);
    const q = prisma.readingText.findFirst.mock.calls[0] as unknown as [
      { where: object },
    ];
    expect(q[0].where).toMatchObject({ week: 0, slot: 'A', day });
  });

  it('a text with warnings is published only with force', async () => {
    const { service, prisma } = setup();
    prisma.readingText.findUnique.mockResolvedValue(
      row({
        status: 'DRAFT',
        warnings: [{ code: 'word_count', count: 19, min: 150, max: 200 }],
      }),
    );
    const err = await service
      .setPublished('r1', true)
      .catch((e: HttpException) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as HttpException).getResponse()).toMatchObject({
      message: 'reading_has_warnings',
    });
    await expect(service.setPublished('r1', true, true)).resolves.toMatchObject(
      { status: 'published' },
    );
  });

  it('publishes, hides and deletes; 404 when missing', async () => {
    const { service, prisma } = setup();
    expect((await service.setPublished('r1', true)).status).toBe('published');
    expect((await service.setPublished('r1', false)).status).toBe('draft');
    await service.remove('r1');
    expect(prisma.readingText.delete).toHaveBeenCalledWith({
      where: { id: 'r1' },
    });
    prisma.readingText.findUnique.mockResolvedValue(null);
    await expect(service.remove('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WordLookupService', () => {
  const lookupAnswer = () =>
    Promise.resolve(
      JSON.stringify({ lemma: 'Go', meaning_id: 'pergi', pron: 'gou' }),
    );

  it('asks Gemini once on a miss and saves the answer', async () => {
    const { lookup, prisma, gemini } = setup(lookupAnswer);
    const res = await lookup.lookup(access(), {
      word: 'Went',
      level: 'pre',
      sentence: 'She went home.',
    });
    expect(res).toEqual({
      word: 'went',
      lemma: 'go',
      meaningId: 'pergi',
      pron: 'gou',
      cached: false,
    });
    expect(gemini.generate).toHaveBeenCalledTimes(1);
    expect(prisma.wordMeaning.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          word_level_ctx: {
            word: 'went',
            level: 'PRE',
            ctx: sentenceCtx('She went home.'),
          },
        },
        create: {
          word: 'went',
          level: 'PRE',
          ctx: sentenceCtx('She went home.'),
          sentence: 'She went home.',
          lemma: 'go',
          meaningId: 'pergi',
          pron: 'gou',
        },
      }),
    );
  });

  it('serves the cache without Gemini or rate limit', async () => {
    const { lookup, prisma, gemini } = setup(lookupAnswer);
    prisma.wordMeaning.findUnique.mockResolvedValue({
      lemma: 'go',
      meaningId: 'pergi',
      pron: 'gou',
    });
    for (let i = 0; i < LOOKUPS_PER_MIN + 5; i++) {
      const res = await lookup.lookup(access(), { word: 'went', level: 'pre' });
      expect(res.cached).toBe(true);
    }
    expect(gemini.generate).not.toHaveBeenCalled();
  });

  it('rate limits new words per token', async () => {
    const { lookup } = setup(lookupAnswer);
    for (let i = 0; i < LOOKUPS_PER_MIN; i++) {
      await lookup.lookup(access(), {
        word: `w${'a'.repeat(i)}`,
        level: 'pre',
      });
    }
    await expect(
      lookup.lookup(access(), { word: 'another', level: 'pre' }),
    ).rejects.toMatchObject({ status: 429 });
    // Another token is not affected.
    await expect(
      lookup.lookup(access({ tokenId: 't2' }), {
        word: 'another',
        level: 'pre',
      }),
    ).resolves.toMatchObject({ cached: false });
  });

  it('one meaning per sentence: the same word elsewhere is asked again', () => {
    expect(sentenceCtx('She went home.')).toBe(
      sentenceCtx('  she WENT  home. '),
    );
    expect(sentenceCtx('She went home.')).not.toBe(
      sentenceCtx('The light went out.'),
    );
    expect(sentenceCtx('')).toBe('');
    expect(sentenceCtx('x')).toHaveLength(16);
  });

  it('rate limited: falls back to a meaning saved without the sentence', async () => {
    const { lookup, prisma } = setup(lookupAnswer);
    for (let i = 0; i < LOOKUPS_PER_MIN; i++) {
      await lookup.lookup(access(), {
        word: `w${'a'.repeat(i)}`,
        level: 'pre',
        sentence: 'x',
      });
    }
    prisma.wordMeaning.findFirst.mockResolvedValue({
      lemma: 'go',
      meaningId: 'pergi',
      pron: '',
    });
    await expect(
      lookup.lookup(access(), {
        word: 'went',
        level: 'pre',
        sentence: 'She went home.',
      }),
    ).resolves.toMatchObject({ meaningId: 'pergi', cached: true });
  });

  it('admin: corrects and removes a saved meaning', async () => {
    const { lookup, prisma } = setup(lookupAnswer);
    prisma.wordMeaning.findUnique.mockResolvedValue({ id: 'm1' });
    const res = await lookup.adminUpdate('m1', {
      meaningId: ' pergi (lampau) ',
    });
    expect(res).toMatchObject({
      id: 'm1',
      meaningId: 'pergi (lampau)',
      level: 'pre',
    });
    await lookup.adminRemove('m1');
    expect(prisma.wordMeaning.delete).toHaveBeenCalledWith({
      where: { id: 'm1' },
    });
    prisma.wordMeaning.findUnique.mockResolvedValue(null);
    await expect(lookup.adminRemove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('checks menu and level', async () => {
    const { lookup } = setup(lookupAnswer);
    await expect(
      lookup.lookup(access({ levels: ['BEGINNER'] as never }), {
        word: 'go',
        level: 'pre',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ReadingService › Bacaan harian', () => {
  const dailyData = (prisma: ReturnType<typeof setup>['prisma']) =>
    prisma.readingText.create.mock.calls.map(
      (c) => c[0].data as Record<string, unknown>,
    );

  it('publishes one text per level for today, any topic, no week words', async () => {
    const { service, prisma, gemini } = setup();
    prisma.readingText.findMany.mockResolvedValue([{ title: 'Old topic' }]);
    await service.generateDaily();
    const data = dailyData(prisma);
    expect(data.map((d) => d.level)).toEqual([
      'BEGINNER',
      'PRE',
      'INTER',
      'UPPER',
    ]);
    expect(data[0]).toMatchObject({
      week: 0,
      slot: 'A',
      day: jakartaDay(),
      status: 'PUBLISHED',
      createdBy: 'Otomatis',
      // Length and week words don't matter: no warnings kept.
      warnings: [],
    });
    const prompt = (gemini.generate.mock.calls[0] as unknown as [string])[0];
    expect(prompt).toContain('Topic: free');
    expect(prompt).toContain('Old topic');
    expect(prompt).not.toContain('vocabulary (Kosakata)');
  });

  it("skips levels that already have today's text", async () => {
    const { service, prisma, gemini } = setup();
    prisma.readingText.findFirst.mockImplementation(
      (a: { where: { level: string } }) =>
        Promise.resolve(a.where.level === 'PRE' ? { id: 'x' } : null),
    );
    await service.generateDaily();
    expect(dailyData(prisma).map((d) => d.level)).toEqual([
      'BEGINNER',
      'INTER',
      'UPPER',
    ]);
    expect(gemini.generate).toHaveBeenCalledTimes(3);
  });

  it('retries an answer whose find_word is not in the text', async () => {
    let n = 0;
    const missing = () => {
      const o = JSON.parse(good()) as {
        questions: { type: string; answer?: unknown }[];
      };
      o.questions[4].answer = 'zebra';
      return JSON.stringify(o);
    };
    const { service, prisma } = setup(() =>
      Promise.resolve(n++ === 0 ? missing() : good()),
    );
    prisma.readingText.findFirst.mockImplementation(
      (a: { where: { level: string } }) =>
        Promise.resolve(a.where.level === 'PRE' ? null : { id: 'x' }),
    );
    await service.generateDaily();
    expect(n).toBe(2);
    expect(dailyData(prisma)).toHaveLength(1);
  });

  it('a failure or a race on one level does not stop the others', async () => {
    const { service, prisma, gemini } = setup();
    let calls = 0;
    prisma.readingText.create.mockImplementation((a: { data: object }) => {
      if (calls++ === 0)
        throw Object.assign(new Error('dup'), { code: 'P2002' });
      return row(a.data);
    });
    gemini.generate
      .mockRejectedValueOnce(new ServiceUnavailableException())
      .mockImplementation(() => Promise.resolve(good()));
    await expect(service.generateDaily()).resolves.toBeUndefined();
    // BEGINNER: no key (no retry); PRE: lost the race; INTER, UPPER: made.
    expect(prisma.readingText.create).toHaveBeenCalledTimes(3);
  });
});
