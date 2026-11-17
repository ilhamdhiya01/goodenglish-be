import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  LEVEL_WIRE,
  levelFromDb,
  type LevelWire,
} from '../../common/token/access-enums';
import type { AccessContext } from '../../common/types/access-context';
import { Menu } from '../../generated/prisma/enums';
import type { ListeningItem, Prisma } from '../../generated/prisma/client';
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
export class ListeningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiJsonService,
  ) {}

  // Learner: published items of one level the token may open.
  async listPublished(
    access: AccessContext,
    level: LevelWire,
  ): Promise<ListeningItemDto[]> {
    assertListening(access);
    const lvl = LEVEL_WIRE[level];
    if (!access.levels.includes(lvl)) {
      throw new ForbiddenException({
        field: 'level',
        message: 'level_not_allowed',
      });
    }
    const items = await this.prisma.listeningItem.findMany({
      where: { level: lvl, status: 'PUBLISHED' },
      orderBy: [{ week: 'asc' }, { publishedAt: 'asc' }],
    });
    return items.map(toDto);
  }

  async adminList(q: AdminListQueryDto): Promise<ListeningItemDto[]> {
    const items = await this.prisma.listeningItem.findMany({
      where: {
        ...(q.level ? { level: LEVEL_WIRE[q.level] } : {}),
        ...(q.week ? { week: q.week } : {}),
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

  async update(
    id: string,
    dto: UpdateListeningDto,
    by: string,
  ): Promise<ListeningItemDto> {
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
        createdBy: by,
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
