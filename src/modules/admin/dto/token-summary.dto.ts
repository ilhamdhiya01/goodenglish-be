export class TokenSessionItemDto {
  id!: string;
  deviceLabel!: string;
  active!: boolean;
  createdAt!: Date;
  lastSeenAt!: Date;
  expiresAt!: Date;

  constructor(partial: Partial<TokenSessionItemDto>) {
    Object.assign(this, partial);
  }
}

// "Main peran" activity in one calendar week (Monday–Sunday, WIB).
export class RoleplayWeekDto {
  // Monday of the week, YYYY-MM-DD.
  weekStart!: string;
  sessions!: number;
  minutes!: number;

  constructor(partial: Partial<RoleplayWeekDto>) {
    Object.assign(this, partial);
  }
}

// One "Buku kesalahanku" category and how many active mistakes it holds.
export class MistakeCategoryCountDto {
  id!: string;
  count!: number;

  constructor(partial: Partial<MistakeCategoryCountDto>) {
    Object.assign(this, partial);
  }
}

// Learning-progress overview for one token, derived from its progress docs.
export class TokenSummaryDto {
  knownCount!: number;
  srsCount!: number;
  ownSentenceCount!: number;
  customWordCount!: number;
  // Of customWordCount: personal cards saved from Bacaan.
  personalWordCount!: number;
  // Bacaan texts finished (quiz answered).
  readingDoneCount!: number;
  // "Buku kesalahanku": active and mastered mistakes, top 3 categories.
  mistakeActiveCount!: number;
  mistakeMasteredCount!: number;
  topMistakeCategories!: MistakeCategoryCountDto[];
  lastProgressAt!: Date | null;
  sessions!: TokenSessionItemDto[];
  // Last ROLEPLAY_WEEKS weeks, newest first, including empty ones.
  roleplayWeeks!: RoleplayWeekDto[];

  constructor(partial: Partial<TokenSummaryDto>) {
    Object.assign(this, partial);
  }
}
