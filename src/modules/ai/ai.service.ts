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
import { AiConversationsService } from './ai-conversations.service';
import { AiQuotaService } from './ai-quota.service';
import { AiSettingsService } from './ai-settings.service';
import { createGemini } from './gemini.client';
import { chatInstruction } from './ai.prompts';
import { ChatDto, MAX_QUESTION_CHARS } from './dto/chat.dto';

// Every thinking token adds latency and cost. Chat answers are short
// explanations (MINIMAL halved the wait for the first words in testing).
const CHAT_THINKING = { thinkingLevel: ThinkingLevel.MINIMAL };

// Only tokens granted the AI menu may ask or read their history.
export const assertAiMenu = (access: AccessContext): void => {
  if (!access.menus.includes(Menu.AI)) {
    throw new ForbiddenException({ field: '', message: 'ai_not_allowed' });
  }
};

export interface ChatStart {
  conversationId: string;
  stream: AsyncGenerator<string>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  // One client per key: rebuilt only when an admin saves a different one.
  private cached: { apiKey: string; client: GoogleGenAI } | null = null;

  constructor(
    private readonly settings: AiSettingsService,
    private readonly quota: AiQuotaService,
    private readonly conversations: AiConversationsService,
  ) {}

  // Everything that can reject a request, run before the SSE headers go out
  // so the rejection is still a normal JSON error. Key and model come from
  // Admin › Tanya AI on every call, so a change applies right away.
  private async gate(
    access: AccessContext,
  ): Promise<{ client: GoogleGenAI; model: string }> {
    assertAiMenu(access);
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
  // here and given back if Gemini refuses the request outright. The question
  // is stored only once Gemini has accepted it (the answer is stored by the
  // controller when the stream ends), so a refused request leaves no trace.
  async startChat(
    access: AccessContext,
    dto: ChatDto,
    abortSignal?: AbortSignal,
  ): Promise<ChatStart> {
    const { client, model } = await this.gate(access);
    const last = dto.messages[dto.messages.length - 1];
    if (last.role !== 'user' || last.text.length > MAX_QUESTION_CHARS) {
      throw new UnprocessableEntityException({
        field: 'messages',
        message: 'ai_bad_question',
      });
    }
    if (dto.conversationId) {
      await this.conversations.assertOwned(access.tokenId, dto.conversationId);
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
    const word = dto.context?.word
      ? { word: dto.context.word, meaning: dto.context.meaning }
      : undefined;
    const conversationId = await this.conversations.saveQuestion(
      access.tokenId,
      dto.conversationId,
      last.text,
      word,
    );
    return {
      conversationId,
      stream: (async function* () {
        for await (const chunk of stream) if (chunk.text) yield chunk.text;
      })(),
    };
  }
}
