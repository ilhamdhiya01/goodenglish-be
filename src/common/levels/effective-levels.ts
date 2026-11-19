import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { Level, ProgressKey } from '../../generated/prisma/enums';
import { LEVEL_WIRE, type LevelWire } from '../token/access-enums';
import type { AccessContext } from '../types/access-context';

// "Wajib lulus ujian": the token's levels only open one by one, through the
// exam of the level before. The app decides this from the learner's own
// progress documents (exam + level); the same rule runs here so a request
// for a level the exams haven't opened yet is refused. It is a guard against
// skipping ahead through the URL, not tamper-proof: the exam document is
// written by the app.

const ORDER: Level[] = [Level.BEGINNER, Level.PRE, Level.INTER, Level.UPPER];
const indexOf = (l: unknown) =>
  typeof l === 'string' && l in LEVEL_WIRE
    ? ORDER.indexOf(LEVEL_WIRE[l as LevelWire])
    : -1;

interface ExamDoc {
  base?: unknown;
  attempts?: { level?: unknown; passed?: unknown }[];
}

/** Same rule as the app's unlockedLevels (exam.helper). */
export const unlockedFrom = (
  allowed: Level[],
  exam: unknown,
  current: unknown,
): Level[] => {
  const e = (exam && typeof exam === 'object' ? exam : {}) as ExamDoc;
  const passed = (Array.isArray(e.attempts) ? e.attempts : [])
    .filter((a) => a && a.passed === true)
    .map((a) => indexOf(a.level))
    .filter((i) => i >= 0);
  // No start level saved yet: the app's default level.
  const start =
    indexOf(e.base) >= 0
      ? indexOf(e.base)
      : indexOf(current) >= 0
        ? indexOf(current)
        : indexOf('pre');
  const top = Math.max(start, ...passed.map((i) => i + 1));
  return allowed.filter((l) => ORDER.indexOf(l) <= top);
};

/** The levels this token may open right now. */
export const effectiveLevels = async (
  prisma: PrismaService,
  access: AccessContext,
): Promise<Level[]> => {
  if (!access.requireExam || access.role === 'ADMIN') return access.levels;
  const docs = await prisma.progressDoc.findMany({
    where: {
      accessTokenId: access.tokenId,
      key: { in: [ProgressKey.EXAM, ProgressKey.LEVEL] },
    },
    select: { key: true, data: true },
  });
  const exam = docs.find((d) => d.key === ProgressKey.EXAM)?.data;
  const level = docs.find((d) => d.key === ProgressKey.LEVEL)?.data;
  return unlockedFrom(access.levels, exam, level);
};

/** 403 level_not_allowed unless the token may open this level now. */
export const assertLevelOpen = async (
  prisma: PrismaService,
  access: AccessContext,
  level: LevelWire,
): Promise<void> => {
  const open = await effectiveLevels(prisma, access);
  if (!open.includes(LEVEL_WIRE[level])) {
    throw new ForbiddenException({
      field: 'level',
      message: 'level_not_allowed',
    });
  }
};
