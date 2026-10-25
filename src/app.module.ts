import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ProgressModule } from './modules/progress/progress.module';

@Module({
  imports: [
    CommonModule,
    HealthModule,
    AuthModule,
    ProgressModule,
    AdminModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
