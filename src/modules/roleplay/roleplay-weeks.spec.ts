// roleplay-weeks pulls jakartaDay from the quota service; keep its DB and
// config imports out of the test.
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import {
  roleplayWeeks,
  roleplayWeeksSince,
  weekStartOf,
} from './roleplay-weeks';

const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

describe('roleplay weeks', () => {
  // Wednesday 2026-11-18, 10:00 WIB.
  const now = new Date('2026-11-18T03:00:00Z');

  it('starts weeks on Monday', () => {
    expect(weekStartOf(day('2026-11-18')).toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    );
    expect(weekStartOf(day('2026-11-22')).toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    );
    expect(weekStartOf(day('2026-11-16')).toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    );
  });

  it('counts finished sessions and minutes per week, newest first', () => {
    const weeks = roleplayWeeks(
      [
        { day: day('2026-11-16'), durationSec: 300 },
        { day: day('2026-11-18'), durationSec: 330 },
        // Not finished: no duration, not counted.
        { day: day('2026-11-18'), durationSec: null },
        { day: day('2026-11-15'), durationSec: 600 },
        // Older than the window.
        { day: day('2026-01-05'), durationSec: 600 },
      ],
      now,
    );
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toEqual({
      weekStart: '2026-11-16',
      sessions: 2,
      minutes: 11,
    });
    expect(weeks[1]).toEqual({
      weekStart: '2026-11-09',
      sessions: 1,
      minutes: 10,
    });
    expect(weeks[7].weekStart).toBe('2026-09-28');
    expect(weeks.slice(2).every((w) => w.sessions === 0)).toBe(true);
  });

  it('queries from the Monday seven weeks back', () => {
    expect(roleplayWeeksSince(now).toISOString()).toBe(
      '2026-09-28T00:00:00.000Z',
    );
  });
});
