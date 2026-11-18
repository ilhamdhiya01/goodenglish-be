// One row of "Ringkasan pelajar" (Admin › Kelola).
export class LearnerOverviewDto {
  id!: string;
  label!: string;
  status!: 'active' | 'revoked' | 'expired';
  levels!: string[];
  menus!: string[];
  /** Active level in the app (progress doc LEVEL), if set. */
  level!: string | null;
  /** Latest of the last sign-in and the last recorded activity. */
  lastActiveAt!: Date | null;
  streak!: number;
  minutes7d!: number;
  wordsThisWeek!: number;
  /** % "Ingat" in Ulang over 28 days; null without reviews. */
  retention!: number | null;
  reviews28d!: number;

  constructor(partial: Partial<LearnerOverviewDto>) {
    Object.assign(this, partial);
  }
}
