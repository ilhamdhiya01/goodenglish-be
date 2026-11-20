import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import { LaporanDto, LaporanQueryDto, PostLaporanDto } from './dto/laporan.dto';
import { LaporanService } from './laporan.service';

// The learner's own activity log, scoped by the session's token.
@Controller('me/laporan')
@AccessAuth()
export class LaporanController {
  constructor(private readonly laporan: LaporanService) {}

  @Get()
  @ResponseMessage('Activity reports retrieved successfully')
  list(
    @CurrentAccess() access: AccessContext,
    @Query() q: LaporanQueryDto,
  ): Promise<LaporanDto[]> {
    return this.laporan.list(access, q.sejak);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Activity reports saved')
  add(
    @CurrentAccess() access: AccessContext,
    @Body() dto: PostLaporanDto,
  ): Promise<{ saved: number }> {
    return this.laporan.add(access, dto.items);
  }
}
