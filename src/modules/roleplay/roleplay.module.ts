import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SttModule } from '../stt/stt.module';
import { RoleplayController } from './roleplay.controller';
import { RoleplayService } from './roleplay.service';

@Module({
  // AiSettingsService (Gemini key + model) comes from AiModule, so both
  // features share one settings cache.
  imports: [AiModule, SttModule],
  controllers: [RoleplayController],
  providers: [RoleplayService],
})
export class RoleplayModule {}
