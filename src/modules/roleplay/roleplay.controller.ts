import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import {
  FinishRoleplayDto,
  RoleplayHelpDto,
  RoleplayStartedDto,
  RoleplaySummaryDto,
  RoleplayTranscriptionDto,
  RoleplayTurnDto,
  RoleplayUsageDto,
  StartRoleplayDto,
  TranscribeDto,
  TranscriptDto,
} from './dto/roleplay.dto';
import { RoleplayService } from './roleplay.service';
import { STT_MAX_BYTES, type UploadedAudio } from '../stt/stt.service';

// "Main peran": voice roleplay with the AI inside Skenario. The client keeps
// the transcript and sends it whole on every call; the server keeps the
// session row for quota, caps and admin stats (see RoleplaySession).
@Controller('roleplay')
@AccessAuth()
export class RoleplayController {
  constructor(private readonly roleplay: RoleplayService) {}

  @Get('usage')
  @ResponseMessage('Roleplay usage retrieved successfully')
  usage(@CurrentAccess() access: AccessContext): Promise<RoleplayUsageDto> {
    return this.roleplay.usage(access);
  }

  @Post('sessions')
  @ResponseMessage('Roleplay session started')
  start(
    @CurrentAccess() access: AccessContext,
    @Body() dto: StartRoleplayDto,
  ): Promise<RoleplayStartedDto> {
    return this.roleplay.start(access, dto);
  }

  @Post('sessions/:id/turn')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Roleplay turn answered')
  turn(
    @CurrentAccess() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: TranscriptDto,
  ): Promise<RoleplayTurnDto> {
    return this.roleplay.turn(access, id, dto);
  }

  @Post('sessions/:id/help')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Roleplay suggestions retrieved')
  help(
    @CurrentAccess() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: TranscriptDto,
  ): Promise<RoleplayHelpDto> {
    return this.roleplay.help(access, id, dto);
  }

  // multipart/form-data: `audio` (webm/ogg/mp4/m4a/wav, ≤ 5 MB) and
  // `language` (en|id). Kept in memory only, then passed to the stt service.
  // multer's own cap is a little higher so a slightly-too-big file still gets
  // the friendly stt_too_large instead of multer's generic 413.
  @Post('sessions/:id/transcribe')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Roleplay answer transcribed')
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: STT_MAX_BYTES + 512_000, files: 1, fields: 4 },
    }),
  )
  transcribe(
    @CurrentAccess() access: AccessContext,
    @Param('id') id: string,
    @UploadedFile() file: UploadedAudio | undefined,
    @Body() dto: TranscribeDto,
  ): Promise<RoleplayTranscriptionDto> {
    return this.roleplay.transcribe(access, id, file, dto);
  }

  @Post('sessions/:id/finish')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Roleplay session summarised')
  finish(
    @CurrentAccess() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: FinishRoleplayDto,
  ): Promise<RoleplaySummaryDto> {
    return this.roleplay.finish(access, id, dto);
  }
}
