import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AiContextDto } from './ai-context.dto';

export class CheckDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  sentence!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AiContextDto)
  context?: AiContextDto;
}

export const CHECK_VERDICTS = ['correct', 'almost', 'incorrect'] as const;
export type CheckVerdict = (typeof CHECK_VERDICTS)[number];

export class CheckResultDto {
  verdict!: CheckVerdict;
  // The fixed sentence; equal to the input when it was already correct.
  corrected!: string;
  // In Indonesian.
  explanation!: string;
  // More natural ways to say the same thing (may be empty).
  alternatives!: string[];
  // Misspelled words as the learner wrote them, with the right spelling.
  typos!: { wrong: string; correct: string }[];

  constructor(partial: Partial<CheckResultDto>) {
    Object.assign(this, partial);
  }
}

export class AiUsageDto {
  used!: number;
  // null = unlimited.
  limit!: number | null;

  constructor(partial: Partial<AiUsageDto>) {
    Object.assign(this, partial);
  }
}
