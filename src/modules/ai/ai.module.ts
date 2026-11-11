import { Module } from '@nestjs/common';
import { AdminAiSettingsController } from './admin-ai-settings.controller';
import { AiQuotaService } from './ai-quota.service';
import { AiSettingsService } from './ai-settings.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  controllers: [AiController, AdminAiSettingsController],
  providers: [AiService, AiQuotaService, AiSettingsService],
})
export class AiModule {}
