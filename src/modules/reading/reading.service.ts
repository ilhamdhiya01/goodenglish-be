import {
  ConflictException,
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
import type { Prisma, ReadingText } from '../../generated/prisma/client';
import { jakartaDay } from '../ai/ai-quota.service';
import { GeminiJsonService } from '../ai/gemini-json.service';
import {
  AdminListQueryDto,
  GenerateReadingDto,
  ReadingTextDto,
  UpdateReadingDto,
} from './dto/reading.dto';
import {
  ReadingContentError,
  parseGenerated,
  validateText,
  type ReadingContent,
  type ReadingQuestion,
  type ReadingWarning,
} from './reading.parse';
import {
  GENERATE_SCHEMA,
  dailyInstruction,
  generateInstruction,
} from './reading.prompts';

export const assertReading = (access: AccessContext): void => {
  if (!access.menus.includes(Menu.READING)) {
    throw new ForbiddenException({ field: '', message: 'reading_not_allowed' });
  }
};

const toDto = (t: ReadingText) =>
  new ReadingTextDto({
    id: t.id,
    level: levelFromDb(t.level),
    week: t.week,
    slot: t.slot,
    status: t.status === 'PUBLISHED' ? 'published' : 'draft',
    title: t.title,
    paragraphs: t.paragraphs as unknown as ReadingTextDto['paragraphs'],
    targetWordsUsed: t.targetWordsUsed as unknown as string[],
    glossary: t.glossary as unknown as ReadingTextDto['glossary'],
    questions: t.questions as unknown as ReadingTextDto['questions'],
    wordCount: t.wordCount,
    warnings: t.warnings as unknown as ReadingWarning[],
    createdBy: t.createdBy,
    publishedAt: t.publishedAt,
    day: t.day ? t.day.toISOString().slice(0, 10) : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  });

const json = (v: unknown) => v as Prisma.InputJsonValue;
const contentData = (c: ReadingContent, warnings: ReadingWarning[]) => ({
  title: c.title,
  paragraphs: json(c.paragraphs),
  targetWordsUsed: json(c.targetWordsUsed),
  glossary: json(c.glossary),
  questions: json(c.questions),
  wordCount: c.wordCount,
  warnings: json(warnings),
});

// Wire (camelCase) question → the shape validateText reads.
const rawQuestion = (
  q: Partial<ReadingQuestion> & Record<string, unknown>,
) => ({
  type: q.type,
  question: q.question,
  options: q.options,
  answer_index: q.answerIndex,
  statement: q.statement,
  answer: q.answer,
  prompt_id: q.promptId,
  explanation_id: q.explanationId,
});

const unprocessable = (err: unknown) =>
  err instanceof ReadingContentError
    ? new UnprocessableEntityException({ field: '', message: err.code })
    : err;

// "Bacaan": graded reading texts (2 per level and week). Admins generate
// drafts with Gemini, edit, publish and delete; learners read published
// texts only. Drafts that miss a content rule are kept with `warnings`.
@Injectable()
export class ReadingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReadingService.name);
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

  // Learner: published texts of one level the token may open.
  async listPublished(
    access: AccessContext,
    level: LevelWire,
  ): Promise<ReadingTextDto[]> {
    assertReading(access);
    await assertLevelOpen(this.prisma, access, level);
    const texts = await this.prisma.readingText.findMany({
      where: {
        level: LEVEL_WIRE[level],
        status: 'PUBLISHED',
        ...weeklyOrRecent(),
      },
      orderBy: [{ week: 'asc' }, { slot: 'asc' }, { publishedAt: 'asc' }],
    });
    return texts.map(toDto);
  }

  async adminList(q: AdminListQueryDto): Promise<ReadingTextDto[]> {
    const texts = await this.prisma.readingText.findMany({
      where: {
        ...(q.level ? { level: LEVEL_WIRE[q.level] } : {}),
        ...(q.week !== undefined ? { week: q.week } : {}),
        ...(q.status
          ? { status: q.status === 'published' ? 'PUBLISHED' : 'DRAFT' }
          : {}),
      },
      orderBy: [
        { level: 'asc' },
        { week: 'asc' },
        { slot: 'asc' },
        { createdAt: 'asc' },
      ],
    });
    return texts.map(toDto);
  }

  // One text per call (they are long). Saved as a DRAFT with its warnings.
  async generate(dto: GenerateReadingDto, by: string): Promise<ReadingTextDto> {
    const words = dto.words.map((w) => w.trim()).filter(Boolean);
    const ask = async () =>
      parseGenerated(
        await this.gemini.generate(
          generateInstruction({
            level: dto.level,
            week: dto.week,
            slot: dto.slot,
            words,
            tense: dto.tense,
          }),
          [{ role: 'user', parts: [{ text: 'Write the text now.' }] }],
          GENERATE_SCHEMA,
          { maxOutputTokens: 8192, timeoutMs: 90_000 },
        ),
        dto.slot,
        words,
      );
    let parsed: ReturnType<typeof parseGenerated>;
    try {
      // A broken answer (e.g. a question without its key) gets one retry.
      parsed = await ask().catch((err: unknown) => {
        if (err instanceof HttpException) throw err;
        return ask();
      });
    } catch (err) {
      throw this.gemini.failed(err);
    }
    const text = await this.prisma.readingText.create({
      data: {
        level: LEVEL_WIRE[dto.level],
        week: dto.week,
        slot: dto.slot,
        status: 'DRAFT',
        createdBy: by,
        ...contentData(parsed.content, parsed.warnings),
      },
    });
    return toDto(text);
  }

  // Bacaan harian: one published text per level for today (WIB), any topic.
  // Published without review, as asked; admins can still hide or delete it.
  async generateDaily(): Promise<void> {
    const day = jakartaDay();
    for (const level of LEVEL_WIRE_VALUES) {
      const has = await this.prisma.readingText.findFirst({
        where: { level: LEVEL_WIRE[level], day },
        select: { id: true },
      });
      if (has) continue;
      const recent = await this.prisma.readingText.findMany({
        where: { level: LEVEL_WIRE[level], day: { not: null } },
        orderBy: { day: 'desc' },
        take: 14,
        select: { title: true },
      });
      const ask = async () => {
        const parsed = parseGenerated(
          await this.gemini.generate(
            dailyInstruction(
              level,
              recent.map((r) => r.title),
            ),
            [{ role: 'user', parts: [{ text: 'Write the text now.' }] }],
            GENERATE_SCHEMA,
            { maxOutputTokens: 8192, timeoutMs: 90_000 },
          ),
          'A',
          [],
        );
        // Length and vocabulary don't matter here; an unanswerable question does.
        if (parsed.warnings.some((w) => w.code === 'find_word_not_in_text'))
          throw new Error('find_word not in text');
        return parsed.content;
      };
      try {
        const content = await ask().catch((err: unknown) => {
          if (err instanceof HttpException) throw err;
          return ask();
        });
        await this.prisma.readingText.create({
          data: {
            level: LEVEL_WIRE[level],
            week: 0,
            slot: 'A',
            day,
            status: 'PUBLISHED',
            publishedAt: new Date(),
            createdBy: 'Otomatis',
            ...contentData(content, []),
          },
        });
      } catch (err) {
        // Another process made it first (unique level + day): nothing to do.
        if ((err as { code?: unknown } | null)?.code === 'P2002') continue;
        this.logger.warn(`Bacaan harian ${level}: ${String(err)}`);
      }
    }
  }

  // Editing keeps who made the text (createdBy).
  async update(id: string, dto: UpdateReadingDto): Promise<ReadingTextDto> {
    const cur = toDto(await this.findOrThrow(id));
    let parsed: ReturnType<typeof validateText>;
    try {
      parsed = validateText(
        {
          title: dto.title ?? cur.title,
          paragraphs: dto.paragraphs ?? cur.paragraphs,
          target_words_used: dto.targetWordsUsed ?? cur.targetWordsUsed,
          glossary: (dto.glossary ?? cur.glossary).map((g) => ({
            word: g.word,
            meaning_id: g.meaningId,
          })),
          questions: (
            (dto.questions ?? cur.questions) as unknown as Record<
              string,
              unknown
            >[]
          ).map(rawQuestion),
        },
        cur.slot,
        // Without the week's words, count the ones the text claims.
        dto.words?.length ? dto.words : [],
      );
    } catch (err) {
      throw unprocessable(err);
    }
    // A daily text has no length or week-word rules, as when it was made.
    const warnings = cur.day
      ? parsed.warnings.filter((w) => w.code === 'find_word_not_in_text')
      : parsed.warnings;
    const text = await this.prisma.readingText.update({
      where: { id },
      data: contentData(parsed.content, warnings),
    });
    return toDto(text);
  }

  // One published text per level, week and slot; a text that misses a
  // content rule only goes out on purpose (force).
  async setPublished(
    id: string,
    published: boolean,
    force = false,
  ): Promise<ReadingTextDto> {
    const cur = await this.findOrThrow(id);
    if (published && cur.status !== 'PUBLISHED') {
      const taken = await this.prisma.readingText.findFirst({
        where: {
          level: cur.level,
          week: cur.week,
          slot: cur.slot,
          // Daily texts share week 0: only the same day competes.
          day: cur.day,
          status: 'PUBLISHED',
          id: { not: id },
        },
        select: { id: true },
      });
      if (taken)
        throw new ConflictException({
          field: 'slot',
          message: 'reading_slot_taken',
        });
      const warnings = Array.isArray(cur.warnings) ? cur.warnings : [];
      if (warnings.length && !force)
        throw new UnprocessableEntityException({
          field: 'force',
          message: 'reading_has_warnings',
        });
    }
    const text = await this.prisma.readingText.update({
      where: { id },
      data: published
        ? { status: 'PUBLISHED', publishedAt: new Date() }
        : { status: 'DRAFT', publishedAt: null },
    });
    return toDto(text);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.readingText.delete({ where: { id } });
  }

  private async findOrThrow(id: string): Promise<ReadingText> {
    const text = await this.prisma.readingText.findUnique({ where: { id } });
    if (!text) {
      throw new NotFoundException({
        field: 'id',
        message: 'reading_not_found',
      });
    }
    return text;
  }
}
