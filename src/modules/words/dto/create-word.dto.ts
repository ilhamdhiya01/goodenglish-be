import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  LEVEL_WIRE_VALUES,
  type LevelWire,
} from '../../../common/token/access-enums';

// Word type ids the frontend knows (goodenglish-fe const/vocab-types.constant.ts).
export const WORD_TYPES = ['w', 'pv', 'col', 'st', 'ex', 'cj'] as const;
export type WordType = (typeof WORD_TYPES)[number];

export class CreateWordDto {
  @IsIn(LEVEL_WIRE_VALUES)
  level!: LevelWire;

  @IsInt()
  @Min(1)
  @Max(52)
  week!: number;

  @IsIn(WORD_TYPES)
  type!: WordType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  en!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  meaning!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  pron?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  example?: string;
}
