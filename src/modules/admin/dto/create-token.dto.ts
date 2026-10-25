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
} from 'class-validator';
import {
  LEVEL_WIRE_VALUES,
  type LevelWire,
  MENU_WIRE_VALUES,
  type MenuWire,
  ROLE_WIRE_VALUES,
  type RoleWire,
} from '../../../common/token/access-enums';

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
}
