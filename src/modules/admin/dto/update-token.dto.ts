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

// Every field optional; `expiresAt: null` explicitly removes the expiry.
export class UpdateTokenDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsIn(ROLE_WIRE_VALUES)
  role?: RoleWire;

  @IsOptional()
  @IsArray()
  @IsIn(MENU_WIRE_VALUES, { each: true })
  menus?: MenuWire[];

  @IsOptional()
  @IsArray()
  @IsIn(LEVEL_WIRE_VALUES, { each: true })
  levels?: LevelWire[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxDevices?: number;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsDateString()
  expiresAt?: string | null;
}
