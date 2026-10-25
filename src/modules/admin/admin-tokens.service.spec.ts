import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AdminTokensService } from './admin-tokens.service';

// ESM-only / DB-bound modules are mocked out, same as critiq's specs:
// the class under test is constructed directly with hand-made fakes.
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../../generated/prisma/client', () => ({ Prisma: {} }));
const admin = {
  id: 'adm1',
  label: 'Ilham',
  tokenPrefix: 'ge_xxxx',
  role: 'ADMIN',
  menus: [],
  levels: [],
  maxDevices: 5,
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  createdAt: new Date(),
};

const setup = (otherAdmins = 0) => {
  const prisma = {
    accessToken: {
      findUnique: jest.fn().mockResolvedValue(admin),
      count: jest.fn().mockResolvedValue(otherAdmins),
      create: jest.fn((args: { data: object }) => ({ ...admin, ...args.data })),
      update: jest.fn((args: { data: object }) => ({ ...admin, ...args.data })),
      delete: jest.fn(),
    },
    tokenSession: {
      updateMany: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  return { service: new AdminTokensService(prisma as any), prisma };
};

describe('AdminTokensService', () => {
  it('stores only the hash and returns the plaintext once', async () => {
    const { service, prisma } = setup();
    const res = await service.create({
      label: ' Budi ',
      menus: ['vocab'],
      levels: ['beginner'],
      maxDevices: 2,
    });

    const data = prisma.accessToken.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(res.token).toMatch(/^ge_/);
    expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain(res.token);
    expect(data).toMatchObject({
      label: 'Budi',
      role: 'LEARNER',
      menus: ['VOCAB'],
      levels: ['BEGINNER'],
    });
  });

  it('requires at least one menu and level for learners', async () => {
    const { service } = setup();
    await expect(
      service.create({ label: 'X', menus: [], levels: ['pre'], maxDevices: 1 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.create({
        label: 'X',
        menus: ['vocab'],
        levels: [],
        maxDevices: 1,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('never revokes, deletes or demotes the last active admin', async () => {
    const { service } = setup(0);
    await expect(service.revoke('adm1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.remove('adm1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(
      service.update('adm1', {
        role: 'learner',
        menus: ['vocab'],
        levels: ['pre'],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('allows it when another admin remains, and signs every device out', async () => {
    const { service, prisma } = setup(1);
    await service.revoke('adm1');
    expect(prisma.tokenSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accessTokenId: 'adm1', revokedAt: null },
      }),
    );
  });

  it('404s on an unknown token', async () => {
    const { service, prisma } = setup();
    prisma.accessToken.findUnique.mockResolvedValue(null);
    await expect(service.summary('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
