import {
  ForbiddenException,
  HttpException,
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
import type { Prisma, ReadingText } from '../../generated/prisma/client';
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
import { GENERATE_SCHEMA, generateInstruction } from './reading.prompts';

export const assertReading = (access: AccessContext): void => {
  if (!access.menus.includes(Menu.READING)) {
    throw new ForbiddenException({ field: '', message: 'reading_not_allowed' });
  }
};

export const assertLevel = (access: AccessContext, level: LevelWire): void => {
  if (!access.levels.includes(LEVEL_WIRE[level])) {
    throw new ForbiddenException({
      field: 'level',
      message: 'level_not_allowed',
    });
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
export class ReadingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiJsonService,
  ) {}

  // Learner: published texts of one level the token may open.
  async listPublished(
    access: AccessContext,
    level: LevelWire,
  ): Promise<ReadingTextDto[]> {
    assertReading(access);
    assertLevel(access, level);
    const texts = await this.prisma.readingText.findMany({
      where: { level: LEVEL_WIRE[level], status: 'PUBLISHED' },
      orderBy: [{ week: 'asc' }, { slot: 'asc' }, { publishedAt: 'asc' }],
    });
    return texts.map(toDto);
  }

  async adminList(q: AdminListQueryDto): Promise<ReadingTextDto[]> {
    const texts = await this.prisma.readingText.findMany({
      where: {
        ...(q.level ? { level: LEVEL_WIRE[q.level] } : {}),
        ...(q.week ? { week: q.week } : {}),
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

  async update(
    id: string,
    dto: UpdateReadingDto,
    by: string,
  ): Promise<ReadingTextDto> {
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
    const text = await this.prisma.readingText.update({
      where: { id },
      data: { ...contentData(parsed.content, parsed.warnings), createdBy: by },
    });
    return toDto(text);
  }

  async setPublished(id: string, published: boolean): Promise<ReadingTextDto> {
    await this.findOrThrow(id);
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
