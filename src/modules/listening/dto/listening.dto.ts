import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  LEVEL_WIRE_VALUES,
  type LevelWire,
} from '../../../common/token/access-enums';

export const GENERATE_TYPES = ['dialog', 'monolog', 'mixed'] as const;
export type GenerateType = (typeof GENERATE_TYPES)[number];
export const STATUS_WIRE = ['draft', 'published'] as const;
export type StatusWire = (typeof STATUS_WIRE)[number];

export class TenseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  use?: string;
}

// Admin › Menyimak › Generate. The week's words and tense come from the
// frontend's bundled course content (the backend has none of it).
export class GenerateListeningDto {
  @IsIn(LEVEL_WIRE_VALUES)
  level!: LevelWire;

  @IsInt()
  @Min(1)
  @Max(52)
  week!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  count?: number;

  @IsOptional()
  @IsIn(GENERATE_TYPES)
  type?: GenerateType;

  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  words!: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TenseDto)
  tense?: TenseDto;
}

export class LineDto {
  @IsIn(['A', 'B'])
  speaker!: 'A' | 'B';

  @IsString()
  @MaxLength(600)
  text!: string;
}

export class QuestionDto {
  @IsString()
  @MaxLength(300)
  question!: string;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options!: string[];

  @IsInt()
  answerIndex!: number;

  @IsString()
  @MaxLength(400)
  explanationId!: string;
}

// Admin edit. Content rules are checked as a whole (validateContent).
export class UpdateListeningDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsIn(['dialog', 'monolog'])
  type?: 'dialog' | 'monolog';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines?: LineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions?: QuestionDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  week?: number;
}

export class AdminListQueryDto {
  @IsOptional()
  @IsIn(LEVEL_WIRE_VALUES)
  level?: LevelWire;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52)
  week?: number;

  @IsOptional()
  @IsIn(STATUS_WIRE)
  status?: StatusWire;
}

export class LearnerListQueryDto {
  @IsIn(LEVEL_WIRE_VALUES)
  level!: LevelWire;
}

export class ListeningItemDto {
  id!: string;
  level!: LevelWire;
  week!: number;
  status!: StatusWire;
  type!: 'dialog' | 'monolog';
  title!: string;
  lines!: { speaker: 'A' | 'B'; text: string }[];
  questions!: {
    question: string;
    options: string[];
    answerIndex: number;
    explanationId: string;
  }[];
  wordCount!: number;
  createdBy!: string | null;
  publishedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;

  constructor(partial: Partial<ListeningItemDto>) {
    Object.assign(this, partial);
  }
}

export class GenerateResultDto {
  items!: ListeningItemDto[];
  // Items Gemini failed to produce (bad output, timeout); try again.
  failed!: number;

  constructor(partial: Partial<GenerateResultDto>) {
    Object.assign(this, partial);
  }
}
