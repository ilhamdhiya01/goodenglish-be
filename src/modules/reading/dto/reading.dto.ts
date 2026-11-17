import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
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
import type {
  GlossaryEntry,
  ReadingParagraph,
  ReadingQuestion,
  ReadingWarning,
} from '../reading.parse';
import type { SlotWire } from '../reading.prompts';

export const SLOT_VALUES = ['A', 'B'] as const;
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

// Admin › Bacaan › Buat draf. The week's words and tense come from the
// frontend's bundled course content (the backend has none of it).
export class GenerateReadingDto {
  @IsIn(LEVEL_WIRE_VALUES)
  level!: LevelWire;

  @IsInt()
  @Min(1)
  @Max(52)
  week!: number;

  @IsIn(SLOT_VALUES)
  slot!: SlotWire;

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

export class ParagraphDto {
  @IsString()
  @MaxLength(3000)
  en!: string;

  @IsString()
  @MaxLength(3000)
  id!: string;
}

export class GlossaryDto {
  @IsString()
  @MaxLength(60)
  word!: string;

  @IsString()
  @MaxLength(200)
  meaningId!: string;
}

// One shape for the three question types; validateText checks the fields
// each type needs.
export class QuestionDto {
  @IsIn(['mcq', 'true_false', 'find_word'])
  type!: 'mcq' | 'true_false' | 'find_word';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  question?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options?: string[];

  @IsOptional()
  @IsInt()
  answerIndex?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  statement?: string;

  // boolean for true_false, the word for find_word
  @IsOptional()
  answer?: boolean | string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  promptId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  explanationId?: string;
}

// Admin edit. Content rules are checked as a whole (validateText) and the
// warnings are recomputed.
export class UpdateReadingDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ParagraphDto)
  paragraphs?: ParagraphDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  targetWordsUsed?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GlossaryDto)
  glossary?: GlossaryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions?: QuestionDto[];

  // The week's Kosakata, to recount "≥ 8 week words" after the edit.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  words?: string[];
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

// Tap-a-word in a text, for a word in neither Kosakata nor the glossary.
export class LookupDto {
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z'’-]{0,39}$/, { message: 'lookup_bad_word' })
  word!: string;

  @IsIn(LEVEL_WIRE_VALUES)
  level!: LevelWire;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  sentence?: string;
}

export class ReadingTextDto {
  id!: string;
  level!: LevelWire;
  week!: number;
  slot!: SlotWire;
  status!: StatusWire;
  title!: string;
  paragraphs!: ReadingParagraph[];
  targetWordsUsed!: string[];
  glossary!: GlossaryEntry[];
  questions!: ReadingQuestion[];
  wordCount!: number;
  warnings!: ReadingWarning[];
  createdBy!: string | null;
  publishedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;

  constructor(o: ReadingTextDto) {
    Object.assign(this, o);
  }
}

export class LookupResultDto {
  word!: string;
  lemma!: string;
  meaningId!: string;
  pron!: string;
  cached!: boolean;

  constructor(o: LookupResultDto) {
    Object.assign(this, o);
  }
}
