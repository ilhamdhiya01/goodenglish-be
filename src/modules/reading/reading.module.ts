import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AdminReadingController } from './admin-reading.controller';
import { ReadingController } from './reading.controller';
import { ReadingService } from './reading.service';
import { WordLookupService } from './word-lookup.service';

@Module({
  imports: [AiModule],
  controllers: [ReadingController, AdminReadingController],
  providers: [ReadingService, WordLookupService],
})
export class ReadingModule {}
