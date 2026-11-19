import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { RENCANA } from '../../../common/rencana.config';
import {
  LEVEL_WIRE_VALUES,
  type LevelWire,
} from '../../../common/token/access-enums';

export class RencanaMingguQueryDto {
  @IsIn(LEVEL_WIRE_VALUES)
  level!: LevelWire;
}

// One week of the map. null clears a field (the app falls back again).
export class PutRencanaMingguDto {
  @IsIn(LEVEL_WIRE_VALUES)
  level!: LevelWire;

  @IsInt()
  @Min(1)
  @Max(RENCANA.maxWeek)
  week!: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^[a-z0-9_-]{1,40}$/, { message: 'rencana_bad_scenario' })
  scenarioId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(RENCANA.grammarTopics, { message: 'rencana_bad_topic' })
  grammarTopic?: string | null;
}

export class RencanaMingguDto {
  level!: LevelWire;
  week!: number;
  scenarioId!: string | null;
  grammarTopic!: string | null;
  updatedAt!: Date;

  constructor(o: RencanaMingguDto) {
    Object.assign(this, o);
  }
}
