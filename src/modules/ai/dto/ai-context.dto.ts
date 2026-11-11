import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  LEVEL_WIRE_VALUES,
  type LevelWire,
} from '../../../common/token/access-enums';

// What the learner is looking at when they ask. Sent by the frontend (the
// backend doesn't hold the bundled vocabulary), so every field is optional
// and length-capped: it only steers the answer.
export class AiContextDto {
  // Route segment, e.g. "vocab", "review", "grammar".
  @IsOptional()
  @IsString()
  @MaxLength(40)
  page?: string;

  @IsOptional()
  @IsIn(LEVEL_WIRE_VALUES)
  level?: LevelWire;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  week?: number;

  // The word card the question came from, if any.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  word?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  meaning?: string;

  // That word's explanation from the app's notes, flattened to text.
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  note?: string;
}
