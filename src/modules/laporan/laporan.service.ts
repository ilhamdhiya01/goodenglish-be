import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { dayIn, PILOT } from '../../common/pilot.config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RENCANA } from '../../common/rencana.config';
import { LEVEL_WIRE, levelFromDb } from '../../common/token/access-enums';
import type { AccessContext } from '../../common/types/access-context';
import type { ActivityReport, Prisma } from '../../generated/prisma/client';
import { LaporanDto, LaporanItemDto } from './dto/laporan.dto';

const toDto = (r: ActivityReport) =>
  new LaporanDto({
    id: r.id,
    jenis: r.jenis,
    menu: r.menu,
    level: r.level ? levelFromDb(r.level) : null,
    week: r.week,
    day: r.day,
    skor: r.skor,
    total: r.total,
    jumlah: r.jumlah,
    data: r.data ?? null,
    createdAt: r.createdAt,
  });

const dataOf = (d: unknown): Prisma.InputJsonValue | undefined => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return undefined;
  const text = JSON.stringify(d);
  return text.length <= RENCANA.reportDataMaxChars ? d : undefined;
};

// The activity log every menu reports to; "Rencana" reads only this.
// Append-only: a report sent twice (retry, outbox) is saved once, nothing
// is ever updated or deleted.
@Injectable()
export class LaporanService {
  private readonly logger = new Logger(LaporanService.name);

  constructor(private readonly prisma: PrismaService) {}

  private today(access: AccessContext, now = Date.now()) {
    return dayIn(now, access.timeZone || PILOT.defaultTimeZone);
  }

  /**
   * Saves a batch. A day after today (a device clock running ahead) is taken
   * as today; reports older than reportMaxAgeDays, or invalid ones, are
   * dropped. Returns how many were new.
   */
  async add(
    access: AccessContext,
    items: object[],
    now = Date.now(),
  ): Promise<{ saved: number }> {
    const today = this.today(access, now);
    const oldest = today - RENCANA.reportMaxAgeDays;
    const rows = items
      .map((o) => plainToInstance(LaporanItemDto, o))
      .filter((i) => {
        const [e] = validateSync(i);
        if (e)
          this.logger.warn(
            `laporan dropped: ${e.property} ${Object.values(e.constraints ?? {}).join(', ')}`,
          );
        return !e && i.day >= oldest;
      })
      .map((i) => ({
        id: i.id,
        accessTokenId: access.tokenId,
        jenis: i.jenis,
        menu: i.menu,
        level: i.level ? LEVEL_WIRE[i.level] : null,
        week: i.week ?? null,
        day: Math.min(i.day, today),
        skor: i.skor ?? null,
        total: i.total ?? null,
        jumlah: i.jumlah ?? null,
        data: dataOf(i.data),
      }));
    if (!rows.length) return { saved: 0 };
    const { count } = await this.prisma.activityReport.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return { saved: count };
  }

  /** Reports since a day (at most reportFetchMaxDays back), oldest first. */
  async list(
    access: AccessContext,
    sejak: number,
    now = Date.now(),
  ): Promise<LaporanDto[]> {
    const today = this.today(access, now);
    const from = Math.max(sejak, today - RENCANA.reportFetchMaxDays);
    const rows = await this.prisma.activityReport.findMany({
      where: { accessTokenId: access.tokenId, day: { gte: from } },
      orderBy: [{ day: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }
}
