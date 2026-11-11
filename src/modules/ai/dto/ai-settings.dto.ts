import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SaveAiSettingsDto {
  // Omitted or empty = keep the stored key; only the model changes.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  apiKey?: string;

  // Any Gemini model id, not only the listed ones (the list can lag a
  // release).
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9.-]*$/i, { message: 'model_invalid' })
  model!: string;
}

export class PreviewModelsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  apiKey!: string;
}

// GET /admin/ai-settings. Never carries the key itself.
export class AiSettingsDto {
  hasKey!: boolean;
  // Last 4 characters of the stored key, to tell keys apart.
  last4!: string | null;
  model!: string;
  // False when a key is stored but ENCRYPTION_KEY is missing or changed, so
  // it can't be read: Tanya AI is down until the key is entered again.
  keyReadable!: boolean;
  // ENCRYPTION_KEY is set, so a key can be saved at all.
  encryptionReady!: boolean;
  updatedBy!: string | null;
  updatedAt!: Date | null;

  constructor(partial: Partial<AiSettingsDto>) {
    Object.assign(this, partial);
  }
}

export class AiModelOptionDto {
  id!: string;
  label!: string;
}

export class AiModelsDto {
  // "live": asked from Google with the key. "catalog": the built-in
  // suggestions, because there's no key or the listing failed (see warning).
  source!: 'live' | 'catalog';
  models!: AiModelOptionDto[];
  warning!: string | null;

  constructor(partial: Partial<AiModelsDto>) {
    Object.assign(this, partial);
  }
}
