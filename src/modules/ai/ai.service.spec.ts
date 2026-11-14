import {
  BadGatewayException,
  ForbiddenException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import type { AccessContext } from '../../common/types/access-context';
import type { AiConversationsService } from './ai-conversations.service';
import type { AiQuotaService } from './ai-quota.service';
import type { AiSettingsService } from './ai-settings.service';
import { chatInstruction } from './ai.prompts';
import { AiService } from './ai.service';

// Same approach as the other specs: DB-bound and network modules are mocked
// and the service is built with hand-made fakes.
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('./ai-settings.service', () => ({ AiSettingsService: class {} }));

const generateContentStream = jest.fn();
jest.mock('@google/genai', () => ({
  ThinkingLevel: { LOW: 'LOW', MINIMAL: 'MINIMAL' },
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContentStream },
  })),
}));

const access = (menus: string[] = ['AI']) =>
  ({ tokenId: 't1', menus, aiDailyLimit: 30 }) as unknown as AccessContext;

// `apiKey: ''` = no key saved in Admin › Tanya AI.
const setup = (apiKey = 'key') => {
  const quota = { consume: jest.fn(), refund: jest.fn() };
  const conversations = {
    assertOwned: jest.fn(),
    saveQuestion: jest.fn().mockResolvedValue('c1'),
  };
  const settings = {
    active: jest.fn().mockResolvedValue(apiKey ? { apiKey, model: 'm' } : null),
  };
  const service = new AiService(
    settings as unknown as AiSettingsService,
    quota as unknown as AiQuotaService,
    conversations as unknown as AiConversationsService,
  );
  return { service, quota, settings, conversations };
};

// A plain generator is enough: `for await` also walks sync iterables.
function* chunks(...texts: string[]) {
  for (const text of texts) yield { text };
}

// What the service sent to Gemini.
interface SentRequest {
  contents: unknown;
  config: { systemInstruction: string };
}
const sent = (fn: jest.Mock) => fn.mock.calls[0][0] as SentRequest;

const ask = (text = 'Is "I has a car" correct?') => ({
  messages: [{ role: 'user' as const, text }],
  context: { level: 'pre' as const, word: 'have' },
});

describe('AiService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects tokens without the AI menu before touching quota', async () => {
    const { service, quota } = setup();
    await expect(
      service.startChat(access(['VOCAB']), ask()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('uses the saved key and model, with retries, reusing one client', async () => {
    const { service } = setup();
    generateContentStream.mockResolvedValue(chunks('ok'));
    await service.startChat(access(), ask());
    await service.startChat(access(), ask());

    const ctor = GoogleGenAI as unknown as jest.Mock;
    expect(ctor).toHaveBeenCalledTimes(1);
    const opts = ctor.mock.calls[0][0] as {
      apiKey: string;
      httpOptions: { retryOptions: { attempts: number } };
    };
    expect(opts.apiKey).toBe('key');
    expect(opts.httpOptions.retryOptions.attempts).toBeGreaterThan(1);
    expect(
      (generateContentStream.mock.calls[0][0] as { model: string }).model,
    ).toBe('m');
  });

  it('answers 503 when no API key is saved', async () => {
    const { service } = setup('');
    await expect(service.startChat(access(), ask())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('requires the last message to be the new question', async () => {
    const { service } = setup();
    const dto = { messages: [{ role: 'model' as const, text: 'Hi' }] };
    await expect(service.startChat(access(), dto)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('streams the answer with the app context in the system prompt', async () => {
    const { service, quota } = setup();
    generateContentStream.mockResolvedValue(chunks('Belum ', 'tepat.'));

    const { stream } = await service.startChat(access(), ask());
    const out: string[] = [];
    for await (const t of stream) out.push(t);

    expect(out.join('')).toBe('Belum tepat.');
    expect(quota.consume).toHaveBeenCalledWith('t1', 30);
    const req = sent(generateContentStream);
    expect(req.contents).toEqual([
      { role: 'user', parts: [{ text: 'Is "I has a car" correct?' }] },
    ]);
    expect(req.config.systemInstruction).toContain('Pre-intermediate');
    expect(req.config.systemInstruction).toContain('"have"');
  });

  it('gives the question back when Gemini refuses the request', async () => {
    const { service, quota, conversations } = setup();
    generateContentStream.mockRejectedValue(new Error('bad key'));
    await expect(service.startChat(access(), ask())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(quota.refund).toHaveBeenCalledWith('t1');
    expect(conversations.saveQuestion).not.toHaveBeenCalled();
  });

  it('stores the accepted question with its word card in a new thread', async () => {
    const { service, conversations } = setup();
    generateContentStream.mockResolvedValue(chunks('ok'));
    const { conversationId } = await service.startChat(access(), ask());

    expect(conversationId).toBe('c1');
    expect(conversations.assertOwned).not.toHaveBeenCalled();
    expect(conversations.saveQuestion).toHaveBeenCalledWith(
      't1',
      undefined,
      'Is "I has a car" correct?',
      { word: 'have', meaning: undefined },
    );
  });

  it('checks a given thread belongs to the token before taking quota', async () => {
    const { service, quota, conversations } = setup();
    conversations.assertOwned.mockRejectedValue(new Error('not found'));
    await expect(
      service.startChat(access(), { ...ask(), conversationId: 'other' }),
    ).rejects.toThrow('not found');
    expect(conversations.assertOwned).toHaveBeenCalledWith('t1', 'other');
    expect(quota.consume).not.toHaveBeenCalled();
  });
});

describe('chatInstruction', () => {
  // The rules that replaced the one-shot sentence check: keep the learner's
  // tense, accept contractions, and read clarifications as context.
  it('tells the model how to correct a sentence inside the chat', () => {
    const prompt = chatInstruction();
    expect(prompt).toContain('Koreksi kalimat');
    expect(prompt).toContain('Pertahankan tense');
    expect(prompt).toContain("I'm");
    expect(prompt).toContain('riwayat percakapan');
  });
});
