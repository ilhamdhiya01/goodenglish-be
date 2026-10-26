import { Controller, Get } from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import { WordDto } from './dto/word.dto';
import { WordsService } from './words.service';

@Controller('words')
@AccessAuth()
export class WordsController {
  constructor(private readonly wordsService: WordsService) {}

  @Get()
  @ResponseMessage('Words retrieved successfully')
  list(@CurrentAccess() access: AccessContext): Promise<WordDto[]> {
    return this.wordsService.listFor(access);
  }
}
