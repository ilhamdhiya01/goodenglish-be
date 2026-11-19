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
  GenerateListeningDto,
  GenerateResultDto,
  ListeningItemDto,
  UpdateListeningDto,
} from './dto/listening.dto';
import { ListeningService } from './listening.service';

// Admin › Kelola › Menyimak: the "Dengar & jawab" question bank.
@Controller('admin/listening')
@AccessAuth({ admin: true })
export class AdminListeningController {
  constructor(private readonly listening: ListeningService) {}

  @Get()
  @ResponseMessage('Listening items retrieved successfully')
  list(@Query() q: AdminListQueryDto): Promise<ListeningItemDto[]> {
    return this.listening.adminList(q);
  }

  @Post('generate')
  @ResponseMessage('Listening drafts generated')
  generate(
    @CurrentAccess() access: AccessContext,
    @Body() dto: GenerateListeningDto,
  ): Promise<GenerateResultDto> {
    return this.listening.generate(dto, access.label);
  }

  @Patch(':id')
  @ResponseMessage('Listening item saved')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateListeningDto,
  ): Promise<ListeningItemDto> {
    return this.listening.update(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Listening item published')
  publish(@Param('id') id: string): Promise<ListeningItemDto> {
    return this.listening.setPublished(id, true);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Listening item unpublished')
  unpublish(@Param('id') id: string): Promise<ListeningItemDto> {
    return this.listening.setPublished(id, false);
  }

  @Delete(':id')
  @ResponseMessage('Listening item deleted')
  async remove(@Param('id') id: string): Promise<null> {
    await this.listening.remove(id);
    return null;
  }
}
