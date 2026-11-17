import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import { AiSettingsService } from './ai-settings.service';
import { createGemini } from './gemini.client';

export interface GeminiJsonOptions {
  thinking?: ThinkingLevel;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
}

// One JSON-schema call to Gemini with the key and model from Admin › Tanya
// AI. Used by features that need structured output (Menyimak's question
// bank). Callers parse and validate `text` themselves.
@Injectable()
export class GeminiJsonService {
  private readonly logger = new Logger(GeminiJsonService.name);
  private cached: { apiKey: string; client: GoogleGenAI } | null = null;

  constructor(private readonly settings: AiSettingsService) {}

  /** 503 ai_unavailable when no key is saved. */
  async client(): Promise<{ client: GoogleGenAI; model: string }> {
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

  async generate(
    systemInstruction: string,
    contents: Content[],
    schema: object,
    opts: GeminiJsonOptions = {},
  ): Promise<string | undefined> {
    const { client, model } = await this.client();
    const res = await client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        maxOutputTokens: opts.maxOutputTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
        thinkingConfig: { thinkingLevel: opts.thinking ?? ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
      },
    });
    return res.text;
  }

  /** Our own HttpExceptions pass through; anything else is 502 ai_failed. */
  failed(err: unknown): HttpException {
    if (err instanceof HttpException) return err;
    this.logger.error(err instanceof Error ? err.message : err);
    return new BadGatewayException({ field: '', message: 'ai_failed' });
  }
}
