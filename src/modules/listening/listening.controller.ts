import { Controller, Get, Query } from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import { LearnerListQueryDto, ListeningItemDto } from './dto/listening.dto';
import { ListeningService } from './listening.service';

// Learners: published "Dengar & jawab" items of one allowed level.
@Controller('listening')
@AccessAuth()
export class ListeningController {
  constructor(private readonly listening: ListeningService) {}

  @Get('items')
  @ResponseMessage('Listening items retrieved successfully')
  items(
    @CurrentAccess() access: AccessContext,
    @Query() q: LearnerListQueryDto,
  ): Promise<ListeningItemDto[]> {
    return this.listening.listPublished(access, q.level);
  }
}
