import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiUsageDto } from './dto/usage.dto';

// The learners are in Indonesia: the quota resets at midnight WIB, not UTC.
export const jakartaDay = (now = new Date()): Date => {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
  }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
};

// The limit itself lives on the token (AccessToken.aiDailyLimit, null =
// unlimited) and reaches us through AccessContext, so an admin's change
// applies on the very next question.
@Injectable()
export class AiQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async usage(tokenId: string, limit: number | null): Promise<AiUsageDto> {
    const row = await this.prisma.aiUsage.findUnique({
      where: {
        accessTokenId_day: { accessTokenId: tokenId, day: jakartaDay() },
      },
    });
    return new AiUsageDto({ used: row?.count ?? 0, limit });
  }

  // Takes one question off today's quota, or throws 429. Incrementing first
  // and checking after keeps two requests at once from both slipping under
  // the limit. Unlimited tokens are still counted, just never refused.
  async consume(tokenId: string, limit: number | null): Promise<void> {
    const day = jakartaDay();
    const row = await this.prisma.aiUsage.upsert({
      where: { accessTokenId_day: { accessTokenId: tokenId, day } },
      create: { accessTokenId: tokenId, day, count: 1 },
      update: { count: { increment: 1 } },
    });
    if (limit !== null && row.count > limit) {
      await this.refund(tokenId);
      throw new HttpException(
        { field: '', message: 'ai_quota_exceeded' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // Gives the question back when the model call itself failed.
  async refund(tokenId: string): Promise<void> {
    await this.prisma.aiUsage.updateMany({
      where: { accessTokenId: tokenId, day: jakartaDay(), count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
  }
}
