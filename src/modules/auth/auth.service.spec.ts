import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { hashAccessToken } from '../../common/token/access-token.util';
import { AuthService } from './auth.service';

// ESM-only / DB-bound modules are mocked out, same as critiq's specs:
// the class under test is constructed directly with hand-made fakes.
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('@nestjs/jwt', () => ({ JwtService: class {} }));
jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../../generated/prisma/client', () => ({ Prisma: {} }));
const PLAIN = 'ge_plain-token-for-tests';

const makeToken = (over: Record<string, unknown> = {}) => ({
  id: 'tok1',
  label: 'Budi',
  tokenHash: hashAccessToken(PLAIN),
  role: 'LEARNER',
  menus: ['VOCAB'],
  levels: ['BEGINNER'],
  maxDevices: 2,
  expiresAt: null,
  revokedAt: null,
  ...over,
});

const setup = (token: unknown, activeSessions = 0) => {
  const tx = {
    tokenSession: {
      updateMany: jest.fn(),
      count: jest.fn().mockResolvedValue(activeSessions),
      create: jest.fn().mockResolvedValue({ id: 'sess1' }),
    },
    accessToken: { update: jest.fn() },
  };
  const prisma = {
    accessToken: { findUnique: jest.fn().mockResolvedValue(token) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('signed.jwt'),
    verifyAsync: jest.fn(),
  };
  const config = { getOrThrow: jest.fn().mockReturnValue(30) };
  const service = new AuthService(prisma as any, jwt as any, config as any);
  return { service, prisma, tx, jwt };
};

describe('AuthService.redeem', () => {
  it('looks the token up by its hash and opens a session', async () => {
    const { service, prisma, tx, jwt } = setup(makeToken());

    const res = await service.redeem(PLAIN, 'Chrome');

    expect(prisma.accessToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashAccessToken(PLAIN) },
    });
    expect(tx.tokenSession.create).toHaveBeenCalled();
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { sub: 'sess1', tokenId: 'tok1' },
      { expiresIn: '30d' },
    );
    expect(res.jwt).toBe('signed.jwt');
    expect(res.session).toMatchObject({
      role: 'learner',
      menus: ['vocab'],
      levels: ['beginner'],
    });
  });

  it('rejects an unknown token', async () => {
    const { service } = setup(null);
    await expect(service.redeem(PLAIN, 'x')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects revoked and expired tokens', async () => {
    await expect(
      setup(makeToken({ revokedAt: new Date() })).service.redeem(PLAIN, 'x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      setup(
        makeToken({ expiresAt: new Date(Date.now() - 1000) }),
      ).service.redeem(PLAIN, 'x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces the device limit', async () => {
    const { service, tx } = setup(makeToken({ maxDevices: 2 }), 2);
    await expect(service.redeem(PLAIN, 'x')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.tokenSession.create).not.toHaveBeenCalled();
  });

  it('replaces this browser’s previous session instead of using a new slot', async () => {
    const { service, tx, jwt } = setup(makeToken());
    jwt.verifyAsync.mockResolvedValue({ sub: 'oldSess', tokenId: 'tok1' });

    await service.redeem(PLAIN, 'x', 'old.jwt');

    const call = tx.tokenSession.updateMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(call[0].where).toMatchObject({
      id: 'oldSess',
      accessTokenId: 'tok1',
    });
  });

  it('gives admins every menu and level even when none are stored', async () => {
    const { service } = setup(
      makeToken({ role: 'ADMIN', menus: [], levels: [] }),
    );
    const res = await service.redeem(PLAIN, 'x');
    expect(res.session.menus).toHaveLength(7);
    expect(res.session.levels).toEqual(['beginner', 'pre', 'inter', 'upper']);
  });
});
