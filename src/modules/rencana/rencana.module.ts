import { Module } from '@nestjs/common';
import {
  AdminRencanaController,
  RencanaController,
} from './rencana.controller';
import { RencanaMingguService } from './rencana-minggu.service';

@Module({
  controllers: [RencanaController, AdminRencanaController],
  providers: [RencanaMingguService],
})
export class RencanaModule {}
