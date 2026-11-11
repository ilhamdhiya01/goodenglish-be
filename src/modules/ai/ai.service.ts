import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import type { AccessContext } from '../../common/types/access-context';
import { Menu } from '../../generated/prisma/enums';
import { AiQuotaService } from './ai-quota.service';
import { AiSettingsService } from './ai-settings.service';
import { createGemini } from './gemini.client';
import { CHECK_SCHEMA, chatInstruction, checkInstruction } from './ai.prompts';
import { ChatDto, MAX_QUESTION_CHARS } from './dto/chat.dto';
import {
  CHECK_VERDICTS,
  CheckDto,
  CheckResultDto,
  type CheckVerdict,
} from './dto/check.dto';

// Every thinking token adds latency and cost. Chat answers are short
// explanations (MINIMAL halved the wait for the first words in testing);
// judging a sentence is worth a little more care.
const CHAT_THINKING = { thinkingLevel: ThinkingLevel.MINIMAL };
const CHECK_THINKING = { thinkingLevel: ThinkingLevel.LOW };

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  // One client per key: rebuilt only when an admin saves a different one.
  private cached: { apiKey: string; client: GoogleGenAI } | null = null;

  constructor(
    private readonly settings: AiSettingsService,
    private readonly quota: AiQuotaService,
  ) {}

  // Everything that can reject a request, run before the SSE headers go out
  // so the rejection is still a normal JSON error. Key and model come from
  // Admin › Tanya AI on every call, so a change applies right away.
  private async gate(
    access: AccessContext,
  ): Promise<{ client: GoogleGenAI; model: string }> {
    if (!access.menus.includes(Menu.AI)) {
      throw new ForbiddenException({ field: '', message: 'ai_not_allowed' });
    }
    const active = await this.settings.active();
    if (!active) {
      throw new ServiceUnavailableException({
        field: '',
        message: 'ai_unavailable',
      });
    }
    if (this.cached?.apiKey !== active.apiKey) {
      this.cached = {
        apiKey: active.apiKey,
        client: createGemini(active.apiKey),
      };
    }
    return { client: this.cached.client, model: active.model };
  }

  // Starts the answer stream and returns its text chunks. Quota is taken
  // here and given back if Gemini refuses the request outright.
  async startChat(
    access: AccessContext,
    dto: ChatDto,
    abortSignal?: AbortSignal,
  ): Promise<AsyncGenerator<string>> {
    const { client, model } = await this.gate(access);
    const last = dto.messages[dto.messages.length - 1];
    if (last.role !== 'user' || last.text.length > MAX_QUESTION_CHARS) {
      throw new UnprocessableEntityException({
        field: 'messages',
        message: 'ai_bad_question',
      });
    }
    await this.quota.consume(access.tokenId, access.aiDailyLimit);

    const contents: Content[] = dto.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));
    let stream: AsyncGenerator<{ text?: string }>;
    try {
      stream = await client.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: chatInstruction(dto.context),
          maxOutputTokens: 2048,
          temperature: 0.4,
          thinkingConfig: CHAT_THINKING,
          abortSignal,
        },
      });
    } catch (err) {
      await this.quota.refund(access.tokenId);
      this.logger.error(err instanceof Error ? err.message : err);
      throw new BadGatewayException({ field: '', message: 'ai_failed' });
    }
    return (async function* () {
      for await (const chunk of stream) if (chunk.text) yield chunk.text;
    })();
  }

  async check(access: AccessContext, dto: CheckDto): Promise<CheckResultDto> {
    const { client, model } = await this.gate(access);
    await this.quota.consume(access.tokenId, access.aiDailyLimit);
    try {
      const res = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: dto.sentence }] }],
        config: {
          systemInstruction: checkInstruction(dto.context),
          maxOutputTokens: 1024,
          temperature: 0.2,
          thinkingConfig: CHECK_THINKING,
          responseMimeType: 'application/json',
          responseJsonSchema: CHECK_SCHEMA,
        },
      });
      return parseCheck(res.text, dto.sentence);
    } catch (err) {
      await this.quota.refund(access.tokenId);
      this.logger.error(err instanceof Error ? err.message : err);
      throw new BadGatewayException({ field: '', message: 'ai_failed' });
    }
  }
}

// The schema is enforced by Gemini, but a truncated or odd reply must not
// reach the learner as a crash.
export const parseCheck = (
  raw: string | undefined,
  sentence: string,
): CheckResultDto => {
  const json = JSON.parse(raw ?? '') as Partial<Record<string, unknown>>;
  const verdict = CHECK_VERDICTS.includes(json.verdict as CheckVerdict)
    ? (json.verdict as CheckVerdict)
    : null;
  if (!verdict || typeof json.explanation !== 'string') {
    throw new Error('Malformed check result');
  }
  const typos = Array.isArray(json.typos)
    ? (json.typos as unknown[])
        .map((t) => t as { wrong?: unknown; correct?: unknown })
        .filter(
          (t): t is { wrong: string; correct: string } =>
            typeof t.wrong === 'string' &&
            typeof t.correct === 'string' &&
            !!t.wrong.trim() &&
            !!t.correct.trim() &&
            t.wrong.trim().toLowerCase() !== t.correct.trim().toLowerCase(),
        )
        .map((t) => ({ wrong: t.wrong.trim(), correct: t.correct.trim() }))
        .slice(0, 10)
    : [];
  return new CheckResultDto({
    // A sentence with a typo isn't "correct", whatever the model said.
    verdict: verdict === 'correct' && typos.length ? 'almost' : verdict,
    typos,
    corrected:
      typeof json.corrected === 'string' && json.corrected.trim()
        ? json.corrected.trim()
        : sentence,
    explanation: json.explanation.trim(),
    alternatives: Array.isArray(json.alternatives)
      ? json.alternatives
          .filter((a): a is string => typeof a === 'string' && !!a.trim())
          .slice(0, 2)
      : [],
  });
};
