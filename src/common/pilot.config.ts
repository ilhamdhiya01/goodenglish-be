// Backend thresholds of the Pre-intermediate pilot (GOODENGLISH_PILOT_SPEC.md,
// section 9). The frontend keeps its own copy in
// goodenglish-fe const/pilot.constant.ts; values used by both are the same.
export const PILOT = {
  /** Learning day of a token that has no time zone of its own. */
  defaultTimeZone: 'Asia/Jakarta',
} as const;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Day number (days since 1970-01-01) of a moment in a time zone. */
export const dayIn = (ms: number, timeZone: string): number => {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  const [y, m, d] = f.format(ms).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
