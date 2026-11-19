import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import {
  PutRencanaMingguDto,
  RencanaMingguDto,
  RencanaMingguQueryDto,
} from './dto/rencana-minggu.dto';
import { RencanaMingguService } from './rencana-minggu.service';

@Controller('rencana')
@AccessAuth()
export class RencanaController {
  constructor(private readonly minggu: RencanaMingguService) {}

  @Get('minggu')
  @ResponseMessage('Week map retrieved successfully')
  list(@Query() q: RencanaMingguQueryDto): Promise<RencanaMingguDto[]> {
    return this.minggu.list(q.level);
  }
}

// Admin › Peta minggu.
@Controller('admin/rencana')
@AccessAuth({ admin: true })
export class AdminRencanaController {
  constructor(private readonly minggu: RencanaMingguService) {}

  @Get('minggu')
  @ResponseMessage('Week map retrieved successfully')
  list(@Query() q: RencanaMingguQueryDto): Promise<RencanaMingguDto[]> {
    return this.minggu.list(q.level);
  }

  @Put('minggu')
  @ResponseMessage('Week map saved')
  put(
    @CurrentAccess() access: AccessContext,
    @Body() dto: PutRencanaMingguDto,
  ): Promise<RencanaMingguDto | null> {
    return this.minggu.put(dto, access.label);
  }
}
