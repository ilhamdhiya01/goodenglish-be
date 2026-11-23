import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AccessContext } from '../../common/types/access-context';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { GeminiJsonService } from '../ai/gemini-json.service';
import { weeklyOrRecent } from '../../common/daily-content';
import { jakartaDay } from '../ai/ai-quota.service';
import { ListeningService } from './listening.service';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../ai/gemini-json.service', () => ({ GeminiJsonService: class {} }));

const text = (n: number) =>
  Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const good = (type: 'dialog' | 'monolog' = 'dialog') =>
  JSON.stringify({
    title: 'At the station',
    type,
    lines:
      type === 'dialog'
        ? [
            { speaker: 'A', text: text(30) },
            { speaker: 'B', text: text(30) },
          ]
        : [{ speaker: 'A', text: text(60) }],
    questions: [1, 2, 3].map(() => ({
      question: 'When does it leave?',
      options: ['At 9', 'At 10', 'At 11', 'At 12'],
      answer_index: 1,
      explanation_id: 'Disebut "ten o\'clock".',
    })),
  });

const row = (o: object = {}) => ({
  id: 'i1',
  level: 'PRE',
  week: 3,
  status: 'DRAFT',
  type: 'DIALOG',
  title: 'At the station',
  lines: [
    { speaker: 'A', text: text(30) },
    { speaker: 'B', text: text(30) },
  ],
  questions: [1, 2, 3].map(() => ({
    question: 'Q?',
    options: ['a', 'b', 'c', 'd'],
    answerIndex: 1,
    explanationId: 'Karena…',
  })),
  wordCount: 60,
  createdBy: 'Admin',
  publishedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const access = (menus = ['LISTENING'], levels = ['PRE']) =>
  ({
    tokenId: 't1',
    menus,
    levels,
    label: 'Pelajar',
  }) as unknown as AccessContext;

const setup = (opts: { key?: boolean; replies?: (string | Error)[] } = {}) => {
  const prisma = {
    listeningItem: {
      findMany: jest.fn().mockResolvedValue([row({ status: 'PUBLISHED' })]),
      findUnique: jest.fn().mockResolvedValue(row()),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: { data: object }) =>
        Promise.resolve(row(data)),
      ),
      update: jest.fn(({ data }: { data: object }) =>
        Promise.resolve(row(data)),
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  const replies = [...(opts.replies ?? [good()])];
  const gemini = {
    client: jest.fn(() =>
      opts.key === false
        ? Promise.reject(
            new ServiceUnavailableException({ message: 'ai_unavailable' }),
          )
        : Promise.resolve({}),
    ),
    generate: jest.fn(() => {
      const r = replies.shift() ?? good();
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    }),
    failed: jest.fn((e: unknown) =>
      e instanceof ServiceUnavailableException
        ? e
        : new BadGatewayException({ message: 'ai_failed' }),
    ),
  };
  const service = new ListeningService(
    prisma as unknown as PrismaService,
    gemini as unknown as GeminiJsonService,
  );
  return { service, prisma, gemini };
};

const gen = (o: object = {}) => ({
  level: 'pre' as const,
  week: 3,
  words: ['station', 'ticket', 'platform'],
  tense: { name: 'Past simple' },
  ...o,
});

describe('ListeningService', () => {
  describe('learner list', () => {
    it('returns only published items of an allowed level', async () => {
      const { service, prisma } = setup();
      const items = await service.listPublished(access(), 'pre');
      expect(prisma.listeningItem.findMany.mock.calls[0][0].where).toEqual({
        level: 'PRE',
        status: 'PUBLISHED',
        // Weekly items always; daily ones of the last 7 WIB days.
        ...weeklyOrRecent(),
      });
      expect(items[0]).toMatchObject({
        level: 'pre',
        status: 'published',
        type: 'dialog',
      });
    });

    it('refuses tokens without the menu or the level', async () => {
      await expect(
        setup().service.listPublished(access(['VOCAB']), 'pre'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        setup().service.listPublished(access(), 'upper'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('generate', () => {
    it('saves each generated item as a DRAFT with the admin label', async () => {
      const { service, prisma, gemini } = setup({
        replies: [good(), good('monolog')],
      });
      const r = await service.generate(
        gen({ count: 2, type: 'mixed' }),
        'Admin',
      );
      expect(gemini.generate).toHaveBeenCalledTimes(2);
      const instr = (gemini.generate.mock.calls as unknown as string[][]).map(
        (c) => c[0],
      );
      expect(instr[0]).toContain('dialogue');
      expect(instr[1]).toContain('monologue');
      expect(instr[0]).toContain('station, ticket, platform');
      expect(instr[0]).toContain('Past simple');
      expect(instr[0]).toContain('never force a vocabulary word');
      expect(instr[1]).toContain('3–6 lines');
      expect(r.failed).toBe(0);
      expect(r.items).toHaveLength(2);
      expect(prisma.listeningItem.create.mock.calls[0][0].data).toMatchObject({
        level: 'PRE',
        week: 3,
        status: 'DRAFT',
        createdBy: 'Admin',
        wordCount: 60,
      });
    });

    it('keeps the good items when one fails, and reports the failures', async () => {
      const { service, prisma } = setup({
        replies: [good(), '{"title":"x"}', new Error('timeout')],
      });
      const r = await service.generate(gen({ count: 3 }), 'Admin');
      expect(r.items).toHaveLength(1);
      expect(r.failed).toBe(2);
      expect(prisma.listeningItem.create).toHaveBeenCalledTimes(1);
    });

    it('is 502 when every item fails, 503 without a key', async () => {
      await expect(
        setup({ replies: ['nope'] }).service.generate(gen(), 'Admin'),
      ).rejects.toBeInstanceOf(BadGatewayException);
      const noKey = setup({ key: false });
      await expect(
        noKey.service.generate(gen(), 'Admin'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(noKey.gemini.generate).not.toHaveBeenCalled();
    });
  });

  describe('admin edit, publish, delete', () => {
    it('validates the edited content as a whole', async () => {
      const { service, prisma } = setup();
      await service.update('i1', { title: 'New title', week: 4 });
      expect(prisma.listeningItem.update.mock.calls[0][0].data).toMatchObject({
        title: 'New title',
        week: 4,
        wordCount: 60,
      });
      // Editing keeps who made it.
      expect(
        prisma.listeningItem.update.mock.calls[0][0].data,
      ).not.toHaveProperty('createdBy');
      await expect(
        service.update('i1', { lines: [{ speaker: 'A', text: 'too short' }] }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('publishes and unpublishes', async () => {
      const { service, prisma } = setup();
      await service.setPublished('i1', true);
      expect(prisma.listeningItem.update.mock.calls[0][0].data).toMatchObject({
        status: 'PUBLISHED',
      });
      await service.setPublished('i1', false);
      expect(prisma.listeningItem.update.mock.calls[1][0].data).toEqual({
        status: 'DRAFT',
        publishedAt: null,
      });
    });

    it('404s on an unknown item', async () => {
      const { service, prisma } = setup();
      prisma.listeningItem.findUnique.mockResolvedValue(null);
      await expect(service.remove('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

describe('ListeningService › Menyimak harian', () => {
  it('admin list: week 0 means the daily items, not every week', async () => {
    const { service, prisma } = setup();
    await service.adminList({ level: 'pre', week: 0 });
    expect(prisma.listeningItem.findMany.mock.calls[0][0].where).toEqual({
      level: 'PRE',
      week: 0,
    });
  });

  const made = (prisma: ReturnType<typeof setup>['prisma']) =>
    prisma.listeningItem.create.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
  // Gemini answers the type it was asked for.
  const byType = (gemini: ReturnType<typeof setup>['gemini']) =>
    gemini.generate.mockImplementation(((instruction: string) =>
      Promise.resolve(
        good(instruction.includes('monologue:') ? 'monolog' : 'dialog'),
      )) as never);

  it('publishes a dialog and a monolog per level for today, any topic', async () => {
    const { service, prisma, gemini } = setup();
    byType(gemini);
    prisma.listeningItem.findMany.mockResolvedValue([{ title: 'Old one' }]);
    await service.generateDaily();
    const data = made(prisma);
    expect(data.map((d) => `${d.level as string} ${d.type as string}`)).toEqual(
      [
        'BEGINNER DIALOG',
        'BEGINNER MONOLOG',
        'PRE DIALOG',
        'PRE MONOLOG',
        'INTER DIALOG',
        'INTER MONOLOG',
        'UPPER DIALOG',
        'UPPER MONOLOG',
      ],
    );
    expect(data[0]).toMatchObject({
      week: 0,
      day: jakartaDay(),
      status: 'PUBLISHED',
      createdBy: 'Otomatis',
    });
    const prompt = (gemini.generate.mock.calls[0] as unknown as [string])[0];
    expect(prompt).toContain('Topic: free');
    expect(prompt).toContain('Old one');
    expect(prompt).not.toContain('vocabulary to use');
  });

  it('skips what today already has; a wrong type is asked again', async () => {
    const { service, prisma, gemini } = setup({
      // Asked for a dialog, got a monolog first.
      replies: [good('monolog'), good('dialog')],
    });
    prisma.listeningItem.findFirst.mockImplementation(((a: {
      where: { level: string; type: string };
    }) =>
      Promise.resolve(
        a.where.level === 'PRE' && a.where.type === 'DIALOG'
          ? null
          : { id: 'x' },
      )) as never);
    await service.generateDaily();
    expect(gemini.generate).toHaveBeenCalledTimes(2);
    expect(made(prisma)).toEqual([
      expect.objectContaining({ level: 'PRE', type: 'DIALOG' }),
    ]);
  });

  it('a failure or a race on one item does not stop the others', async () => {
    const { service, prisma, gemini } = setup();
    byType(gemini);
    gemini.generate.mockRejectedValueOnce(new ServiceUnavailableException());
    let calls = 0;
    prisma.listeningItem.create.mockImplementation(
      ({ data }: { data: object }) => {
        if (calls++ === 0)
          return Promise.reject(
            Object.assign(new Error('dup'), { code: 'P2002' }),
          );
        return Promise.resolve(row(data));
      },
    );
    await expect(service.generateDaily()).resolves.toBeUndefined();
    // BEGINNER dialog: no key; BEGINNER monolog: lost the race; 6 made.
    expect(prisma.listeningItem.create).toHaveBeenCalledTimes(7);
  });
});
