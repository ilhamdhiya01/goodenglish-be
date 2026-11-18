import { Module } from '@nestjs/common';
import { AdminLearnersController } from './admin-learners.controller';
import { AdminTokensController } from './admin-tokens.controller';
import { AdminTokensService } from './admin-tokens.service';

@Module({
  controllers: [AdminTokensController, AdminLearnersController],
  providers: [AdminTokensService],
  exports: [AdminTokensService],
})
export class AdminModule {}
