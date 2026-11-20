import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { LaporanModule } from './modules/laporan/laporan.module';
import { ListeningModule } from './modules/listening/listening.module';
import { ReadingModule } from './modules/reading/reading.module';
import { RencanaModule } from './modules/rencana/rencana.module';
import { ProgressModule } from './modules/progress/progress.module';
import { RoleplayModule } from './modules/roleplay/roleplay.module';
import { SttModule } from './modules/stt/stt.module';
import { WordsModule } from './modules/words/words.module';

@Module({
  imports: [
    CommonModule,
    HealthModule,
    AuthModule,
    ProgressModule,
    AdminModule,
    WordsModule,
    AiModule,
    RoleplayModule,
    ListeningModule,
    ReadingModule,
    RencanaModule,
    LaporanModule,
    SttModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
