import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { RENCANA } from '../../../common/rencana.config';
import {
  LEVEL_WIRE_VALUES,
  type LevelWire,
} from '../../../common/token/access-enums';

export class LaporanItemDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,40}$/, { message: 'laporan_bad_id' })
  id!: string;

  @IsString()
  @Matches(/^[a-z][a-z_]{1,39}$/, { message: 'laporan_bad_jenis' })
  jenis!: string;

  @IsString()
  @Matches(/^[a-z][a-z_]{0,19}$/, { message: 'laporan_bad_menu' })
  menu!: string;

  @IsOptional()
  @IsIn(LEVEL_WIRE_VALUES)
  level?: LevelWire;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(RENCANA.maxWeek)
  week?: number;

  @IsInt()
  @Min(0)
  day!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  skor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  total?: number;

  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  jumlah?: number;

  // Free-form details per kind (see the frontend contract); size-checked in
  // the service.
  @IsOptional()
  data?: Record<string, unknown>;
}

export class PostLaporanDto {
  // Each item is checked in the service (LaporanItemDto) and a bad one is
  // dropped alone: a rejected batch would be retried by the app forever.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RENCANA.reportBatchMax)
  @IsObject({ each: true })
  items!: object[];
}

export class LaporanQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sejak!: number;
}

export class LaporanDto {
  id!: string;
  jenis!: string;
  menu!: string;
  level!: LevelWire | null;
  week!: number | null;
  day!: number;
  skor!: number | null;
  total!: number | null;
  jumlah!: number | null;
  data!: unknown;
  createdAt!: Date;

  constructor(o: LaporanDto) {
    Object.assign(this, o);
  }
}
