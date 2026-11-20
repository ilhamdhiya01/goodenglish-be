import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { RENCANA } from '../../../common/rencana.config';
import {
  LEVEL_WIRE_VALUES,
  type LevelWire,
} from '../../../common/token/access-enums';
import type { SentenceCheck } from '../check-block';

// "Rencana › Pakai": the learner's own sentences, checked in one AI call.
export class CheckSentencesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RENCANA.checkSentencesMax)
  @IsString({ each: true })
  @MaxLength(RENCANA.checkSentenceMaxChars, { each: true })
  sentences!: string[];

  @IsIn(LEVEL_WIRE_VALUES)
  level!: LevelWire;
}

export class CheckSentencesResultDto {
  checks!: SentenceCheck[];

  constructor(o: CheckSentencesResultDto) {
    Object.assign(this, o);
  }
}
