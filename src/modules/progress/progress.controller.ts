import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Put,
} from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import { PutProgressDto } from './dto/put-progress.dto';
import { PROGRESS_KEY_WIRE, type ProgressKeyWire } from './progress-keys';
import { ProgressMap, ProgressService } from './progress.service';

// Progress belongs to the token, so every route here is scoped by the
// session's own token — there is no id in the URL to tamper with.
@Controller('me/progress')
@AccessAuth()
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get()
  @ResponseMessage('Progress retrieved successfully')
  getAll(@CurrentAccess() access: AccessContext): Promise<ProgressMap> {
    return this.progressService.getAll(access.tokenId);
  }

  @Put(':key')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Progress saved')
  async put(
    @CurrentAccess() access: AccessContext,
    @Param(
      'key',
      new ParseEnumPipe(
        Object.fromEntries(Object.keys(PROGRESS_KEY_WIRE).map((k) => [k, k])),
      ),
    )
    key: ProgressKeyWire,
    @Body() dto: PutProgressDto,
  ): Promise<null> {
    await this.progressService.put(access.tokenId, key, dto.data);
    return null;
  }
}
