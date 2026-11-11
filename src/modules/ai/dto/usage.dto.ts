export class AiUsageDto {
  used!: number;
  // null = unlimited.
  limit!: number | null;

  constructor(partial: Partial<AiUsageDto>) {
    Object.assign(this, partial);
  }
}
