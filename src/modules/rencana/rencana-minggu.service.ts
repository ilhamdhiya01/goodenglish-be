import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  LEVEL_WIRE,
  levelFromDb,
  type LevelWire,
} from '../../common/token/access-enums';
import type { RencanaMinggu } from '../../generated/prisma/client';
import {
  PutRencanaMingguDto,
  RencanaMingguDto,
} from './dto/rencana-minggu.dto';

const toDto = (r: RencanaMinggu) =>
  new RencanaMingguDto({
    level: levelFromDb(r.level),
    week: r.week,
    scenarioId: r.scenarioId,
    grammarTopic: r.grammarTopic,
    updatedAt: r.updatedAt,
  });

// "Rencana": the grammar topic and scenario of each level's week, set by
// the admin. Learners read it to build the day's steps; weeks without a
// row fall back in the app.
@Injectable()
export class RencanaMingguService {
  constructor(private readonly prisma: PrismaService) {}

  async list(level: LevelWire): Promise<RencanaMingguDto[]> {
    const rows = await this.prisma.rencanaMinggu.findMany({
      where: { level: LEVEL_WIRE[level] },
      orderBy: { week: 'asc' },
    });
    return rows.map(toDto);
  }

  // Sets one week; a week with both fields empty is removed.
  async put(
    dto: PutRencanaMingguDto,
    by: string,
  ): Promise<RencanaMingguDto | null> {
    const level = LEVEL_WIRE[dto.level];
    const key = { level_week: { level, week: dto.week } };
    const cur = await this.prisma.rencanaMinggu.findUnique({ where: key });
    const scenarioId =
      dto.scenarioId !== undefined ? dto.scenarioId : (cur?.scenarioId ?? null);
    const grammarTopic =
      dto.grammarTopic !== undefined
        ? dto.grammarTopic
        : (cur?.grammarTopic ?? null);
    if (!scenarioId && !grammarTopic) {
      if (cur) await this.prisma.rencanaMinggu.delete({ where: key });
      return null;
    }
    const row = await this.prisma.rencanaMinggu.upsert({
      where: key,
      create: {
        level,
        week: dto.week,
        scenarioId,
        grammarTopic,
        updatedBy: by,
      },
      update: { scenarioId, grammarTopic, updatedBy: by },
    });
    return toDto(row);
  }
}
