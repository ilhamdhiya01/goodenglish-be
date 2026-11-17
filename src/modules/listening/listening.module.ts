import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AdminListeningController } from './admin-listening.controller';
import { ListeningController } from './listening.controller';
import { ListeningService } from './listening.service';

@Module({
  imports: [AiModule],
  controllers: [ListeningController, AdminListeningController],
  providers: [ListeningService],
})
export class ListeningModule {}
