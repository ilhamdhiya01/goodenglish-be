import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AdminReadingController } from './admin-reading.controller';
import { AdminWordMeaningsController } from './admin-word-meanings.controller';
import { ReadingController } from './reading.controller';
import { ReadingService } from './reading.service';
import { WordLookupService } from './word-lookup.service';

@Module({
  imports: [AiModule],
  controllers: [
    ReadingController,
    AdminReadingController,
    AdminWordMeaningsController,
  ],
  providers: [ReadingService, WordLookupService],
})
export class ReadingModule {}
