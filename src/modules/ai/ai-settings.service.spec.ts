import {
  BadGatewayException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { EncryptionService } from '../../common/encryption/encryption.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { AiSettingsService } from './ai-settings.service';
import { MODEL_CATALOG } from './gemini.client';

jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../../common/encryption/encryption.service', () => ({
  EncryptionService: class {},
}));

const list = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { list } })),
}));

const model = (name: string, actions = ['generateContent']) => ({
  name: `models/${name}`,
  displayName: name.toUpperCase(),
  supportedActions: actions,
});
// The SDK's Pager is async-iterable; an array works the same in for-await.
const pager = (...items: unknown[]) => Promise.resolve(items);
const googleError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

// "enc(x)" stands in for the ciphertext so assertions can read it.
const setup = (row: object | null = null, ready = true) => {
  const prisma = {
    aiSettings: {
      findUnique: jest.fn().mockResolvedValue(row),
      upsert: jest.fn(),
    },
  };
  const encryption = {
    ready,
    encrypt: (s: string) => `enc(${s})`,
    decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, '$1'),
  };
  const service = new AiSettingsService(
    prisma as unknown as PrismaService,
    encryption as unknown as EncryptionService,
  );
  return { service, prisma };
};

const saved = {
  id: 1,
  encryptedKey: 'enc(AIzaOLD1234)',
  keyLast4: '1234',
  model: 'gemini-3.5-flash-lite',
  updatedBy: 'Ilham',
  updatedAt: new Date('2026-11-11T03:00:00Z'),
};

describe('AiSettingsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is off until a key is saved', async () => {
    const { service } = setup(null);
    await expect(service.active()).resolves.toBeNull();
    await expect(service.summary()).resolves.toMatchObject({
      hasKey: false,
      last4: null,
      model: 'gemini-3.6-flash',
    });
  });

  it('hands AiService the decrypted key and the chosen model', async () => {
    const { service } = setup(saved);
    await expect(service.active()).resolves.toEqual({
      apiKey: 'AIzaOLD1234',
      model: 'gemini-3.5-flash-lite',
    });
  });

  it('checks a new key with Google, then stores it encrypted', async () => {
    const { service, prisma } = setup(null);
    list.mockReturnValue(pager(model('gemini-3.6-flash')));
    await service.save(
      { apiKey: ' AIzaNEW5678 ', model: 'gemini-3.6-flash' },
      'Ilham',
    );

    const args = prisma.aiSettings.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(args.update).toEqual({
      model: 'gemini-3.6-flash',
      updatedBy: 'Ilham',
      encryptedKey: 'enc(AIzaNEW5678)',
      keyLast4: '5678',
    });
    expect(JSON.stringify(args)).not.toContain('"AIzaNEW5678"');
  });

  it('keeps the stored key when only the model changes', async () => {
    const { service, prisma } = setup(saved);
    await service.save({ model: 'gemini-3.8-flash' }, 'Ilham');
    expect(list).not.toHaveBeenCalled();
    const args = prisma.aiSettings.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(args.update).not.toHaveProperty('encryptedKey');
  });

  it('refuses a key Google rejects, and says so when Google is down', async () => {
    const bad = setup(null);
    list.mockRejectedValueOnce(googleError(400, 'API key not valid.'));
    await expect(
      bad.service.save({ apiKey: 'AIzaBAD', model: 'm' }, 'Ilham'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(bad.prisma.aiSettings.upsert).not.toHaveBeenCalled();

    const down = setup(null);
    list.mockRejectedValueOnce(googleError(503, 'high demand'));
    await expect(
      down.service.save({ apiKey: 'AIzaOK', model: 'm' }, 'Ilham'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('lists chat models newest first, without embedding/image ones', async () => {
    const { service } = setup(saved);
    list.mockReturnValue(
      pager(
        model('gemini-2.5-flash'),
        model('gemini-3.8-flash'),
        model('gemini-embedding-001', ['embedContent']),
        model('gemini-nano-banana-2.1'),
        model('gemini-3.5-flash-lite'),
      ),
    );
    const res = await service.listModels();
    expect(res.source).toBe('live');
    expect(res.models.map((m) => m.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash',
    ]);
    // Cached until the settings change.
    await service.listModels();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('falls back to the built-in list without a key or when Google fails', async () => {
    const none = await setup(null).service.listModels();
    expect(none).toMatchObject({ source: 'catalog', warning: 'no_key' });
    expect(none.models.map((m) => m.id)).toEqual(MODEL_CATALOG);

    list.mockRejectedValueOnce(googleError(500, 'boom'));
    const failed = await setup(saved).service.listModels();
    expect(failed).toMatchObject({
      source: 'catalog',
      warning: 'ai_models_unavailable',
    });
  });

  it('previews models for a typed key, refusing a bad one outright', async () => {
    const { service } = setup(null);
    list.mockRejectedValueOnce(googleError(400, 'API_KEY_INVALID'));
    await expect(service.listModels('AIzaBAD')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('reports a stored key it can no longer decrypt', async () => {
    const { service } = setup(saved, false);
    await expect(service.active()).resolves.toBeNull();
    await expect(service.summary()).resolves.toMatchObject({
      hasKey: true,
      keyReadable: false,
      encryptionReady: false,
    });
  });
});
