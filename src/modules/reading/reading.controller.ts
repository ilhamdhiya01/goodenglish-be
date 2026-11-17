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
import {
  LearnerListQueryDto,
  LookupDto,
  LookupResultDto,
  ReadingTextDto,
} from './dto/reading.dto';
import { ReadingService } from './reading.service';
import { WordLookupService } from './word-lookup.service';

// Learners: published texts of one allowed level, and tap-a-word meanings.
@Controller('reading')
@AccessAuth()
export class ReadingController {
  constructor(
    private readonly reading: ReadingService,
    private readonly words: WordLookupService,
  ) {}

  @Get('texts')
  @ResponseMessage('Reading texts retrieved successfully')
  texts(
    @CurrentAccess() access: AccessContext,
    @Query() q: LearnerListQueryDto,
  ): Promise<ReadingTextDto[]> {
    return this.reading.listPublished(access, q.level);
  }

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Word meaning retrieved')
  lookup(
    @CurrentAccess() access: AccessContext,
    @Body() dto: LookupDto,
  ): Promise<LookupResultDto> {
    return this.words.lookup(access, dto);
  }
}
