import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { AiConversationsService, titleOf } from './ai-conversations.service';

jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

const setup = () => {
  const prisma = {
    aiConversation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'c-new' }),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const service = new AiConversationsService(
    prisma as unknown as PrismaService,
  );
  return { service, prisma };
};

const firstArg = (fn: jest.Mock) => fn.mock.calls[0][0] as Record<string, any>;

describe('AiConversationsService', () => {
  it('starts a new thread titled after the first question', async () => {
    const { service, prisma } = setup();
    const id = await service.saveQuestion(
      't1',
      undefined,
      'What is a lesson?',
      {
        word: 'lesson',
        meaning: 'pelajaran',
      },
    );

    expect(id).toBe('c-new');
    const args = firstArg(prisma.aiConversation.create);
    expect(args.data).toMatchObject({
      accessTokenId: 't1',
      title: 'What is a lesson?',
      messages: {
        create: {
          role: 'USER',
          text: 'What is a lesson?',
          word: 'lesson',
          wordMeaning: 'pelajaran',
        },
      },
    });
    expect(prisma.aiConversation.update).not.toHaveBeenCalled();
  });

  it('adds to an existing thread and bumps its updatedAt', async () => {
    const { service, prisma } = setup();
    const id = await service.saveQuestion('t1', 'c1', 'And "class"?');

    expect(id).toBe('c1');
    expect(prisma.aiConversation.create).not.toHaveBeenCalled();
    const args = firstArg(prisma.aiConversation.update);
    expect(args.where).toEqual({ id: 'c1' });
    expect(args.data.updatedAt).toBeInstanceOf(Date);
    expect(args.data.messages.create).toMatchObject({
      role: 'USER',
      text: 'And "class"?',
    });
  });

  it('stores the answer as a MODEL message', async () => {
    const { service, prisma } = setup();
    await service.saveAnswer('c1', 'Class is ...');
    expect(firstArg(prisma.aiConversation.update).data.messages.create).toEqual(
      { role: 'MODEL', text: 'Class is ...' },
    );
  });

  it("treats another token's thread as missing", async () => {
    const { service, prisma } = setup();
    prisma.aiConversation.findFirst.mockResolvedValue(null);

    await expect(service.assertOwned('t1', 'c9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.get('t1', 'c9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    for (const call of prisma.aiConversation.findFirst.mock.calls) {
      expect((call[0] as { where: unknown }).where).toEqual({
        id: 'c9',
        accessTokenId: 't1',
      });
    }
  });

  it('maps stored messages back to wire roles and word chips', async () => {
    const { service, prisma } = setup();
    const at = new Date();
    prisma.aiConversation.findFirst.mockResolvedValue({
      id: 'c1',
      title: 'Hi',
      updatedAt: at,
      messages: [
        {
          id: 'm1',
          role: 'USER',
          text: 'Hi',
          word: 'lesson',
          wordMeaning: null,
          createdAt: at,
        },
        {
          id: 'm2',
          role: 'MODEL',
          text: 'Hello',
          word: null,
          wordMeaning: null,
          createdAt: at,
        },
      ],
    });

    const conv = await service.get('t1', 'c1');
    expect(conv.messages.map((m) => [m.role, m.word])).toEqual([
      ['user', { word: 'lesson', meaning: undefined }],
      ['model', undefined],
    ]);
  });

  it('deletes only within the token and 404s when nothing matched', async () => {
    const { service, prisma } = setup();
    prisma.aiConversation.deleteMany.mockResolvedValueOnce({ count: 1 });
    await service.remove('t1', 'c1');
    expect(firstArg(prisma.aiConversation.deleteMany).where).toEqual({
      id: 'c1',
      accessTokenId: 't1',
    });

    prisma.aiConversation.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove('t1', 'c2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('titleOf', () => {
  it('keeps one line and cuts long questions', () => {
    expect(titleOf('  What is\n\na  lesson? ')).toBe('What is a lesson?');
    const long = titleOf('x'.repeat(200));
    expect(long).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
  });
});
