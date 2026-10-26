import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CreateWordDto } from './dto/create-word.dto';
import { UpdateWordDto } from './dto/update-word.dto';
import { WordDto } from './dto/word.dto';
import { WordsService } from './words.service';

@Controller('admin/words')
@AccessAuth({ admin: true })
export class AdminWordsController {
  constructor(private readonly wordsService: WordsService) {}

  @Post()
  @ResponseMessage('Word created')
  create(@Body() dto: CreateWordDto): Promise<WordDto> {
    return this.wordsService.create(dto);
  }

  @Patch(':id')
  @ResponseMessage('Word updated')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWordDto,
  ): Promise<WordDto> {
    return this.wordsService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('Word deleted')
  async remove(@Param('id') id: string): Promise<null> {
    await this.wordsService.remove(id);
    return null;
  }
}
