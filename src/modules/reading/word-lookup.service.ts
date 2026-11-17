import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThinkingLevel } from '@google/genai';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LEVEL_WIRE } from '../../common/token/access-enums';
import type { AccessContext } from '../../common/types/access-context';
import { GeminiJsonService } from '../ai/gemini-json.service';
import { SttRateLimiter } from '../stt/stt.service';
import { LookupDto, LookupResultDto } from './dto/reading.dto';
import { parseLookup } from './reading.parse';
import { LOOKUP_SCHEMA, lookupInstruction } from './reading.prompts';
import { assertLevel, assertReading } from './reading.service';

/** New (uncached) words a token may look up per minute. */
export const LOOKUPS_PER_MIN = 20;

// Meaning of a tapped word that is in neither Kosakata nor the text's
// glossary. One shared cache per (word, level): Gemini is asked once, then
// every learner gets the saved answer. Not counted against Tanya AI's daily
// quota; only uncached lookups are rate limited per token.
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
    assertLevel(access, dto.level);
    const word = dto.word.toLowerCase().replace(/’/g, "'");
    const level = LEVEL_WIRE[dto.level];

    const hit = await this.prisma.wordMeaning.findUnique({
      where: { word_level: { word, level } },
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
      throw new HttpException(
        { field: '', message: 'lookup_rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    let found: ReturnType<typeof parseLookup>;
    try {
      const sentence = dto.sentence?.trim();
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
      where: { word_level: { word, level } },
      create: { word, level, ...found },
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
}
