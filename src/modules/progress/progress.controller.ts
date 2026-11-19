import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Put,
  Query,
} from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import { PutProgressDto } from './dto/put-progress.dto';
import { PROGRESS_KEY_WIRE, type ProgressKeyWire } from './progress-keys';
import {
  ProgressDocWithVersion,
  ProgressMap,
  ProgressService,
  ProgressVersions,
} from './progress.service';

const keyPipe = () =>
  new ParseEnumPipe(
    Object.fromEntries(Object.keys(PROGRESS_KEY_WIRE).map((k) => [k, k])),
  );

// Progress belongs to the token, so every route here is scoped by the
// session's own token — there is no id in the URL to tamper with.
@Controller('me/progress')
@AccessAuth()
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  // ?withVersions=1 → { docs, versions } so the client can save with
  // baseVersion; without it the plain map older clients expect.
  @Get()
  @ResponseMessage('Progress retrieved successfully')
  getAll(
    @CurrentAccess() access: AccessContext,
    @Query('withVersions') withVersions?: string,
  ): Promise<ProgressMap | { docs: ProgressMap; versions: ProgressVersions }> {
    return withVersions === '1'
      ? this.progressService.getAllWithVersions(access.tokenId)
      : this.progressService.getAll(access.tokenId);
  }

  @Get(':key')
  @ResponseMessage('Progress retrieved successfully')
  getOne(
    @CurrentAccess() access: AccessContext,
    @Param('key', keyPipe()) key: ProgressKeyWire,
  ): Promise<ProgressDocWithVersion> {
    return this.progressService.getOne(access.tokenId, key);
  }

  @Put(':key')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Progress saved')
  put(
    @CurrentAccess() access: AccessContext,
    @Param('key', keyPipe()) key: ProgressKeyWire,
    @Body() dto: PutProgressDto,
  ): Promise<{ version: number }> {
    return this.progressService.put(
      access.tokenId,
      key,
      dto.data,
      dto.baseVersion,
    );
  }
}
