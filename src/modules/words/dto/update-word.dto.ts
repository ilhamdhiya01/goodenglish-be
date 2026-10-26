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
import { WORD_TYPES, type WordType } from './create-word.dto';

// Every field optional.
export class UpdateWordDto {
  @IsOptional()
  @IsIn(LEVEL_WIRE_VALUES)
  level?: LevelWire;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  week?: number;

  @IsOptional()
  @IsIn(WORD_TYPES)
  type?: WordType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  en?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  meaning?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  pron?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  example?: string;
}
