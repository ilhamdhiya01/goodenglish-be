import { createHash } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ThinkingLevel } from '@google/genai';
import { assertLevelOpen } from '../../common/levels/effective-levels';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LEVEL_WIRE, levelFromDb } from '../../common/token/access-enums';
import type { Prisma, WordMeaning } from '../../generated/prisma/client';
import type { AccessContext } from '../../common/types/access-context';
import { GeminiJsonService } from '../ai/gemini-json.service';
import { SttRateLimiter } from '../stt/stt.service';
import {
  LookupDto,
  LookupResultDto,
  UpdateWordMeaningDto,
  WordMeaningDto,
  WordMeaningQueryDto,
} from './dto/reading.dto';
import { parseLookup } from './reading.parse';
import { LOOKUP_SCHEMA, lookupInstruction } from './reading.prompts';
import { assertReading } from './reading.service';

/** New (uncached) words a token may look up per minute. */
export const LOOKUPS_PER_MIN = 20;

/** The sentence as one key: case and spacing don't matter. */
export const normalizeSentence = (s: string | undefined) =>
  (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Short hash of the sentence a word was tapped in ("" = none). */
export const sentenceCtx = (s: string | undefined) => {
  const n = normalizeSentence(s);
  return n ? createHash('sha256').update(n).digest('hex').slice(0, 16) : '';
};

const toDto = (m: WordMeaning) =>
  new WordMeaningDto({
    id: m.id,
    word: m.word,
    level: levelFromDb(m.level),
    sentence: m.sentence,
    lemma: m.lemma,
    meaningId: m.meaningId,
    pron: m.pron,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  });

// Meaning of a tapped word that is in neither Kosakata nor the text's
// glossary. One shared cache per (word, level, sentence): the same word can
// mean different things in different sentences, so Gemini is asked once per
// sentence, then every learner gets the saved answer. Rows from before
// (no sentence) are only a fallback when the rate limit is hit. Not counted
// against Tanya AI's daily quota; only uncached lookups are rate limited per
// token. Admins can correct or remove a saved meaning.
@Injectable()
export class WordLookupService {
  readonly limiter = new SttRateLimiter(LOOKUPS_PER_MIN);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiJsonService,
  ) {}

  async lookup(
    access: AccessContext,
    dto: LookupDto,
  ): Promise<LookupResultDto> {
    assertReading(access);
    await assertLevelOpen(this.prisma, access, dto.level);
    const word = dto.word.toLowerCase().replace(/’/g, "'");
    const level = LEVEL_WIRE[dto.level];
    const sentence = dto.sentence?.trim() ?? '';
    const ctx = sentenceCtx(sentence);

    const hit = await this.prisma.wordMeaning.findUnique({
      where: { word_level_ctx: { word, level, ctx } },
    });
    if (hit) {
      return new LookupResultDto({
        word,
        lemma: hit.lemma,
        meaningId: hit.meaningId,
        pron: hit.pron,
        cached: true,
      });
    }

    if (!this.limiter.take(access.tokenId)) {
      // Rather an older meaning without the sentence than nothing.
      const any = ctx
        ? await this.prisma.wordMeaning.findFirst({
            where: { word, level },
            orderBy: { ctx: 'asc' },
          })
        : null;
      if (any)
        return new LookupResultDto({
          word,
          lemma: any.lemma,
          meaningId: any.meaningId,
          pron: any.pron,
          cached: true,
        });
      throw new HttpException(
        { field: '', message: 'lookup_rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    let found: ReturnType<typeof parseLookup>;
    try {
      const raw = await this.gemini.generate(
        lookupInstruction(dto.level),
        [
          {
            role: 'user',
            parts: [
              {
                text: `Word: "${word}"${sentence ? `\nSentence: "${sentence}"` : ''}`,
              },
            ],
          },
        ],
        LOOKUP_SCHEMA,
        {
          thinking: ThinkingLevel.MINIMAL,
          maxOutputTokens: 256,
          temperature: 0.2,
          timeoutMs: 30_000,
        },
      );
      found = parseLookup(raw);
    } catch (err) {
      throw this.gemini.failed(err);
    }
    // upsert: two learners may tap the same new word at once.
    const saved = await this.prisma.wordMeaning.upsert({
      where: { word_level_ctx: { word, level, ctx } },
      create: { word, level, ctx, sentence: sentence.slice(0, 400), ...found },
      update: {},
    });
    return new LookupResultDto({
      word,
      lemma: saved.lemma,
      meaningId: saved.meaningId,
      pron: saved.pron,
      cached: false,
    });
  }

  // Admin › Bacaan › Arti kata: the saved meanings, newest first.
  async adminList(q: WordMeaningQueryDto): Promise<WordMeaningDto[]> {
    const where: Prisma.WordMeaningWhereInput = {
      ...(q.level ? { level: LEVEL_WIRE[q.level] } : {}),
      ...(q.q?.trim()
        ? { word: { startsWith: q.q.trim().toLowerCase() } }
        : {}),
    };
    const rows = await this.prisma.wordMeaning.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    });
    return rows.map(toDto);
  }

  async adminUpdate(
    id: string,
    dto: UpdateWordMeaningDto,
  ): Promise<WordMeaningDto> {
    await this.mustExist(id);
    const row = await this.prisma.wordMeaning.update({
      where: { id },
      data: {
        ...(dto.lemma !== undefined ? { lemma: dto.lemma.trim() } : {}),
        ...(dto.meaningId !== undefined
          ? { meaningId: dto.meaningId.trim() }
          : {}),
        ...(dto.pron !== undefined ? { pron: dto.pron.trim() } : {}),
      },
    });
    return toDto(row);
  }

  // Removing a wrong meaning: the next tap asks Gemini again.
  async adminRemove(id: string): Promise<void> {
    await this.mustExist(id);
    await this.prisma.wordMeaning.delete({ where: { id } });
  }

  private async mustExist(id: string) {
    const row = await this.prisma.wordMeaning.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException({
        field: 'id',
        message: 'word_meaning_not_found',
      });
  }
}
