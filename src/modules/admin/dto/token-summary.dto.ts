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

// Tes penempatan: the latest result (or that it was skipped).
export class PlacementResultDto {
  status!: 'done' | 'skipped';
  date!: string | null;
  level!: string | null;
  week!: number | null;

  constructor(partial: Partial<PlacementResultDto>) {
    Object.assign(this, partial);
  }
}

// One part of an exam attempt.
export class ExamSectionDto {
  section!: string;
  right!: number;
  total!: number;

  constructor(partial: Partial<ExamSectionDto>) {
    Object.assign(this, partial);
  }
}

// One end-of-level exam attempt.
export class ExamAttemptDto {
  level!: string;
  date!: string;
  pct!: number;
  passed!: boolean;
  sections!: ExamSectionDto[];

  constructor(partial: Partial<ExamAttemptDto>) {
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
  // Tes penempatan + ujian akhir level (newest attempts first, at most 10).
  placement!: PlacementResultDto | null;
  examAttempts!: ExamAttemptDto[];
  lastProgressAt!: Date | null;
  sessions!: TokenSessionItemDto[];
  // Last ROLEPLAY_WEEKS weeks, newest first, including empty ones.
  roleplayWeeks!: RoleplayWeekDto[];

  constructor(partial: Partial<TokenSummaryDto>) {
    Object.assign(this, partial);
  }
}
