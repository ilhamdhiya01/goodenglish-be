import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AdminTokensService,
  examStats,
  mistakeStats,
} from './admin-tokens.service';

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
  // AI_DAILY_LIMIT, the default for new tokens.
  const config = { get: () => 30 };
  return {
    service: new AdminTokensService(prisma as any, config as any),
    prisma,
  };
};

const createdData = (prisma: ReturnType<typeof setup>['prisma']) =>
  prisma.accessToken.create.mock.calls[0][0].data as Record<string, unknown>;

describe('AdminTokensService', () => {
  it('gives new tokens the default AI limit unless one is chosen', async () => {
    const base = {
      label: 'X',
      menus: ['vocab'],
      levels: ['pre'],
      maxDevices: 1,
    };

    const a = setup();
    await a.service.create(base as any);
    expect(createdData(a.prisma).aiDailyLimit).toBe(30);

    const b = setup();
    await b.service.create({ ...base, aiDailyLimit: null } as any);
    expect(createdData(b.prisma).aiDailyLimit).toBeNull();

    const c = setup();
    await c.service.create({ ...base, aiDailyLimit: 5 } as any);
    expect(createdData(c.prisma).aiDailyLimit).toBe(5);
  });

  it('changes the AI limit only when the update names it', async () => {
    const { service, prisma } = setup(1);
    await service.update('adm1', { aiDailyLimit: null });
    await service.update('adm1', { label: 'Ilham' });
    const [first, second] = prisma.accessToken.update.mock.calls.map(
      (c) => c[0].data as Record<string, unknown>,
    );
    expect(first).toHaveProperty('aiDailyLimit', null);
    expect(second).not.toHaveProperty('aiDailyLimit');
  });

  it('refuses a learner token whose only menu is Tanya AI', async () => {
    const { service } = setup();
    await expect(
      service.create({
        label: 'X',
        menus: ['ai'],
        levels: ['pre'],
        maxDevices: 1,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('gives new tokens 3 Main peran sessions a day unless one is chosen', async () => {
    const base = {
      label: 'X',
      menus: ['scenario', 'roleplay'],
      levels: ['pre'],
      maxDevices: 1,
    };
    const a = setup();
    await a.service.create(base as any);
    expect(createdData(a.prisma).roleplayDailyLimit).toBe(3);

    const b = setup();
    await b.service.create({ ...base, roleplayDailyLimit: null } as any);
    expect(createdData(b.prisma).roleplayDailyLimit).toBeNull();
    expect(createdData(b.prisma).menus).toEqual(['SCENARIO', 'ROLEPLAY']);
  });

  it('changes the Main peran limit only when the update names it', async () => {
    const { service, prisma } = setup(1);
    await service.update('adm1', { roleplayDailyLimit: 0 });
    await service.update('adm1', { label: 'Ilham' });
    const [first, second] = prisma.accessToken.update.mock.calls.map(
      (c) => c[0].data as Record<string, unknown>,
    );
    expect(first).toHaveProperty('roleplayDailyLimit', 0);
    expect(second).not.toHaveProperty('roleplayDailyLimit');
  });

  it('refuses a learner token whose only menus are Tanya AI and Main peran', async () => {
    const { service } = setup();
    await expect(
      service.create({
        label: 'X',
        menus: ['ai', 'roleplay'],
        levels: ['pre'],
        maxDevices: 1,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

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

  it('regenerates in place: new hash, same id, every device signed out', async () => {
    const { service, prisma } = setup();
    const res = await service.regenerate('adm1');

    const args = prisma.accessToken.update.mock.calls[0][0] as {
      where: object;
      data: Record<string, unknown>;
    };
    expect(args.where).toEqual({ id: 'adm1' });
    expect(res.token).toMatch(/^ge_/);
    expect(args.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.data.tokenPrefix).toBe(res.token.slice(0, 11));
    expect(JSON.stringify(args.data)).not.toContain(res.token);
    expect(prisma.tokenSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accessTokenId: 'adm1', revokedAt: null },
      }),
    );
    expect(res.item).toMatchObject({ id: 'adm1', activeDevices: 0 });
  });

  it('summary counts personal cards and finished Bacaan texts', async () => {
    const { service, prisma } = setup();
    const at = new Date('2026-11-17T00:00:00Z');
    Object.assign(prisma, {
      progressDoc: {
        findMany: jest.fn().mockResolvedValue([
          {
            key: 'CUSTOM',
            updatedAt: at,
            data: [
              { key: 'c1' },
              { key: 'c2', personal: true, source: 'Bacaan: X' },
            ],
          },
          { key: 'READING', updatedAt: at, data: { done: { t1: 1, t2: 2 } } },
        ]),
      },
      roleplaySession: { findMany: jest.fn().mockResolvedValue([]) },
    });
    (prisma.tokenSession as Record<string, unknown>).findMany = jest
      .fn()
      .mockResolvedValue([]);
    const res = await service.summary('adm1');
    expect(res).toMatchObject({
      customWordCount: 2,
      personalWordCount: 1,
      readingDoneCount: 2,
    });
  });

  it('summary counts mistakes in the old array and the v2 doc', () => {
    // Old array: no status, the same pair twice counts once.
    expect(
      mistakeStats([
        { wrong: 'She go.', correct: 'She goes.', category: 'tense' },
        { wrong: 'she go', correct: 'She goes!', category: 'tense' },
        { wrong: 'I am agree', correct: 'I agree', category: 'am-is-are' },
      ]),
    ).toMatchObject({
      active: 2,
      mastered: 0,
      top: [
        { id: 'am-is-are', count: 1 },
        { id: 'tense', count: 1 },
      ],
    });
    const v2 = {
      v: 2,
      items: [
        { key: 'a', status: 'active', category: 'tense' },
        { key: 'b', status: 'active', category: 'tense' },
        { key: 'c', status: 'active', category: 'a-an-the' },
        { key: 'd', status: 'mastered', category: 'pasif' },
        { key: 'e', status: 'archived', category: 'waktu' },
        { key: 'f', status: 'active', category: 'waktu' },
        { key: 'g', status: 'active', category: 'urutan-kata' },
      ],
    };
    expect(mistakeStats(v2)).toMatchObject({
      active: 5,
      mastered: 1,
      top: [
        { id: 'tense', count: 2 },
        { id: 'a-an-the', count: 1 },
        { id: 'urutan-kata', count: 1 },
      ],
    });
    expect(mistakeStats(undefined)).toMatchObject({ active: 0, top: [] });
  });

  it('requireExam: off unless chosen, changed only when named', async () => {
    const a = setup();
    await a.service.create({
      label: 'X',
      menus: ['vocab'],
      levels: ['pre'],
      maxDevices: 1,
    } as any);
    expect(createdData(a.prisma).requireExam).toBe(false);
    const b = setup();
    await b.service.create({
      label: 'X',
      menus: ['vocab'],
      levels: ['pre'],
      maxDevices: 1,
      requireExam: true,
    } as any);
    expect(createdData(b.prisma).requireExam).toBe(true);
    const c = setup();
    await c.service.update('adm1', { label: 'Y' });
    const data = (
      c.prisma.accessToken.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data).not.toHaveProperty('requireExam');
  });

  it('summary reads the placement result and exam history', () => {
    expect(examStats(undefined)).toEqual({ placement: null, examAttempts: [] });
    const r = examStats({
      placement: {
        status: 'done',
        date: '2026-11-18T01:00:00Z',
        recommended: { level: 'inter', week: 5 },
      },
      attempts: [
        {
          level: 'pre',
          date: '2026-11-01T00:00:00Z',
          pct: 70,
          passed: false,
          sections: {
            vocab: { right: 10, total: 15 },
            grammar: { right: 11, total: 15 },
          },
        },
        {
          level: 'pre',
          date: '2026-11-03T00:00:00Z',
          pct: 85,
          passed: true,
          sections: { vocab: { right: 13, total: 15 } },
        },
        { broken: true },
      ],
    });
    expect(r.placement).toMatchObject({
      status: 'done',
      level: 'inter',
      week: 5,
    });
    expect(r.examAttempts.map((a) => a.date)).toEqual([
      '2026-11-03T00:00:00Z',
      '2026-11-01T00:00:00Z',
    ]);
    expect(r.examAttempts[1].sections).toEqual([
      { section: 'vocab', right: 10, total: 15 },
      { section: 'grammar', right: 11, total: 15 },
    ]);
    expect(
      examStats({ placement: { status: 'skipped' } }).placement,
    ).toMatchObject({ status: 'skipped', level: null });
  });

  it("returns one token's raw progress docs by wire key", async () => {
    const { service, prisma } = setup();
    Object.assign(prisma, {
      progressDoc: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'KNOWN', data: { '1:w:be': 1 } },
          { key: 'ACTIVITY', data: { v: 1 } },
        ]),
      },
    });
    await expect(service.progress('adm1')).resolves.toEqual({
      known: { '1:w:be': 1 },
      activity: { v: 1 },
    });
  });

  it('lists learners with activity, streak and retention', async () => {
    const { service, prisma } = setup();
    const now = new Date(Date.UTC(2026, 10, 18, 12));
    const today = Math.floor(now.getTime() / 86400000);
    Object.assign(prisma.accessToken, {
      findMany: jest.fn().mockResolvedValue([
        {
          ...admin,
          id: 'l1',
          label: 'Rina',
          role: 'LEARNER',
          lastUsedAt: null,
        },
        {
          ...admin,
          id: 'l2',
          label: 'Budi',
          role: 'LEARNER',
          lastUsedAt: new Date(Date.UTC(2026, 10, 10)),
        },
      ]),
    });
    Object.assign(prisma, {
      progressDoc: {
        findMany: jest.fn().mockResolvedValue([
          { accessTokenId: 'l1', key: 'LEVEL', data: 'pre' },
          {
            accessTokenId: 'l1',
            key: 'ACTIVITY',
            data: {
              days: { [today]: { m: { vocab: 300 }, r: 4, g: 3, l: 2 } },
            },
          },
        ]),
      },
    });
    const rows = await service.learnersOverview(now);
    expect(rows[0]).toMatchObject({
      id: 'l1',
      level: 'pre',
      minutes7d: 5,
      wordsThisWeek: 2,
      retention: 75,
      streak: 0,
    });
    expect(rows[0].lastActiveAt!.getTime()).toBeGreaterThan(
      now.getTime() - 86400000,
    );
    expect(rows[1]).toMatchObject({ id: 'l2', level: null, retention: null });
    expect(rows[1].lastActiveAt).toEqual(new Date(Date.UTC(2026, 10, 10)));
  });

  it('404s on an unknown token', async () => {
    const { service, prisma } = setup();
    prisma.accessToken.findUnique.mockResolvedValue(null);
    await expect(service.summary('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
