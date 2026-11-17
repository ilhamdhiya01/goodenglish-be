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
      await service.update('i1', { title: 'New title', week: 4 }, 'Admin');
      expect(prisma.listeningItem.update.mock.calls[0][0].data).toMatchObject({
        title: 'New title',
        week: 4,
        wordCount: 60,
      });
      await expect(
        service.update(
          'i1',
          { lines: [{ speaker: 'A', text: 'too short' }] },
          'Admin',
        ),
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
