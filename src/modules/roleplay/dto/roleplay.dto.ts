import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
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
import { STT_LANGUAGES, type SttLanguage } from '../../stt/stt.service';

// A session ends after this many learner turns (spec: "setelah 12 giliran").
export const MAX_USER_TURNS = 12;
// "Bantu aku" calls per session.
export const MAX_HELP = 6;
// Spoken answers written down (stt service) per session: one per turn,
// plus room for re-recording and retries.
export const MAX_TRANSCRIBE = 30;
export const MAX_LINE_CHARS = 600;
// Opening line + 12 × (learner, AI) and a little slack.
export const MAX_TRANSCRIPT = 30;

export const ROLEPLAY_ROLES = ['ai', 'user'] as const;
export type RoleplayRole = (typeof ROLEPLAY_ROLES)[number];

// Everything the model needs about the scenario. Sent once at start and
// stored on the session, so later turns can't swap the mission.
export class RoleplayContextDto {
  @IsIn(LEVEL_WIRE_VALUES)
  level!: LevelWire;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  where?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  roleAi!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  roleUser!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  mission!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  steps!: string[];

  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  phrases!: string[];
}

export class StartRoleplayDto {
  @IsString()
  @Matches(/^[a-z0-9_-]{1,40}$/)
  scenarioId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => RoleplayContextDto)
  context!: RoleplayContextDto;
}

export class RoleplayLineDto {
  @IsIn(ROLEPLAY_ROLES)
  role!: RoleplayRole;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_LINE_CHARS)
  text!: string;
}

// The whole conversation so far, oldest first. The client keeps it (it is
// saved in the learner's history), the server only checks and counts it.
export class TranscriptDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TRANSCRIPT)
  @ValidateNested({ each: true })
  @Type(() => RoleplayLineDto)
  transcript!: RoleplayLineDto[];
}

// The text fields of the multipart upload; the audio itself is the `audio`
// file part (see RoleplayController.transcribe).
export class TranscribeDto {
  // The language the learner speaks in this recording. Never auto-detected:
  // short answers are often detected wrong.
  @IsOptional()
  @IsIn(STT_LANGUAGES)
  language?: SttLanguage;
}

export class RoleplayTranscriptionDto {
  text!: string;
  language!: SttLanguage;
  durationSec!: number;
  transcribeLeft!: number;

  constructor(partial: Partial<RoleplayTranscriptionDto>) {
    Object.assign(this, partial);
  }
}

export class FinishRoleplayDto extends TranscriptDto {
  // Measured by the client; capped by the server's own clock.
  @IsInt()
  @Min(0)
  @Max(3 * 3600)
  durationSec!: number;
}

export class RoleplayUsageDto {
  used!: number;
  // null = unlimited.
  limit!: number | null;

  constructor(partial: Partial<RoleplayUsageDto>) {
    Object.assign(this, partial);
  }
}

export class RoleplayStartedDto {
  id!: string;
  reply!: string;
  // Sessions left today after this one; null = unlimited.
  remaining!: number | null;

  constructor(partial: Partial<RoleplayStartedDto>) {
    Object.assign(this, partial);
  }
}

export class RoleplayTurnDto {
  reply!: string;
  // Every step index done so far (never shrinks).
  stepsDone!: number[];
  missionComplete!: boolean;
  userTurns!: number;
  turnsLeft!: number;

  constructor(partial: Partial<RoleplayTurnDto>) {
    Object.assign(this, partial);
  }
}

export class RoleplaySuggestionDto {
  en!: string;
  id!: string;
}

export class RoleplayHelpDto {
  suggestions!: RoleplaySuggestionDto[];
  helpLeft!: number;

  constructor(partial: Partial<RoleplayHelpDto>) {
    Object.assign(this, partial);
  }
}

export class RoleplayCorrectionDto {
  original!: string;
  corrected!: string;
  explanation!: string;
  // One of ROLEPLAY_CATEGORIES (the Cheat sheet section ids).
  category!: string;
}

export class RoleplayNaturalDto {
  original!: string;
  natural!: string;
}

export class RoleplaySummaryDto {
  missionComplete!: boolean;
  // 1–2 encouraging sentences in Indonesian.
  summary!: string;
  corrections!: RoleplayCorrectionDto[];
  moreNatural!: RoleplayNaturalDto[];
  keyPhrasesUsed!: string[];
  durationSec!: number;
  userTurns!: number;
  stepsDone!: number[];

  constructor(partial: Partial<RoleplaySummaryDto>) {
    Object.assign(this, partial);
  }
}
