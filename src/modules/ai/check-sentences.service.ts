import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ThinkingLevel } from '@google/genai';
import {
  AI_MISTAKE_CATEGORIES,
  MISTAKE_CATEGORIES,
} from '../../common/mistake-categories';
import type { AccessContext } from '../../common/types/access-context';
import { AiQuotaService } from './ai-quota.service';
import { assertAiMenu } from './ai.service';
import { parseCheck, type SentenceCheck } from './check-block';
import {
  CheckSentencesDto,
  CheckSentencesResultDto,
} from './dto/check-sentences.dto';
import { GeminiJsonService } from './gemini-json.service';

const LEVEL_NAME: Record<string, string> = {
  beginner: 'pemula (A1)',
  pre: 'pre-intermediate (A2)',
  inter: 'intermediate (B1)',
  upper: 'upper-intermediate (B2)',
};

export const checkInstruction = (level: string) =>
  `Kamu guru bahasa Inggris untuk orang dewasa Indonesia level ${LEVEL_NAME[level] ?? level}.
Pelajar menulis beberapa kalimat bahasa Inggris buatannya sendiri. Cek setiap kalimat, urut sesuai masukan, satu hasil per kalimat:
- "original": kalimat pelajar persis seperti ditulis.
- "is_correct": true bila kalimat sudah benar dan wajar; false bila ada kesalahan.
- "corrected": kalimat yang benar (sama dengan aslinya bila sudah benar). Ubah sesedikit mungkin.
- "explanation_id": alasan singkat bahasa Indonesia, 1 kalimat.
- "category": salah satu id ini: ${AI_MISTAKE_CATEGORIES.map((id) => `${id} (${MISTAKE_CATEGORIES[id]})`).join('; ')}.`;

const CHECK_ITEM = {
  type: 'object',
  properties: {
    original: { type: 'string' },
    is_correct: { type: 'boolean' },
    corrected: { type: 'string' },
    explanation_id: { type: 'string' },
    category: { type: 'string', enum: [...AI_MISTAKE_CATEGORIES] },
  },
  required: [
    'original',
    'is_correct',
    'corrected',
    'explanation_id',
    'category',
  ],
};
export const CHECK_SENTENCES_SCHEMA = {
  type: 'object',
  properties: { checks: { type: 'array', items: CHECK_ITEM } },
  required: ['checks'],
};

/** One result per sentence, in order; null when the answer is unusable. */
export const parseChecks = (
  raw: string | undefined,
  sentences: string[],
): SentenceCheck[] | null => {
  let o: { checks?: unknown };
  try {
    o = JSON.parse(raw ?? '') as { checks?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(o.checks) || o.checks.length < sentences.length)
    return null;
  const out: SentenceCheck[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const c = parseCheck(JSON.stringify(o.checks[i]));
    if (!c) return null;
    out.push({ ...c, original: sentences[i] });
  }
  return out;
};

// "Rencana › Pakai": up to three sentences checked in one Gemini call, so
// they take one question off the Tanya AI daily quota (refunded when the
// call fails).
@Injectable()
export class CheckSentencesService {
  constructor(
    private readonly gemini: GeminiJsonService,
    private readonly quota: AiQuotaService,
  ) {}

  async check(
    access: AccessContext,
    dto: CheckSentencesDto,
  ): Promise<CheckSentencesResultDto> {
    assertAiMenu(access);
    const sentences = dto.sentences
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (!sentences.length)
      throw new UnprocessableEntityException({
        field: 'sentences',
        message: 'check_no_sentences',
      });
    await this.gemini.client(); // 503 before touching the quota
    await this.quota.consume(access.tokenId, access.aiDailyLimit);
    try {
      const raw = await this.gemini.generate(
        checkInstruction(dto.level),
        [
          {
            role: 'user',
            parts: [
              {
                text: sentences.map((s, i) => `${i + 1}. ${s}`).join('\n'),
              },
            ],
          },
        ],
        CHECK_SENTENCES_SCHEMA,
        {
          thinking: ThinkingLevel.LOW,
          maxOutputTokens: 1024,
          temperature: 0.2,
          timeoutMs: 45_000,
        },
      );
      const checks = parseChecks(raw, sentences);
      if (!checks) throw new Error('unusable check answer');
      return new CheckSentencesResultDto({ checks });
    } catch (err) {
      await this.quota.refund(access.tokenId);
      throw this.gemini.failed(err);
    }
  }
}
