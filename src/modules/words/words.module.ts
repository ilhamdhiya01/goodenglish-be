import { Module } from '@nestjs/common';
import { AdminWordsController } from './admin-words.controller';
import { WordsController } from './words.controller';
import { WordsService } from './words.service';

@Module({
  controllers: [WordsController, AdminWordsController],
  providers: [WordsService],
})
export class WordsModule {}
