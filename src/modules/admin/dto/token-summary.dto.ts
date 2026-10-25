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

// Learning-progress overview for one token, derived from its progress docs.
export class TokenSummaryDto {
  knownCount!: number;
  srsCount!: number;
  ownSentenceCount!: number;
  customWordCount!: number;
  lastProgressAt!: Date | null;
  sessions!: TokenSessionItemDto[];

  constructor(partial: Partial<TokenSummaryDto>) {
    Object.assign(this, partial);
  }
}
