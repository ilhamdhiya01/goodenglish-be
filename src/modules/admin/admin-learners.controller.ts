import { Controller, Get } from '@nestjs/common';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AdminTokensService } from './admin-tokens.service';
import { LearnerOverviewDto } from './dto/learner-overview.dto';

// Admin › Kelola › Ringkasan pelajar.
@Controller('admin/learners')
@AccessAuth({ admin: true })
export class AdminLearnersController {
  constructor(private readonly tokens: AdminTokensService) {}

  @Get('overview')
  @ResponseMessage('Learner overview retrieved successfully')
  overview(): Promise<LearnerOverviewDto[]> {
    return this.tokens.learnersOverview();
  }
}
