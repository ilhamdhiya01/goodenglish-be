import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import { SttTranscribeDto, SttTranscriptionDto } from './dto/transcribe.dto';
import { STT_MAX_BYTES, SttService, type UploadedAudio } from './stt.service';

// Speech-to-text outside Main peran: answering a "Betulkan kalimat" card in
// Ulang, or saying an expression for "Tandai hafal" in Kosakata, by voice
// (multipart `audio` + `language`, optional `hint`). The audio is only passed
// through, never stored.
@Controller('stt')
@AccessAuth()
export class SttController {
  constructor(private readonly stt: SttService) {}

  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Audio transcribed')
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: STT_MAX_BYTES + 512_000, files: 1, fields: 4 },
    }),
  )
  async transcribe(
    @CurrentAccess() access: AccessContext,
    @UploadedFile() file: UploadedAudio | undefined,
    @Body() dto: SttTranscribeDto,
  ): Promise<SttTranscriptionDto> {
    return new SttTranscriptionDto(
      await this.stt.transcribeForReview(access, file, dto.language, dto.hint),
    );
  }
}
