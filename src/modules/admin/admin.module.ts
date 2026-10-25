import { Module } from '@nestjs/common';
import { AdminTokensController } from './admin-tokens.controller';
import { AdminTokensService } from './admin-tokens.service';

@Module({
  controllers: [AdminTokensController],
  providers: [AdminTokensService],
  exports: [AdminTokensService],
})
export class AdminModule {}
