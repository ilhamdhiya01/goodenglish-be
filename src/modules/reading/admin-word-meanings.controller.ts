import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import {
  UpdateWordMeaningDto,
  WordMeaningDto,
  WordMeaningQueryDto,
} from './dto/reading.dto';
import { WordLookupService } from './word-lookup.service';

// Admin › Kelola › Bacaan › Arti kata: meanings saved from learners' taps,
// to correct or remove a wrong one.
@Controller('admin/word-meanings')
@AccessAuth({ admin: true })
export class AdminWordMeaningsController {
  constructor(private readonly lookup: WordLookupService) {}

  @Get()
  @ResponseMessage('Word meanings retrieved successfully')
  list(@Query() q: WordMeaningQueryDto): Promise<WordMeaningDto[]> {
    return this.lookup.adminList(q);
  }

  @Patch(':id')
  @ResponseMessage('Word meaning updated')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWordMeaningDto,
  ): Promise<WordMeaningDto> {
    return this.lookup.adminUpdate(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Word meaning deleted')
  async remove(@Param('id') id: string): Promise<null> {
    await this.lookup.adminRemove(id);
    return null;
  }
}
