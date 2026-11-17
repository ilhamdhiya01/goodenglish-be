import { jakartaDay } from '../ai/ai-quota.service';

// How many calendar weeks the admin summary shows.
export const ROLEPLAY_WEEKS = 8;

const DAY_MS = 86_400_000;

// Monday of the week `day` falls in. `day` is a WIB calendar day stored as
// UTC midnight (see jakartaDay), so UTC getters give the WIB weekday.
export const weekStartOf = (day: Date): Date =>
  new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface RoleplayWeek {
  weekStart: string;
  sessions: number;
  minutes: number;
}

// Sessions and minutes per week for the last `weeks` weeks, newest first.
// Only finished sessions count: one abandoned mid-way has no duration and
// would only inflate the number.
export const roleplayWeeks = (
  rows: { day: Date; durationSec: number | null }[],
  now = new Date(),
  weeks = ROLEPLAY_WEEKS,
): RoleplayWeek[] => {
  const thisWeek = weekStartOf(jakartaDay(now));
  const out = Array.from({ length: weeks }, (_, i) => ({
    start: new Date(thisWeek.getTime() - i * 7 * DAY_MS),
    sessions: 0,
    seconds: 0,
  }));
  const byStart = new Map(out.map((w) => [ymd(w.start), w]));
  for (const r of rows) {
    if (r.durationSec === null) continue;
    const w = byStart.get(ymd(weekStartOf(r.day)));
    if (!w) continue;
    w.sessions++;
    w.seconds += r.durationSec;
  }
  return out.map((w) => ({
    weekStart: ymd(w.start),
    sessions: w.sessions,
    minutes: Math.round(w.seconds / 60),
  }));
};

// Earliest `day` the summary needs, for the query's WHERE.
export const roleplayWeeksSince = (now = new Date()): Date =>
  new Date(
    weekStartOf(jakartaDay(now)).getTime() - (ROLEPLAY_WEEKS - 1) * 7 * DAY_MS,
  );
