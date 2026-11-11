import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  LEVEL_WIRE_VALUES,
  type LevelWire,
  MENU_WIRE_VALUES,
  type MenuWire,
  ROLE_WIRE_VALUES,
  type RoleWire,
} from '../../../common/token/access-enums';

// Upper bound for a finite per-token AI limit (null means unlimited).
export const AI_DAILY_LIMIT_MAX = 10000;

export class CreateTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  @IsOptional()
  @IsIn(ROLE_WIRE_VALUES)
  role?: RoleWire;

  @IsArray()
  @IsIn(MENU_WIRE_VALUES, { each: true })
  menus!: MenuWire[];

  @IsArray()
  @IsIn(LEVEL_WIRE_VALUES, { each: true })
  levels!: LevelWire[];

  @IsInt()
  @Min(1)
  @Max(20)
  maxDevices!: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  // "Tanya AI" questions per day. null = unlimited; omitted = AI_DAILY_LIMIT.
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(AI_DAILY_LIMIT_MAX)
  aiDailyLimit?: number | null;
}
