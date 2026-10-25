import { ProgressKey } from '../../generated/prisma/enums';

// Wire key (lowercase, critiq convention) ↔ Prisma enum. One entry per
// former localStorage key on the frontend.
export const PROGRESS_KEY_WIRE = {
  known: ProgressKey.KNOWN,
  srs: ProgressKey.SRS,
  own: ProgressKey.OWN,
  custom: ProgressKey.CUSTOM,
  done: ProgressKey.DONE,
  level: ProgressKey.LEVEL,
  weeks: ProgressKey.WEEKS,
  askprac: ProgressKey.ASKPRAC,
  plan: ProgressKey.PLAN,
  practice_session: ProgressKey.PRACTICE_SESSION,
  flip: ProgressKey.FLIP,
  search_scope: ProgressKey.SEARCH_SCOPE,
} as const satisfies Record<string, ProgressKey>;

export type ProgressKeyWire = keyof typeof PROGRESS_KEY_WIRE;
export const PROGRESS_KEY_WIRE_VALUES = Object.keys(
  PROGRESS_KEY_WIRE,
) as ProgressKeyWire[];

export const progressKeyToWire = (key: ProgressKey): ProgressKeyWire =>
  PROGRESS_KEY_WIRE_VALUES.find((w) => PROGRESS_KEY_WIRE[w] === key)!;
