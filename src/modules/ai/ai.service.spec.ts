import {
  BadGatewayException,
  ForbiddenException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import type { AccessContext } from '../../common/types/access-context';
import type { AiQuotaService } from './ai-quota.service';
import type { AiSettingsService } from './ai-settings.service';
import { AiService, parseCheck } from './ai.service';

// Same approach as the other specs: DB-bound and network modules are mocked
// and the service is built with hand-made fakes.
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('./ai-settings.service', () => ({ AiSettingsService: class {} }));

const generateContent = jest.fn();
const generateContentStream = jest.fn();
jest.mock('@google/genai', () => ({
  ThinkingLevel: { LOW: 'LOW', MINIMAL: 'MINIMAL' },
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent, generateContentStream },
  })),
}));

const access = (menus: string[] = ['AI']) =>
  ({ tokenId: 't1', menus, aiDailyLimit: 30 }) as unknown as AccessContext;

// `apiKey: ''` = no key saved in Admin › Tanya AI.
const setup = (apiKey = 'key') => {
  const quota = { consume: jest.fn(), refund: jest.fn() };
  const settings = {
    active: jest.fn().mockResolvedValue(apiKey ? { apiKey, model: 'm' } : null),
  };
  const service = new AiService(
    settings as unknown as AiSettingsService,
    quota as unknown as AiQuotaService,
  );
  return { service, quota, settings };
};

// A plain generator is enough: `for await` also walks sync iterables.
function* chunks(...texts: string[]) {
  for (const text of texts) yield { text };
}

// What the service sent to Gemini.
interface SentRequest {
  contents: unknown;
  config: { systemInstruction: string; responseMimeType?: string };
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

    const stream = await service.startChat(access(), ask());
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
    const { service, quota } = setup();
    generateContentStream.mockRejectedValue(new Error('bad key'));
    await expect(service.startChat(access(), ask())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(quota.refund).toHaveBeenCalledWith('t1');
  });

  it('returns a structured sentence check', async () => {
    const { service } = setup();
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'incorrect',
        corrected: 'I have a car.',
        explanation: 'Subjek I memakai have.',
        alternatives: ['I own a car.'],
      }),
    });
    const res = await service.check(access(), { sentence: 'I has a car.' });
    expect(res).toMatchObject({
      verdict: 'incorrect',
      corrected: 'I have a car.',
      alternatives: ['I own a car.'],
    });
    expect(sent(generateContent).config.responseMimeType).toBe(
      'application/json',
    );
  });
});

describe('parseCheck', () => {
  it('keeps real typos, drops junk ones, and never calls a typo "correct"', () => {
    const res = parseCheck(
      JSON.stringify({
        verdict: 'correct',
        corrected: 'I sometimes go to school.',
        explanation: 'Ada salah ketik.',
        alternatives: [],
        typos: [
          { wrong: ' somtimes ', correct: 'sometimes' },
          { wrong: 'go', correct: 'Go' },
          { wrong: '', correct: 'x' },
          { wrong: 'skool' },
        ],
      }),
      'I somtimes go to skool.',
    );
    expect(res.typos).toEqual([{ wrong: 'somtimes', correct: 'sometimes' }]);
    expect(res.verdict).toBe('almost');
  });

  it('treats a missing typos field as none', () => {
    const res = parseCheck(
      JSON.stringify({
        verdict: 'correct',
        corrected: 'I like tea.',
        explanation: 'Sudah benar.',
        alternatives: [],
      }),
      'I like tea.',
    );
    expect(res.typos).toEqual([]);
    expect(res.verdict).toBe('correct');
  });

  it('falls back to the original sentence and drops junk alternatives', () => {
    const res = parseCheck(
      JSON.stringify({
        verdict: 'correct',
        corrected: ' ',
        explanation: 'Sudah benar.',
        alternatives: ['', 3, 'A', 'B', 'C'],
      }),
      'I like tea.',
    );
    expect(res.corrected).toBe('I like tea.');
    expect(res.alternatives).toEqual(['A', 'B']);
  });

  it('throws on a reply that is not a check result', () => {
    expect(() => parseCheck('{"verdict":"maybe"}', 'x')).toThrow();
    expect(() => parseCheck(undefined, 'x')).toThrow();
  });
});
