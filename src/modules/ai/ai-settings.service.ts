import {
  BadGatewayException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AiSettings } from '../../generated/prisma/client';
import {
  AiModelsDto,
  AiSettingsDto,
  SaveAiSettingsDto,
} from './dto/ai-settings.dto';
import {
  createGemini,
  DEFAULT_MODEL,
  isInvalidKeyError,
  MODEL_CATALOG,
  newestFirst,
  NON_CHAT_MODEL,
} from './gemini.client';

const ROW_ID = 1;
const MODELS_TTL_MS = 60 * 60 * 1000;

interface Loaded {
  row: AiSettings | null;
  // Decrypted; null when there is no key or it can't be decrypted.
  apiKey: string | null;
}

const catalog = (warning: string | null) =>
  new AiModelsDto({
    source: 'catalog',
    models: MODEL_CATALOG.map((id) => ({ id, label: id })),
    warning,
  });

// The Gemini key and model behind Tanya AI, kept in ai_settings (one row) and
// edited from Admin › Tanya AI. Read on every question, so the row and the
// decrypted key are cached in memory and dropped on every write — this
// backend runs as a single process.
@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);
  private loaded: Loaded | null = null;
  private models: { stamp: number; at: number; result: AiModelsDto } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  private async load(): Promise<Loaded> {
    if (this.loaded) return this.loaded;
    const row = await this.prisma.aiSettings.findUnique({
      where: { id: ROW_ID },
    });
    let apiKey: string | null = null;
    if (row?.encryptedKey && this.encryption.ready) {
      try {
        apiKey = this.encryption.decrypt(row.encryptedKey);
      } catch {
        // ENCRYPTION_KEY changed since the key was saved.
        this.logger.warn('Stored Gemini key could not be decrypted');
      }
    }
    this.loaded = { row, apiKey };
    return this.loaded;
  }

  private invalidate() {
    this.loaded = null;
    this.models = null;
  }

  /** What AiService needs to call Gemini, or null if Tanya AI is off. */
  async active(): Promise<{ apiKey: string; model: string } | null> {
    const { row, apiKey } = await this.load();
    return apiKey ? { apiKey, model: row?.model ?? DEFAULT_MODEL } : null;
  }

  async summary(): Promise<AiSettingsDto> {
    const { row, apiKey } = await this.load();
    return new AiSettingsDto({
      hasKey: !!row?.encryptedKey,
      last4: row?.encryptedKey ? row.keyLast4 : null,
      model: row?.model ?? DEFAULT_MODEL,
      keyReadable: !!apiKey,
      encryptionReady: this.encryption.ready,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt ?? null,
    });
  }

  // A new key is checked with Google before it is stored, so a typo can't
  // silently switch Tanya AI off for everyone.
  async save(dto: SaveAiSettingsDto, by: string): Promise<AiSettingsDto> {
    const apiKey = dto.apiKey?.trim();
    const data: Partial<AiSettings> = {
      model: dto.model.trim(),
      updatedBy: by,
    };
    if (apiKey) {
      await this.verify(apiKey);
      data.encryptedKey = this.encryption.encrypt(apiKey);
      data.keyLast4 = apiKey.slice(-4);
    }
    await this.prisma.aiSettings.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, ...data },
      update: data,
    });
    this.invalidate();
    return this.summary();
  }

  async removeKey(by: string): Promise<AiSettingsDto> {
    const data = { encryptedKey: null, keyLast4: null, updatedBy: by };
    await this.prisma.aiSettings.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, ...data },
      update: data,
    });
    this.invalidate();
    return this.summary();
  }

  // Models for the picker, asked from Google itself (the catalog in code
  // goes stale with every release). With `apiKey` it's a preview for a key
  // typed in the form, not yet saved: a bad key is then a 422 rather than a
  // fallback, so the admin sees it before saving.
  async listModels(apiKey?: string): Promise<AiModelsDto> {
    const preview = apiKey !== undefined;
    const { row, apiKey: stored } = await this.load();
    const key = preview ? apiKey.trim() : stored;
    if (!key)
      return catalog(row?.encryptedKey ? 'ai_key_unreadable' : 'no_key');

    const stamp = row?.updatedAt.getTime() ?? 0;
    if (
      !preview &&
      this.models?.stamp === stamp &&
      Date.now() - this.models.at < MODELS_TTL_MS
    )
      return this.models.result;

    try {
      const ids: string[] = [];
      const labels = new Map<string, string>();
      const pager = await createGemini(key, false).models.list({
        config: { pageSize: 100 },
      });
      for await (const m of pager) {
        const id = (m.name ?? '').replace(/^models\//, '');
        if (
          id.startsWith('gemini-') &&
          !NON_CHAT_MODEL.test(id) &&
          (m.supportedActions ?? []).includes('generateContent')
        ) {
          ids.push(id);
          labels.set(id, m.displayName || id);
        }
      }
      const result = new AiModelsDto({
        source: 'live',
        models: ids
          .sort(newestFirst)
          .map((id) => ({ id, label: labels.get(id)! })),
        warning: null,
      });
      if (!preview) this.models = { stamp, at: Date.now(), result };
      return result;
    } catch (err) {
      if (isInvalidKeyError(err)) {
        if (preview) throw invalidKey();
        return catalog('ai_key_invalid');
      }
      this.logger.warn(
        `Gemini model list failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return catalog('ai_models_unavailable');
    }
  }

  private async verify(apiKey: string): Promise<void> {
    try {
      await createGemini(apiKey, false).models.list({
        config: { pageSize: 1 },
      });
    } catch (err) {
      if (isInvalidKeyError(err)) throw invalidKey();
      this.logger.warn(
        `Gemini key check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadGatewayException({
        field: 'apiKey',
        message: 'ai_key_check_failed',
      });
    }
  }
}

const invalidKey = () =>
  new UnprocessableEntityException({
    field: 'apiKey',
    message: 'ai_key_invalid',
  });
