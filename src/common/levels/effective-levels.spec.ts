import { ForbiddenException } from '@nestjs/common';
import { Level, ProgressKey } from '../../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import type { AccessContext } from '../types/access-context';
import {
  assertLevelOpen,
  effectiveLevels,
  unlockedFrom,
} from './effective-levels';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const ALL = [Level.BEGINNER, Level.PRE, Level.INTER, Level.UPPER];
const attempt = (level: string, passed: boolean) => ({ level, passed });

describe('unlockedFrom', () => {
  it('opens the start level and the one after each passed exam', () => {
    expect(unlockedFrom(ALL, { base: 'pre', attempts: [] }, 'pre')).toEqual([
      Level.BEGINNER,
      Level.PRE,
    ]);
    expect(
      unlockedFrom(
        ALL,
        {
          base: 'pre',
          attempts: [attempt('pre', true), attempt('inter', false)],
        },
        'inter',
      ),
    ).toEqual([Level.BEGINNER, Level.PRE, Level.INTER]);
  });

  it('without a start level uses the current level, else pre', () => {
    expect(unlockedFrom(ALL, null, 'inter')).toHaveLength(3);
    expect(unlockedFrom(ALL, null, null)).toEqual([Level.BEGINNER, Level.PRE]);
  });

  it('never opens a level the token lacks', () => {
    expect(
      unlockedFrom([Level.PRE], { attempts: [attempt('pre', true)] }, 'pre'),
    ).toEqual([Level.PRE]);
  });
});

describe('effectiveLevels', () => {
  const access = (o: Partial<AccessContext> = {}) =>
    ({
      tokenId: 't',
      role: 'LEARNER',
      levels: ALL,
      requireExam: true,
      ...o,
    }) as AccessContext;
  const prismaWith = (docs: { key: ProgressKey; data: unknown }[]) =>
    ({
      progressDoc: { findMany: jest.fn().mockResolvedValue(docs) },
    }) as unknown as PrismaService;

  it('without "Wajib lulus ujian" every level of the token', async () => {
    const prisma = prismaWith([]);
    await expect(
      effectiveLevels(prisma, access({ requireExam: false })),
    ).resolves.toEqual(ALL);
  });

  it('reads the exam and level documents', async () => {
    const prisma = prismaWith([
      { key: ProgressKey.EXAM, data: { base: 'beginner', attempts: [] } },
      { key: ProgressKey.LEVEL, data: 'beginner' },
    ]);
    await expect(effectiveLevels(prisma, access())).resolves.toEqual([
      Level.BEGINNER,
    ]);
    await expect(
      assertLevelOpen(prisma, access(), 'upper'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      assertLevelOpen(prisma, access(), 'beginner'),
    ).resolves.toBeUndefined();
  });
});
