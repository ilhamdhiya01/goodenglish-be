import { Level } from '../../generated/prisma/enums';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { RencanaMingguService } from './rencana-minggu.service';

jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../../generated/prisma/client', () => ({}));

const row = (o: object = {}) => ({
  level: Level.PRE,
  week: 3,
  scenarioId: 'hotel',
  grammarTopic: null,
  updatedBy: 'Admin',
  updatedAt: new Date(0),
  ...o,
});

const setup = (cur: object | null = null) => {
  const rencanaMinggu = {
    findMany: jest.fn().mockResolvedValue([row()]),
    findUnique: jest.fn().mockResolvedValue(cur),
    upsert: jest.fn((a: { create: object; update: object }) =>
      row({ ...(cur ? a.update : a.create) }),
    ),
    delete: jest.fn(),
  };
  const service = new RencanaMingguService({
    rencanaMinggu,
  } as unknown as PrismaService);
  return { service, rencanaMinggu };
};

describe('RencanaMingguService', () => {
  it('lists one level, wire names out', async () => {
    const { service, rencanaMinggu } = setup();
    await expect(service.list('pre')).resolves.toMatchObject([
      { level: 'pre', week: 3, scenarioId: 'hotel', grammarTopic: null },
    ]);
    expect(rencanaMinggu.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { level: Level.PRE } }),
    );
  });

  it('sets a field and keeps the other one', async () => {
    const { service, rencanaMinggu } = setup(row());
    await service.put({ level: 'pre', week: 3, grammarTopic: 'tense' }, 'Ed');
    expect(rencanaMinggu.upsert.mock.calls[0][0].update).toEqual({
      scenarioId: 'hotel',
      grammarTopic: 'tense',
      updatedBy: 'Ed',
    });
  });

  it('a week with nothing left is removed', async () => {
    const { service, rencanaMinggu } = setup(row());
    await expect(
      service.put({ level: 'pre', week: 3, scenarioId: null }, 'Ed'),
    ).resolves.toBeNull();
    expect(rencanaMinggu.delete).toHaveBeenCalledWith({
      where: { level_week: { level: Level.PRE, week: 3 } },
    });
    expect(rencanaMinggu.upsert).not.toHaveBeenCalled();
  });
});
