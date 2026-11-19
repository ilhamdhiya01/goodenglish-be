import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import {
  PROGRESS_KEY_WIRE,
  progressKeyToWire,
  ProgressKeyWire,
  type ProgressMap,
} from './progress-keys';

export type { ProgressMap };

/** Version of every progress doc of one token (`updatedAt` in ms). */
export type ProgressVersions = Partial<Record<ProgressKeyWire, number>>;

export interface ProgressDocWithVersion {
  data: unknown;
  /** null when the token has no document for this key yet. */
  version: number | null;
}

export const progressConflict = () =>
  new ConflictException({ field: 'baseVersion', message: 'progress_conflict' });

// Prisma's unique-constraint error (checked by code so tests need no client).
const isUniqueViolation = (e: unknown) =>
  (e as { code?: unknown } | null)?.code === 'P2002';

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(tokenId: string): Promise<ProgressMap> {
    return (await this.getAllWithVersions(tokenId)).docs;
  }

  async getAllWithVersions(
    tokenId: string,
  ): Promise<{ docs: ProgressMap; versions: ProgressVersions }> {
    const rows = await this.prisma.progressDoc.findMany({
      where: { accessTokenId: tokenId },
      select: { key: true, data: true, updatedAt: true },
    });
    const docs: ProgressMap = {};
    const versions: ProgressVersions = {};
    for (const row of rows) {
      const wire = progressKeyToWire(row.key);
      docs[wire] = row.data;
      versions[wire] = row.updatedAt.getTime();
    }
    return { docs, versions };
  }

  async getOne(
    tokenId: string,
    key: ProgressKeyWire,
  ): Promise<ProgressDocWithVersion> {
    const row = await this.prisma.progressDoc.findUnique({
      where: {
        accessTokenId_key: {
          accessTokenId: tokenId,
          key: PROGRESS_KEY_WIRE[key],
        },
      },
      select: { data: true, updatedAt: true },
    });
    return row
      ? { data: row.data, version: row.updatedAt.getTime() }
      : { data: null, version: null };
  }

  /**
   * Saves the whole document. With `baseVersion` it is a compare-and-set:
   * the write only lands when the server still holds the version the client
   * started from, so two devices can't silently overwrite each other (the
   * loser gets 409 and merges). Without it, last write wins (older clients).
   * Returns the new version.
   */
  async put(
    tokenId: string,
    key: ProgressKeyWire,
    data: unknown,
    baseVersion?: number | null,
  ): Promise<{ version: number }> {
    const value = data as Prisma.InputJsonValue;
    const where = {
      accessTokenId_key: {
        accessTokenId: tokenId,
        key: PROGRESS_KEY_WIRE[key],
      },
    };

    if (baseVersion === undefined) {
      const row = await this.prisma.progressDoc.upsert({
        where,
        create: {
          accessTokenId: tokenId,
          key: PROGRESS_KEY_WIRE[key],
          data: value,
        },
        update: { data: value },
        select: { updatedAt: true },
      });
      return { version: row.updatedAt.getTime() };
    }

    if (baseVersion === null) {
      try {
        const row = await this.prisma.progressDoc.create({
          data: {
            accessTokenId: tokenId,
            key: PROGRESS_KEY_WIRE[key],
            data: value,
          },
          select: { updatedAt: true },
        });
        return { version: row.updatedAt.getTime() };
      } catch (e) {
        if (isUniqueViolation(e)) throw progressConflict();
        throw e;
      }
    }

    // The new version is always later than the base, even within the same
    // millisecond, so every successful write gets its own version. The
    // conditional update is atomic: of two writers on the same base, only
    // one matches.
    const next = new Date(Math.max(Date.now(), baseVersion + 1));
    const { count } = await this.prisma.progressDoc.updateMany({
      where: {
        accessTokenId: tokenId,
        key: PROGRESS_KEY_WIRE[key],
        updatedAt: new Date(baseVersion),
      },
      data: { data: value, updatedAt: next },
    });
    if (count === 0) throw progressConflict();
    return { version: next.getTime() };
  }
}
