// "Ringkasan pelajar" (admin): one row per learner, computed from three small
// progress docs (ACTIVITY, PLAN, LEVEL) as the app writes them. Same rules
// as the app's Progres page (goodenglish-fe progress-report / activity
// helpers); days are UTC epoch days, as the app's today().

const DAY_MS = 86_400_000;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** UTC day number (kept for callers without a time zone). */
export const todayDay = (now = Date.now()) => Math.floor(now / DAY_MS);

/** Blocks of Rencana done that day (plan.days[day] = { b1, b2, b3 }). */
const blocksOn = (planDays: Obj, d: number) =>
  Object.values(obj(planDays[String(d)])).filter(Boolean).length;

const weekend = (d: number) => {
  const wd = new Date(d * DAY_MS).getUTCDay();
  return wd === 0 || wd === 6;
};

/**
 * Days in a row with the day's Rencana done (weekdays ≥ 3 blocks, weekends
 * ≥ 1). Today counts once it's done; otherwise counting starts yesterday.
 */
export const streakOf = (planDays: Obj, today: number) => {
  const ok = (d: number) => blocksOn(planDays, d) >= (weekend(d) ? 1 : 3);
  let streak = 0;
  for (let d = ok(today) ? today : today - 1; d > today - 400; d--) {
    if (!ok(d)) break;
    streak++;
  }
  return streak;
};

/** Monday of the week of day d (UTC epoch days start on a Thursday). */
export const mondayOf = (d: number) =>
  d - ((new Date(d * DAY_MS).getUTCDay() + 6) % 7);

export interface LearnerRow {
  /** Day of the latest activity the app recorded, or null. */
  lastActivityDay: number | null;
  streak: number;
  minutes7d: number;
  wordsThisWeek: number;
  /** % "Ingat" in Ulang over the last 28 days; null without reviews. */
  retention: number | null;
  reviews28d: number;
  level: string | null;
}

export const learnerRow = (
  docs: { ACTIVITY?: unknown; PLAN?: unknown; LEVEL?: unknown },
  today: number,
): LearnerRow => {
  const days = obj(obj(docs.ACTIVITY).days);
  const planDays = obj(obj(docs.PLAN).days);
  let sec = 0;
  let words = 0;
  let reviews = 0;
  let good = 0;
  let last: number | null = null;
  const monday = mondayOf(today);
  for (const [k, v] of Object.entries(days)) {
    const d = Number(k);
    if (!Number.isInteger(d) || d > today) continue;
    const day = obj(v);
    const minutes = Object.values(obj(day.m)).reduce<number>(
      (a, x) => a + num(x),
      0,
    );
    const any = minutes > 0 || num(day.r) > 0 || num(day.l) !== 0;
    if (any && (last === null || d > last)) last = d;
    if (d > today - 7) sec += minutes;
    if (d >= monday) words += num(day.l);
    if (d > today - 28) {
      reviews += num(day.r);
      good += num(day.g);
    }
  }
  // A ticked Rencana block is activity too.
  for (const k of Object.keys(planDays)) {
    const d = Number(k);
    if (Number.isInteger(d) && d <= today && blocksOn(planDays, d) > 0)
      if (last === null || d > last) last = d;
  }
  const level = docs.LEVEL;
  return {
    lastActivityDay: last,
    streak: streakOf(planDays, today),
    minutes7d: Math.round(sec / 60),
    wordsThisWeek: Math.max(0, words),
    retention: reviews ? Math.round((good / reviews) * 100) : null,
    reviews28d: reviews,
    level: typeof level === 'string' && level ? level : null,
  };
};
