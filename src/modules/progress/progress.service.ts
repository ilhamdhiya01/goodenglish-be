import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import {
  PROGRESS_KEY_WIRE,
  progressKeyToWire,
  ProgressKeyWire,
} from './progress-keys';

export type ProgressMap = Partial<Record<ProgressKeyWire, unknown>>;

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(tokenId: string): Promise<ProgressMap> {
    const docs = await this.prisma.progressDoc.findMany({
      where: { accessTokenId: tokenId },
      select: { key: true, data: true },
    });
    const out: ProgressMap = {};
    for (const doc of docs) out[progressKeyToWire(doc.key)] = doc.data;
    return out;
  }

  // Whole-document last-write-wins: the client always sends the full value
  // its store holds for this key.
  async put(
    tokenId: string,
    key: ProgressKeyWire,
    data: unknown,
  ): Promise<void> {
    const value = data as Prisma.InputJsonValue;
    await this.prisma.progressDoc.upsert({
      where: {
        accessTokenId_key: {
          accessTokenId: tokenId,
          key: PROGRESS_KEY_WIRE[key],
        },
      },
      create: {
        accessTokenId: tokenId,
        key: PROGRESS_KEY_WIRE[key],
        data: value,
      },
      update: { data: value },
    });
  }
}
