import { Level } from '../../generated/prisma/enums';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AccessContext } from '../../common/types/access-context';
import { LaporanService } from './laporan.service';

jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../../generated/prisma/client', () => ({}));

// 2026-11-19 12:00 UTC = 19:00 WIB.
const NOW = Date.UTC(2026, 10, 19, 12);
const TODAY = Date.UTC(2026, 10, 19) / 86_400_000;
const access = {
  tokenId: 't1',
  timeZone: 'Asia/Jakarta',
} as unknown as AccessContext;
const item = (o: object = {}) => ({
  id: 'abcdefgh1',
  jenis: 'kartu_diulang',
  menu: 'review',
  day: TODAY,
  ...o,
});

const setup = () => {
  const activityReport = {
    createMany: jest.fn(
      (a: { data: Record<string, unknown>[]; skipDuplicates: boolean }) => ({
        count: a.data.length,
      }),
    ),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const service = new LaporanService({
    activityReport,
  } as unknown as PrismaService);
  return { service, activityReport };
};

describe('LaporanService', () => {
  it('saves a batch once (duplicates skipped by id)', async () => {
    const { service, activityReport } = setup();
    await service.add(
      access,
      [item({ level: 'pre', week: 2, skor: 4, total: 5 })],
      NOW,
    );
    const call = activityReport.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0]).toMatchObject({
      accessTokenId: 't1',
      level: Level.PRE,
      week: 2,
      day: TODAY,
      skor: 4,
      total: 5,
    });
  });

  it('a day ahead of today becomes today; too old is dropped', async () => {
    const { service, activityReport } = setup();
    const res = await service.add(
      access,
      [
        item({ id: 'aaaaaaaa1', day: TODAY + 3 }),
        item({ id: 'bbbbbbbb1', day: TODAY - 61 }),
      ],
      NOW,
    );
    expect(res).toEqual({ saved: 1 });
    expect(activityReport.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(activityReport.createMany.mock.calls[0][0].data[0].day).toBe(TODAY);
  });

  it('drops oversized data, keeps the report', async () => {
    const { service, activityReport } = setup();
    await service.add(
      access,
      [
        item({ data: { x: 'y'.repeat(3000) } }),
        item({ id: 'cccccccc1', data: { ok: 1 } }),
      ],
      NOW,
    );
    const data = activityReport.createMany.mock.calls[0][0].data;
    expect(data[0].data).toBeUndefined();
    expect(data[1].data).toEqual({ ok: 1 });
  });

  it('reads at most 120 days back, own token only', async () => {
    const { service, activityReport } = setup();
    await service.list(access, 0, NOW);
    expect(activityReport.findMany.mock.calls[0][0].where).toEqual({
      accessTokenId: 't1',
      day: { gte: TODAY - 120 },
    });
  });
});
