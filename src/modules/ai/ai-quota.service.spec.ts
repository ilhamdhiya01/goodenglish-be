import { HttpException, HttpStatus } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { AiQuotaService, jakartaDay } from './ai-quota.service';

jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

const setup = (countAfterIncrement: number) => {
  const prisma = {
    aiUsage: {
      upsert: jest.fn().mockResolvedValue({ count: countAfterIncrement }),
      updateMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({ count: 7 }),
    },
  };
  const service = new AiQuotaService(prisma as unknown as PrismaService);
  return { service, prisma };
};

describe('AiQuotaService', () => {
  it('lets the question through while under the limit', async () => {
    const { service, prisma } = setup(30);
    await service.consume('t1', 30);
    const args = prisma.aiUsage.upsert.mock.calls[0][0] as {
      create: { accessTokenId: string; count: number };
      update: unknown;
    };
    expect(args.update).toEqual({ count: { increment: 1 } });
    expect(args.create).toMatchObject({ accessTokenId: 't1', count: 1 });
    expect(prisma.aiUsage.updateMany).not.toHaveBeenCalled();
  });

  it('answers 429 past the limit and undoes the increment', async () => {
    const { service, prisma } = setup(31);
    const err = await service.consume('t1', 30).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(prisma.aiUsage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { count: { decrement: 1 } } }),
    );
  });

  it('a limit of 0 blocks the very first question', async () => {
    const { service } = setup(1);
    await expect(service.consume('t1', 0)).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('counts but never refuses an unlimited token', async () => {
    const { service, prisma } = setup(5000);
    await service.consume('t1', null);
    expect(prisma.aiUsage.upsert).toHaveBeenCalled();
    expect(prisma.aiUsage.updateMany).not.toHaveBeenCalled();
  });

  it('reports today’s usage against the token’s limit', async () => {
    const { service } = setup(0);
    await expect(service.usage('t1', 30)).resolves.toMatchObject({
      used: 7,
      limit: 30,
    });
    await expect(service.usage('t1', null)).resolves.toMatchObject({
      used: 7,
      limit: null,
    });
  });
});

describe('jakartaDay', () => {
  it('rolls over at midnight WIB, not UTC', () => {
    // 2026-11-10 17:30 UTC = 2026-11-11 00:30 WIB
    expect(jakartaDay(new Date('2026-11-10T17:30:00Z')).toISOString()).toBe(
      '2026-11-11T00:00:00.000Z',
    );
    // 2026-11-10 16:30 UTC = 2026-11-10 23:30 WIB
    expect(jakartaDay(new Date('2026-11-10T16:30:00Z')).toISOString()).toBe(
      '2026-11-10T00:00:00.000Z',
    );
  });
});
