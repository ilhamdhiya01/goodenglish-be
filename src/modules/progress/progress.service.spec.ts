import { ConflictException, HttpException } from '@nestjs/common';
import { ProgressKey } from '../../generated/prisma/enums';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { ProgressService } from './progress.service';

jest.mock('../../generated/prisma/client', () => ({ Prisma: {} }));
jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

const at = (ms: number) => new Date(ms);

const setup = () => {
  const progressDoc = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  };
  const service = new ProgressService({
    progressDoc,
  } as unknown as PrismaService);
  return { service, progressDoc };
};

describe('ProgressService', () => {
  it('returns docs with their versions', async () => {
    const { service, progressDoc } = setup();
    progressDoc.findMany.mockResolvedValue([
      { key: ProgressKey.KNOWN, data: { a: 1 }, updatedAt: at(1000) },
      { key: ProgressKey.PLAN, data: {}, updatedAt: at(2000) },
    ]);
    await expect(service.getAllWithVersions('t')).resolves.toEqual({
      docs: { known: { a: 1 }, plan: {} },
      versions: { known: 1000, plan: 2000 },
    });
    await expect(service.getAll('t')).resolves.toEqual({
      known: { a: 1 },
      plan: {},
    });
  });

  it('reads one doc; a missing doc has version null', async () => {
    const { service, progressDoc } = setup();
    progressDoc.findUnique.mockResolvedValueOnce({
      data: [1],
      updatedAt: at(5),
    });
    await expect(service.getOne('t', 'exam')).resolves.toEqual({
      data: [1],
      version: 5,
    });
    progressDoc.findUnique.mockResolvedValueOnce(null);
    await expect(service.getOne('t', 'exam')).resolves.toEqual({
      data: null,
      version: null,
    });
  });

  it('without baseVersion it overwrites (older clients)', async () => {
    const { service, progressDoc } = setup();
    progressDoc.upsert.mockResolvedValue({ updatedAt: at(9) });
    await expect(service.put('t', 'known', { a: 1 })).resolves.toEqual({
      version: 9,
    });
    expect(progressDoc.updateMany).not.toHaveBeenCalled();
  });

  it('saves when the server still holds the base version', async () => {
    const { service, progressDoc } = setup();
    progressDoc.updateMany.mockResolvedValue({ count: 1 });
    const { version } = await service.put('t', 'srs', { x: 1 }, 1000);
    expect(version).toBeGreaterThan(1000);
    expect(progressDoc.updateMany).toHaveBeenCalledWith({
      where: { accessTokenId: 't', key: ProgressKey.SRS, updatedAt: at(1000) },
      data: { data: { x: 1 }, updatedAt: at(version) },
    });
  });

  it('a later version even when the base is in the future (clock skew)', async () => {
    const { service, progressDoc } = setup();
    progressDoc.updateMany.mockResolvedValue({ count: 1 });
    const base = Date.now() + 60_000;
    await expect(service.put('t', 'srs', {}, base)).resolves.toEqual({
      version: base + 1,
    });
  });

  it('409 progress_conflict when another device saved in between', async () => {
    const { service, progressDoc } = setup();
    progressDoc.updateMany.mockResolvedValue({ count: 0 });
    const err = await service
      .put('t', 'srs', {}, 1000)
      .catch((e: HttpException) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as HttpException).getResponse()).toEqual({
      field: 'baseVersion',
      message: 'progress_conflict',
    });
  });

  it('baseVersion null creates, and conflicts when the doc already exists', async () => {
    const { service, progressDoc } = setup();
    progressDoc.create.mockResolvedValueOnce({ updatedAt: at(3) });
    await expect(service.put('t', 'plan', {}, null)).resolves.toEqual({
      version: 3,
    });
    progressDoc.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 'P2002' }),
    );
    await expect(service.put('t', 'plan', {}, null)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
