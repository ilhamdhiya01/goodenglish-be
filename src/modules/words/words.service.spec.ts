import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AccessContext } from '../../common/types/access-context';
import { WordsService } from './words.service';

// Same approach as admin-tokens.service.spec: DB-bound modules are mocked out
// and the service is constructed with a hand-made Prisma fake.
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../../generated/prisma/client', () => ({}));

const word = {
  id: 'w1',
  level: 'PRE',
  week: 3,
  type: 'pv',
  en: 'run into',
  meaning: 'tidak sengaja bertemu',
  pron: '',
  example: '',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const setup = (clash: object | null = null) => {
  const prisma = {
    sharedWord: {
      findMany: jest.fn().mockResolvedValue([word]),
      findUnique: jest.fn().mockResolvedValue(word),
      findFirst: jest.fn().mockResolvedValue(clash),
      create: jest.fn((args: { data: object }) => ({ ...word, ...args.data })),
      update: jest.fn((args: { data: object }) => ({ ...word, ...args.data })),
      delete: jest.fn(),
    },
  };
  return { service: new WordsService(prisma as any), prisma };
};

const access = (
  role: AccessContext['role'],
  levels: AccessContext['levels'] = [],
) => ({ role, levels }) as AccessContext;

describe('WordsService', () => {
  it('limits learners to their levels and gives admins everything', async () => {
    const { service, prisma } = setup();
    const res = await service.listFor(access('LEARNER', ['PRE']));
    expect(prisma.sharedWord.findMany.mock.calls[0][0].where).toEqual({
      level: { in: ['PRE'] },
    });
    expect(res[0]).toMatchObject({ id: 'w1', level: 'pre' });

    await service.listFor(access('ADMIN'));
    expect(prisma.sharedWord.findMany.mock.calls[1][0].where).toEqual({});
  });

  it('creates a trimmed word with the level mapped to the DB enum', async () => {
    const { service, prisma } = setup();
    await service.create({
      level: 'inter',
      week: 2,
      type: 'w',
      en: '  Bargain ',
      meaning: ' tawar ',
    });
    expect(prisma.sharedWord.create.mock.calls[0][0].data).toEqual({
      level: 'INTER',
      week: 2,
      type: 'w',
      en: 'Bargain',
      meaning: 'tawar',
      pron: '',
      example: '',
    });
  });

  it('rejects a spelling that already exists in the level', async () => {
    const { service } = setup({ id: 'other' });
    await expect(
      service.create({
        level: 'pre',
        week: 1,
        type: 'w',
        en: 'Run Into',
        meaning: 'x',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('skips the duplicate check when neither level nor spelling changes', async () => {
    const { service, prisma } = setup({ id: 'other' });
    await service.update('w1', {
      meaning: 'bertemu kebetulan',
      en: 'Run into',
    });
    expect(prisma.sharedWord.findFirst).not.toHaveBeenCalled();
  });

  it('404s on an unknown word', async () => {
    const { service, prisma } = setup();
    prisma.sharedWord.findUnique.mockResolvedValue(null);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
