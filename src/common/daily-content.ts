import type { Logger } from '@nestjs/common';
import { jakartaDay } from '../modules/ai/ai-quota.service';

// Bacaan and Menyimak harian: content the server makes itself each WIB day
// (week 0, `day` set), shown to learners for DAILY_KEEP_DAYS days.

/** Daily content stays visible this many days (today included). */
export const DAILY_KEEP_DAYS = 7;

/** Weekly content (no day) plus daily content of the last DAILY_KEEP_DAYS days. */
export const weeklyOrRecent = () => ({
  OR: [
    { day: null },
    {
      day: {
        gte: new Date(
          jakartaDay().getTime() - (DAILY_KEEP_DAYS - 1) * 86_400_000,
        ),
      },
    },
  ],
});

/** Runs `job` now and then hourly, not once at midnight: a failed Gemini
 * call or a restart is made up within the hour. */
export const startHourly = (
  job: () => Promise<void>,
  logger: Logger,
): NodeJS.Timeout => {
  const run = () =>
    void job().catch((err: unknown) => logger.warn(String(err)));
  run();
  const timer = setInterval(run, 60 * 60_000);
  timer.unref();
  return timer;
};
