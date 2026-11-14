import { Module } from '@nestjs/common';
import { AdminAiSettingsController } from './admin-ai-settings.controller';
import { AiConversationsService } from './ai-conversations.service';
import { AiQuotaService } from './ai-quota.service';
import { AiSettingsService } from './ai-settings.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  controllers: [AiController, AdminAiSettingsController],
  providers: [
    AiService,
    AiQuotaService,
    AiSettingsService,
    AiConversationsService,
  ],
})
export class AiModule {}
