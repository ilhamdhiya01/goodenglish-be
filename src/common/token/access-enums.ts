import { Level, Menu, Role } from '../../generated/prisma/enums';

// Enum values travel lowercase on the wire (critiq convention) and map to
// the Prisma SCREAMING_CASE enums at the boundary. The lowercase names match
// the frontend's route/level ids, e.g. 'vocab' ↔ /vocab, 'pre' ↔ level 'pre'.

export const MENU_WIRE = {
  plan: Menu.PLAN,
  vocab: Menu.VOCAB,
  review: Menu.REVIEW,
  scenario: Menu.SCENARIO,
  errors: Menu.ERRORS,
  grammar: Menu.GRAMMAR,
  pronunciation: Menu.PRONUNCIATION,
} as const satisfies Record<string, Menu>;

export const LEVEL_WIRE = {
  beginner: Level.BEGINNER,
  pre: Level.PRE,
  inter: Level.INTER,
  upper: Level.UPPER,
} as const satisfies Record<string, Level>;

export const ROLE_WIRE = {
  admin: Role.ADMIN,
  learner: Role.LEARNER,
} as const satisfies Record<string, Role>;

export type MenuWire = keyof typeof MENU_WIRE;
export type LevelWire = keyof typeof LEVEL_WIRE;
export type RoleWire = keyof typeof ROLE_WIRE;

export const MENU_WIRE_VALUES = Object.keys(MENU_WIRE) as MenuWire[];
export const LEVEL_WIRE_VALUES = Object.keys(LEVEL_WIRE) as LevelWire[];
export const ROLE_WIRE_VALUES = Object.keys(ROLE_WIRE) as RoleWire[];

const invert = <K extends string, V extends string>(m: Record<K, V>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<V, K>;

const MENU_FROM_DB = invert(MENU_WIRE);
const LEVEL_FROM_DB = invert(LEVEL_WIRE);
const ROLE_FROM_DB = invert(ROLE_WIRE);

// Output keeps the canonical tab/level order regardless of how it's stored.
export const menusToWire = (menus: Menu[]): MenuWire[] =>
  MENU_WIRE_VALUES.filter((w) => menus.includes(MENU_WIRE[w]));
export const levelsToWire = (levels: Level[]): LevelWire[] =>
  LEVEL_WIRE_VALUES.filter((w) => levels.includes(LEVEL_WIRE[w]));
export const roleToWire = (role: Role): RoleWire => ROLE_FROM_DB[role];

export const menusFromWire = (menus: MenuWire[]): Menu[] =>
  [...new Set(menus)].map((m) => MENU_WIRE[m]);
export const levelsFromWire = (levels: LevelWire[]): Level[] =>
  [...new Set(levels)].map((l) => LEVEL_WIRE[l]);

// Unused directly but kept next to the other inverse maps for symmetry.
export const menuFromDb = (m: Menu): MenuWire => MENU_FROM_DB[m];
export const levelFromDb = (l: Level): LevelWire => LEVEL_FROM_DB[l];
