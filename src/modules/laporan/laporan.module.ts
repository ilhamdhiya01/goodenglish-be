import { Module } from '@nestjs/common';
import { LaporanController } from './laporan.controller';
import { LaporanService } from './laporan.service';

@Module({
  controllers: [LaporanController],
  providers: [LaporanService],
})
export class LaporanModule {}
