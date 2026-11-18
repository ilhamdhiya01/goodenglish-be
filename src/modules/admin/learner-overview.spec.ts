import { learnerRow, mondayOf, streakOf, todayDay } from './learner-overview';

// 2026-11-18 is a Wednesday.
const WED = todayDay(Date.UTC(2026, 10, 18, 12));
const full = { b1: true, b2: true, b3: true };

describe('learner overview', () => {
  it('knows the week and the weekend', () => {
    expect(new Date(mondayOf(WED) * 86400000).toISOString().slice(0, 10)).toBe(
      '2026-11-16',
    );
  });

  it('counts the streak like the app (weekend ≥ 1 block, weekday ≥ 3)', () => {
    const days: Record<string, object> = {
      [WED - 1]: full, // Tue
      [WED - 2]: full, // Mon
      [WED - 3]: { b1: true }, // Sun
      [WED - 4]: { b2: true }, // Sat
      [WED - 5]: { b1: true }, // Fri: not enough
    };
    expect(streakOf(days, WED)).toBe(4); // today not done yet
    expect(streakOf({ ...days, [WED]: full }, WED)).toBe(5);
    expect(streakOf({}, WED)).toBe(0);
  });

  it('sums minutes (7 days), words this week, retention (28 days)', () => {
    const r = learnerRow(
      {
        LEVEL: 'inter',
        PLAN: { days: { [WED - 1]: full } },
        ACTIVITY: {
          days: {
            [WED]: { m: { vocab: 600, review: 300 }, r: 10, g: 8, l: 5 },
            [WED - 3]: { m: { grammar: 120 }, l: 4 }, // Sunday: last week
            [WED - 6]: { m: { reading: 60 } },
            [WED - 7]: { m: { reading: 6000 }, r: 10, g: 2 }, // 8 days ago
            [WED - 40]: { r: 100, g: 0 }, // older than 28 days
          },
        },
      },
      WED,
    );
    expect(r).toEqual({
      lastActivityDay: WED,
      streak: 1,
      minutes7d: 18, // (600 + 300 + 120 + 60) / 60
      wordsThisWeek: 5,
      retention: 50, // (8 + 2) / (10 + 10)
      reviews28d: 20,
      level: 'inter',
    });
  });

  it('copes with missing or broken docs', () => {
    expect(learnerRow({ ACTIVITY: 'x', PLAN: [], LEVEL: 3 }, WED)).toEqual({
      lastActivityDay: null,
      streak: 0,
      minutes7d: 0,
      wordsThisWeek: 0,
      retention: null,
      reviews28d: 0,
      level: null,
    });
  });
});
