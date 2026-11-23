import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  UnprocessableEntityException,
} from '@nestjs/common';
import { startHourly, weeklyOrRecent } from '../../common/daily-content';
import { assertLevelOpen } from '../../common/levels/effective-levels';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  LEVEL_WIRE,
  LEVEL_WIRE_VALUES,
  levelFromDb,
  type LevelWire,
} from '../../common/token/access-enums';
import type { AccessContext } from '../../common/types/access-context';
import { Menu } from '../../generated/prisma/enums';
import type { ListeningItem, Prisma } from '../../generated/prisma/client';
import { jakartaDay } from '../ai/ai-quota.service';
import { GeminiJsonService } from '../ai/gemini-json.service';
import {
  AdminListQueryDto,
  GenerateListeningDto,
  GenerateResultDto,
  ListeningItemDto,
  UpdateListeningDto,
} from './dto/listening.dto';
import {
  ListeningContentError,
  parseGenerated,
  validateContent,
  type ListeningContent,
} from './listening.parse';
import {
  GENERATE_SCHEMA,
  dailyInstruction,
  generateInstruction,
  type ListeningTypeWire,
} from './listening.prompts';

export const assertListening = (access: AccessContext): void => {
  if (!access.menus.includes(Menu.LISTENING)) {
    throw new ForbiddenException({
      field: '',
      message: 'listening_not_allowed',
    });
  }
};

const toDto = (i: ListeningItem) =>
  new ListeningItemDto({
    id: i.id,
    level: levelFromDb(i.level),
    week: i.week,
    status: i.status === 'PUBLISHED' ? 'published' : 'draft',
    type: i.type === 'MONOLOG' ? 'monolog' : 'dialog',
    title: i.title,
    lines: i.lines as unknown as ListeningItemDto['lines'],
    questions: i.questions as unknown as ListeningItemDto['questions'],
    wordCount: i.wordCount,
    createdBy: i.createdBy,
    publishedAt: i.publishedAt,
    day: i.day ? i.day.toISOString().slice(0, 10) : null,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  });

const contentData = (c: ListeningContent) => ({
  title: c.title,
  type: c.type === 'monolog' ? ('MONOLOG' as const) : ('DIALOG' as const),
  lines: c.lines as unknown as Prisma.InputJsonValue,
  questions: c.questions as unknown as Prisma.InputJsonValue,
  wordCount: c.wordCount,
});

// "Menyimak › Dengar & jawab" question bank. Admins generate drafts with
// Gemini, edit, publish and delete; learners read published items only.
@Injectable()
export class ListeningService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ListeningService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiJsonService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = startHourly(() => this.generateDaily(), this.logger);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  // Learner: published items of one level the token may open.
  async listPublished(
    access: AccessContext,
    level: LevelWire,
  ): Promise<ListeningItemDto[]> {
    assertListening(access);
    await assertLevelOpen(this.prisma, access, level);
    const lvl = LEVEL_WIRE[level];
    const items = await this.prisma.listeningItem.findMany({
      where: { level: lvl, status: 'PUBLISHED', ...weeklyOrRecent() },
      orderBy: [{ week: 'asc' }, { publishedAt: 'asc' }],
    });
    return items.map(toDto);
  }

  async adminList(q: AdminListQueryDto): Promise<ListeningItemDto[]> {
    const items = await this.prisma.listeningItem.findMany({
      where: {
        ...(q.level ? { level: LEVEL_WIRE[q.level] } : {}),
        ...(q.week !== undefined ? { week: q.week } : {}),
        ...(q.status
          ? { status: q.status === 'published' ? 'PUBLISHED' : 'DRAFT' }
          : {}),
      },
      orderBy: [{ level: 'asc' }, { week: 'asc' }, { createdAt: 'asc' }],
    });
    return items.map(toDto);
  }

  // One Gemini call per item, so one bad answer doesn't sink the others.
  // Everything generated is saved as a DRAFT; nothing reaches learners
  // until an admin publishes it.
  async generate(
    dto: GenerateListeningDto,
    by: string,
  ): Promise<GenerateResultDto> {
    await this.gemini.client(); // 503 ai_unavailable before doing anything
    const count = dto.count ?? 1;
    const types: ListeningTypeWire[] = Array.from({ length: count }, (_, i) =>
      dto.type === 'monolog'
        ? 'monolog'
        : dto.type === 'mixed'
          ? i % 2 === 0
            ? 'dialog'
            : 'monolog'
          : 'dialog',
    );
    const results = await Promise.allSettled(
      types.map(async (type) => {
        const raw = await this.gemini.generate(
          generateInstruction({
            level: dto.level,
            week: dto.week,
            type,
            words: dto.words.map((w) => w.trim()).filter(Boolean),
            tense: dto.tense,
          }),
          [{ role: 'user', parts: [{ text: 'Write the item now.' }] }],
          GENERATE_SCHEMA,
        );
        return parseGenerated(raw, type);
      }),
    );
    const ok = results.filter(
      (r): r is PromiseFulfilledResult<ListeningContent> =>
        r.status === 'fulfilled',
    );
    const firstError = results.find((r) => r.status === 'rejected');
    if (!ok.length && firstError?.status === 'rejected') {
      throw this.gemini.failed(firstError.reason);
    }
    const items = await Promise.all(
      ok.map((r) =>
        this.prisma.listeningItem.create({
          data: {
            level: LEVEL_WIRE[dto.level],
            week: dto.week,
            status: 'DRAFT',
            createdBy: by,
            ...contentData(r.value),
          },
        }),
      ),
    );
    return new GenerateResultDto({
      items: items.map(toDto),
      failed: results.length - ok.length,
    });
  }

  // Menyimak harian: one dialog and one monolog per level for today (WIB),
  // any topic, published without review; admins can still hide or delete.
  async generateDaily(): Promise<void> {
    const day = jakartaDay();
    for (const level of LEVEL_WIRE_VALUES) {
      for (const type of ['dialog', 'monolog'] as const) {
        const dbType = type === 'dialog' ? 'DIALOG' : 'MONOLOG';
        const has = await this.prisma.listeningItem.findFirst({
          where: { level: LEVEL_WIRE[level], day, type: dbType },
          select: { id: true },
        });
        if (has) continue;
        const recent = await this.prisma.listeningItem.findMany({
          where: { level: LEVEL_WIRE[level], day: { not: null } },
          orderBy: { day: 'desc' },
          take: 14,
          select: { title: true },
        });
        const ask = async () => {
          const content = parseGenerated(
            await this.gemini.generate(
              dailyInstruction(
                level,
                type,
                recent.map((r) => r.title),
              ),
              [{ role: 'user', parts: [{ text: 'Write the item now.' }] }],
              GENERATE_SCHEMA,
            ),
            type,
          );
          // The day's slot is per type: the other one would never be filled.
          if (content.type !== type) throw new Error(`got a ${content.type}`);
          return content;
        };
        try {
          const content = await ask().catch((err: unknown) => {
            if (err instanceof HttpException) throw err;
            return ask();
          });
          await this.prisma.listeningItem.create({
            data: {
              level: LEVEL_WIRE[level],
              week: 0,
              day,
              status: 'PUBLISHED',
              publishedAt: new Date(),
              createdBy: 'Otomatis',
              ...contentData(content),
            },
          });
        } catch (err) {
          // Another process made it first (unique level + day + type).
          if ((err as { code?: unknown } | null)?.code === 'P2002') continue;
          this.logger.warn(`Menyimak harian ${level} ${type}: ${String(err)}`);
        }
      }
    }
  }

  // Editing keeps who made the item (createdBy).
  async update(id: string, dto: UpdateListeningDto): Promise<ListeningItemDto> {
    const cur = await this.findOrThrow(id);
    const current = toDto(cur);
    let content: ListeningContent;
    try {
      content = validateContent({
        title: dto.title ?? current.title,
        type: dto.type ?? current.type,
        lines: dto.lines ?? current.lines,
        questions: (dto.questions ?? current.questions).map((q) => ({
          question: q.question,
          options: q.options,
          answer_index: q.answerIndex,
          explanation_id: q.explanationId,
        })),
      });
    } catch (err) {
      if (err instanceof ListeningContentError) {
        throw new UnprocessableEntityException({
          field: '',
          message: err.code,
        });
      }
      throw err;
    }
    const item = await this.prisma.listeningItem.update({
      where: { id },
      data: {
        ...contentData(content),
        ...(dto.week !== undefined ? { week: dto.week } : {}),
      },
    });
    return toDto(item);
  }

  async setPublished(
    id: string,
    published: boolean,
  ): Promise<ListeningItemDto> {
    await this.findOrThrow(id);
    const item = await this.prisma.listeningItem.update({
      where: { id },
      data: published
        ? { status: 'PUBLISHED', publishedAt: new Date() }
        : { status: 'DRAFT', publishedAt: null },
    });
    return toDto(item);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.listeningItem.delete({ where: { id } });
  }

  private async findOrThrow(id: string): Promise<ListeningItem> {
    const item = await this.prisma.listeningItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException({
        field: 'id',
        message: 'listening_not_found',
      });
    }
    return item;
  }
}
