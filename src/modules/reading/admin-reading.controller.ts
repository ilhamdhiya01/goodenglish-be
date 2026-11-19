import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import {
  AdminListQueryDto,
  GenerateReadingDto,
  PublishReadingDto,
  ReadingTextDto,
  UpdateReadingDto,
} from './dto/reading.dto';
import { ReadingService } from './reading.service';

// Admin › Kelola › Bacaan: graded reading texts.
@Controller('admin/reading')
@AccessAuth({ admin: true })
export class AdminReadingController {
  constructor(private readonly reading: ReadingService) {}

  @Get()
  @ResponseMessage('Reading texts retrieved successfully')
  list(@Query() q: AdminListQueryDto): Promise<ReadingTextDto[]> {
    return this.reading.adminList(q);
  }

  @Post('generate')
  @ResponseMessage('Reading draft generated')
  generate(
    @CurrentAccess() access: AccessContext,
    @Body() dto: GenerateReadingDto,
  ): Promise<ReadingTextDto> {
    return this.reading.generate(dto, access.label);
  }

  @Patch(':id')
  @ResponseMessage('Reading text saved')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReadingDto,
  ): Promise<ReadingTextDto> {
    return this.reading.update(id, dto);
  }

  // 409 reading_slot_taken while another text of the slot is published;
  // 422 reading_has_warnings unless { force: true }.
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reading text published')
  publish(
    @Param('id') id: string,
    @Body() dto: PublishReadingDto,
  ): Promise<ReadingTextDto> {
    return this.reading.setPublished(id, true, dto?.force === true);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reading text unpublished')
  unpublish(@Param('id') id: string): Promise<ReadingTextDto> {
    return this.reading.setPublished(id, false);
  }

  @Delete(':id')
  @ResponseMessage('Reading text deleted')
  async remove(@Param('id') id: string): Promise<null> {
    await this.reading.remove(id);
    return null;
  }
}
