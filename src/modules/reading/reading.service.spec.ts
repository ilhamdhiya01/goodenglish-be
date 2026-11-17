import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AccessContext } from '../../common/types/access-context';
import { ReadingService } from './reading.service';
import { WordLookupService, LOOKUPS_PER_MIN } from './word-lookup.service';

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
      create: jest.fn((a: { data: object }) => row(a.data)),
      update: jest.fn((a: { data: object }) => row(a.data)),
      delete: jest.fn(),
    },
    wordMeaning: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn((a: { create: object }) => a.create),
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
    expect(prisma.readingText.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { level: 'PRE', status: 'PUBLISHED' } }),
    );
    expect(res[0]).toMatchObject({ level: 'pre', slot: 'A', status: 'draft' });
    await expect(
      service.listPublished(access(), 'upper'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.listPublished(access({ menus: ['VOCAB'] as never }), 'pre'),
    ).rejects.toThrow(ForbiddenException);
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
    const res = await service.update('r1', { title: 'New', words: WEEK }, 'Ed');
    expect(res.title).toBe('New');
    expect(res.warnings).toEqual([]);
    const data = prisma.readingText.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.createdBy).toBe('Ed');

    const short = await service.update(
      'r1',
      { paragraphs: [{ en: 'Rina is busy.', id: 'Rina sibuk.' }] },
      'Ed',
    );
    expect(short.warnings.map((w) => w.code)).toContain('word_count');

    await expect(
      service.update('r1', { questions: questions.slice(0, 3) as never }, 'Ed'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
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
        where: { word_level: { word: 'went', level: 'PRE' } },
        create: {
          word: 'went',
          level: 'PRE',
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
