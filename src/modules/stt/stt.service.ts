import {
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AccessContext } from '../../common/types/access-context';
import { Menu } from '../../generated/prisma/enums';

export const STT_LANGUAGES = ['en', 'id'] as const;
export type SttLanguage = (typeof STT_LANGUAGES)[number];

// Same caps as the stt service (stt/core.py), checked here first so an
// oversized upload never leaves this process.
export const STT_MAX_BYTES = 5_000_000;

export interface SttResult {
  text: string;
  language: SttLanguage;
  durationSec: number;
}

/** What multer hands over for an uploaded file (memory storage). */
export interface UploadedAudio {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

// stt error code → this API's error code (shown via ACCESS_ERRORS on the FE).
const STT_CODES: Record<string, string> = {
  no_speech: 'stt_no_speech',
  too_long: 'stt_too_long',
  too_large: 'stt_too_large',
  bad_audio: 'stt_bad_audio',
  busy: 'stt_busy',
  not_ready: 'stt_busy',
  bad_language: 'stt_bad_language',
};

const fail = (status: number, message: string) =>
  new HttpException({ field: 'audio', message }, status);

/**
 * Sliding-window limit per access token: at most `max` recordings in any
 * 60 s. In memory, which is enough for a single backend process (like the
 * cached AI settings).
 */
export class SttRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs = 60_000,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Keep the map from growing with idle tokens.
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }
}

// Talks to the self-hosted faster-whisper service (stt/). The audio is only
// passed through: never stored, and the transcript is never logged.
@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);
  private readonly url: string;
  private readonly timeoutMs: number;
  readonly limiter: SttRateLimiter;

  constructor(config: ConfigService) {
    this.url = config.get<string>('stt.url') ?? '';
    this.timeoutMs = config.get<number>('stt.timeoutMs') ?? 45000;
    this.limiter = new SttRateLimiter(
      config.get<number>('stt.ratePerMin') ?? 12,
    );
  }

  /**
   * "Betulkan kalimat" in Ulang: needs the review menu, then the same rate
   * limit and caps as Main peran.
   */
  async transcribeForReview(
    access: AccessContext,
    file: UploadedAudio | undefined,
    language: SttLanguage = 'en',
  ): Promise<SttResult> {
    if (!access.menus.includes(Menu.REVIEW)) {
      throw new ForbiddenException({
        field: '',
        message: 'review_not_allowed',
      });
    }
    if (!file) throw fail(HttpStatus.UNPROCESSABLE_ENTITY, 'stt_no_speech');
    this.assertRate(access.tokenId);
    return this.transcribe(file, language);
  }

  /** 429 when this token recorded too much in the last minute. */
  assertRate(tokenId: string): void {
    if (!this.limiter.take(tokenId)) {
      throw fail(HttpStatus.TOO_MANY_REQUESTS, 'stt_rate_limited');
    }
  }

  async transcribe(
    file: UploadedAudio,
    language: SttLanguage,
  ): Promise<SttResult> {
    if (!this.url) {
      throw new ServiceUnavailableException({
        field: '',
        message: 'stt_unavailable',
      });
    }
    if (!file.size) throw fail(422, 'stt_no_speech');
    if (file.size > STT_MAX_BYTES) throw fail(413, 'stt_too_large');

    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(file.buffer)], {
        type: file.mimetype || 'application/octet-stream',
      }),
      file.originalname || 'answer',
    );
    form.append('language', language);

    let res: Response;
    try {
      res = await fetch(`${this.url}/api/transcribe`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      this.logger.warn(`stt request failed: ${name || String(err)}`);
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new GatewayTimeoutException({
          field: '',
          message: 'stt_timeout',
        });
      }
      throw new ServiceUnavailableException({
        field: '',
        message: 'stt_unavailable',
      });
    }

    const body = (await res.json().catch(() => null)) as {
      text?: unknown;
      language?: unknown;
      duration_sec?: unknown;
      detail?: { code?: string };
    } | null;
    if (!res.ok) {
      const code = STT_CODES[body?.detail?.code ?? ''] ?? 'stt_failed';
      this.logger.warn(`stt answered ${res.status} ${code}`);
      throw fail(
        res.status >= 500 && code === 'stt_failed' ? 502 : res.status,
        code,
      );
    }
    if (!body || typeof body.text !== 'string') {
      throw fail(502, 'stt_failed');
    }
    return {
      text: body.text,
      language,
      durationSec: Number(body.duration_sec) || 0,
    };
  }
}
