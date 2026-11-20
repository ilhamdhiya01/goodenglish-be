import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AccessContext } from '../../common/types/access-context';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AiSettingsService } from '../ai/ai-settings.service';
import type { SttService, UploadedAudio } from '../stt/stt.service';
import type { RoleplayContextDto } from './dto/roleplay.dto';
import { OPENING_CUE } from './roleplay.prompts';
import { QUOTA_TURNS, RoleplayService, toContents } from './roleplay.service';

// Same approach as the AI specs: DB-bound and network modules are mocked and
// the service is built with hand-made fakes.
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../../common/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../ai/ai-settings.service', () => ({ AiSettingsService: class {} }));
jest.mock('../stt/stt.service', () => ({ SttService: class {} }));

const generateContent = jest.fn();
jest.mock('@google/genai', () => ({
  ThinkingLevel: { LOW: 'LOW', MINIMAL: 'MINIMAL' },
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent },
  })),
}));

const ctx: RoleplayContextDto = {
  level: 'beginner',
  title: 'Memesan di kafe',
  roleAi: 'cafe cashier',
  roleUser: 'customer',
  mission: 'Order 2 drinks and ask for the total',
  steps: ['Greet', 'Order 2 drinks', 'Ask the total'],
  phrases: ['Can I have …, please?'],
};

const access = (
  menus: string[] = ['SCENARIO', 'ROLEPLAY'],
  roleplayDailyLimit: number | null = 3,
) => ({ tokenId: 't1', menus, roleplayDailyLimit }) as unknown as AccessContext;

const row = (o: object = {}) => ({
  id: 's1',
  accessTokenId: 't1',
  context: ctx,
  stepsDone: [] as number[],
  userTurns: 0,
  maxTurns: 12,
  helpCount: 0,
  transcribeCount: 0,
  startedAt: new Date(Date.now() - 5 * 60_000),
  endedAt: null as Date | null,
  ...o,
});

const reply = (o: object) => ({ text: JSON.stringify(o) });

const setup = (
  opts: { apiKey?: string; today?: number; session?: object } = {},
) => {
  const prisma = {
    roleplaySession: {
      create: jest.fn().mockResolvedValue({ id: 's1' }),
      count: jest.fn().mockResolvedValue(opts.today ?? 1),
      delete: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(row(opts.session)),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const apiKey = opts.apiKey ?? 'key';
  const settings = {
    active: jest.fn().mockResolvedValue(apiKey ? { apiKey, model: 'm' } : null),
  };
  const stt = {
    assertRate: jest.fn(),
    transcribe: jest.fn().mockResolvedValue({
      text: 'I go to event yesterday',
      language: 'en',
      durationSec: 2.4,
    }),
  };
  const service = new RoleplayService(
    prisma as unknown as PrismaService,
    settings as unknown as AiSettingsService,
    stt as unknown as SttService,
  );
  return { service, prisma, stt };
};

const lines = (...l: ['ai' | 'user', string][]) =>
  l.map(([role, text]) => ({ role, text }));

describe('RoleplayService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('permissions', () => {
    it.each([[['SCENARIO']], [['ROLEPLAY']], [['AI', 'VOCAB']]])(
      'rejects menus %j',
      async (menus) => {
        const { service, prisma } = setup();
        await expect(
          service.start(access(menus), { scenarioId: 'order', context: ctx }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.usage(access(menus))).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('start', () => {
    it('opens with the AI line and reports what is left today', async () => {
      const { service, prisma } = setup({ today: 1 });
      generateContent.mockResolvedValue(
        reply({
          reply: 'Hi! What can I get you?',
          steps_done: [],
          mission_complete: false,
        }),
      );
      const r = await service.start(access(), {
        scenarioId: 'order',
        context: ctx,
      });
      expect(r).toEqual({
        id: 's1',
        reply: 'Hi! What can I get you?',
        remaining: 2,
        mode: 'penuh',
        maxTurns: 12,
      });
      const req = generateContent.mock.calls[0][0] as {
        contents: unknown;
        config: { responseMimeType: string; systemInstruction: string };
      };
      expect(req.contents).toEqual([
        { role: 'user', parts: [{ text: OPENING_CUE }] },
      ]);
      expect(req.config.responseMimeType).toBe('application/json');
      expect(req.config.systemInstruction).toContain('cafe cashier');
      expect(req.config.systemInstruction).toContain('Never correct');
      expect(prisma.roleplaySession.create.mock.calls[0][0].data).toMatchObject(
        {
          accessTokenId: 't1',
          scenarioId: 'order',
        },
      );
    });

    it('refuses once the day is used up, before opening a session', async () => {
      const { service, prisma } = setup({ today: 3 });
      const err = await service
        .start(access(undefined, 3), { scenarioId: 'order', context: ctx })
        .catch((e: HttpException) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('only sessions that reached 3 turns use the quota', async () => {
      const { service, prisma } = setup({ today: 0 });
      generateContent.mockResolvedValue(
        reply({ reply: 'Hello', steps_done: [], mission_complete: false }),
      );
      await service.start(access(undefined, 3), {
        scenarioId: 'order',
        context: ctx,
      });
      expect(prisma.roleplaySession.count.mock.calls[0][0].where).toMatchObject(
        { userTurns: { gte: QUOTA_TURNS } },
      );
    });

    it('caps starts that never got going at 3x the quota', async () => {
      const { service, prisma } = setup();
      // 0 sessions used the quota, but 9 were started today.
      prisma.roleplaySession.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(9);
      const err = await service
        .start(access(undefined, 3), { scenarioId: 'order', context: ctx })
        .catch((e: HttpException) => e);
      expect((err as HttpException).getStatus()).toBe(429);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
    });

    it('never refuses an unlimited token', async () => {
      const { service } = setup({ today: 99 });
      generateContent.mockResolvedValue(
        reply({ reply: 'Hello', steps_done: [], mission_complete: false }),
      );
      const r = await service.start(access(undefined, null), {
        scenarioId: 'order',
        context: ctx,
      });
      expect(r.remaining).toBeNull();
    });

    it('gives the session back when Gemini fails', async () => {
      const { service, prisma } = setup();
      generateContent.mockRejectedValue(new Error('503 high demand'));
      await expect(
        service.start(access(), { scenarioId: 'order', context: ctx }),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(prisma.roleplaySession.delete).toHaveBeenCalled();
    });

    it('is 503 without a saved key, before using quota', async () => {
      const { service, prisma } = setup({ apiKey: '' });
      await expect(
        service.start(access(), { scenarioId: 'order', context: ctx }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.roleplaySession.create).not.toHaveBeenCalled();
    });
  });

  describe('short practice', () => {
    it('starts with 6 turns when asked', async () => {
      const { service, prisma } = setup({ today: 0 });
      generateContent.mockResolvedValue(
        reply({ reply: 'Hi', steps_done: [], mission_complete: false }),
      );
      const r = await service.start(access(), {
        scenarioId: 'order',
        context: ctx,
        mode: 'pendek',
      });
      expect(r).toMatchObject({ mode: 'pendek', maxTurns: 6 });
      expect(prisma.roleplaySession.create.mock.calls[0][0].data.maxTurns).toBe(
        6,
      );
    });

    it('refuses a 7th turn in a short session, counts what is left', async () => {
      const seven = lines(
        ...Array.from(
          { length: 7 },
          (_, i) =>
            [
              ['ai', `q${i}`],
              ['user', `a${i}`],
            ] as ['ai' | 'user', string][],
        ).flat(),
      );
      const { service } = setup({ session: { maxTurns: 6, userTurns: 6 } });
      await expect(
        service.turn(access(), 's1', { transcript: seven }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      const two = lines(
        ['ai', 'Hi'],
        ['user', 'a'],
        ['ai', 'b'],
        ['user', 'c'],
      );
      const short = setup({ session: { maxTurns: 6, userTurns: 1 } });
      generateContent.mockResolvedValue(
        reply({ reply: 'Ok', steps_done: [], mission_complete: false }),
      );
      await expect(
        short.service.turn(access(), 's1', { transcript: two }),
      ).resolves.toMatchObject({ userTurns: 2, turnsLeft: 4 });
    });
  });

  describe('quota at the 3rd turn', () => {
    const three = lines(
      ['ai', 'Hi!'],
      ['user', 'one'],
      ['ai', 'Ok'],
      ['user', 'two'],
      ['ai', 'And?'],
      ['user', 'three'],
    );

    it('refuses the 3rd turn when the day is already used up', async () => {
      const { service, prisma } = setup({
        today: 3,
        session: { userTurns: 2 },
      });
      const err = await service
        .turn(access(undefined, 3), 's1', { transcript: three })
        .catch((e: HttpException) => e);
      expect((err as HttpException).getStatus()).toBe(429);
      // This session itself isn't counted twice.
      expect(prisma.roleplaySession.count.mock.calls[0][0].where).toMatchObject(
        { id: { not: 's1' } },
      );
    });

    it('a session that already took its quota goes on', async () => {
      const { service } = setup({ today: 3, session: { userTurns: 3 } });
      generateContent.mockResolvedValue(
        reply({ reply: 'Great', steps_done: [], mission_complete: false }),
      );
      const four = [...three, ...lines(['ai', 'Hm'], ['user', 'four'])];
      await expect(
        service.turn(access(undefined, 3), 's1', { transcript: four }),
      ).resolves.toMatchObject({ userTurns: 4 });
    });
  });

  describe('turn', () => {
    const t = lines(
      ['ai', 'Hi! What can I get you?'],
      ['user', 'two latte please'],
    );

    it('saves the ticked steps and the turn count', async () => {
      const { service, prisma } = setup({ session: { stepsDone: [0] } });
      generateContent.mockResolvedValue(
        reply({
          reply: 'Sure. Anything else?',
          steps_done: [1],
          mission_complete: false,
        }),
      );
      const r = await service.turn(access(), 's1', { transcript: t });
      expect(r).toEqual({
        reply: 'Sure. Anything else?',
        stepsDone: [0, 1],
        missionComplete: false,
        userTurns: 1,
        turnsLeft: 11,
      });
      expect(prisma.roleplaySession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { stepsDone: [0, 1], userTurns: 1 },
      });
    });

    it('leaves the session untouched when Gemini fails, so it can be retried', async () => {
      const { service, prisma } = setup();
      generateContent.mockResolvedValue({ text: '{"reply": "Su' });
      await expect(
        service.turn(access(), 's1', { transcript: t }),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(prisma.roleplaySession.update).not.toHaveBeenCalled();
    });

    it('refuses a 13th learner turn', async () => {
      const { service } = setup();
      const long = Array.from({ length: 13 }, () => [
        { role: 'ai' as const, text: 'Q' },
        { role: 'user' as const, text: 'A' },
      ]).flat();
      await expect(
        service.turn(access(), 's1', { transcript: long }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(generateContent).not.toHaveBeenCalled();
    });

    it("refuses another token's session, an ended one and an old one", async () => {
      await expect(
        setup({ session: { accessTokenId: 'other' } }).service.turn(
          access(),
          's1',
          {
            transcript: t,
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        setup({ session: { endedAt: new Date() } }).service.turn(
          access(),
          's1',
          {
            transcript: t,
          },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        setup({
          session: { startedAt: new Date(Date.now() - 2 * 3600_000) },
        }).service.turn(access(), 's1', { transcript: t }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('needs the learner to have the last word', async () => {
      const { service } = setup();
      await expect(
        service.turn(access(), 's1', { transcript: lines(['ai', 'Hi']) }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('help', () => {
    it('counts toward the per-session cap', async () => {
      const { service, prisma } = setup({ session: { helpCount: 2 } });
      generateContent.mockResolvedValue(
        reply({
          suggestions: [
            { en: 'A latte, please.', id: 'Latte, ya.' },
            { en: 'How much is it?', id: 'Berapa?' },
          ],
        }),
      );
      const r = await service.help(access(), 's1', {
        transcript: lines(['ai', 'What can I get you?']),
      });
      expect(r.helpLeft).toBe(3);
      expect(prisma.roleplaySession.update.mock.calls[0][0].data).toEqual({
        helpCount: { increment: 1 },
      });
    });

    it('stops at the cap', async () => {
      const { service } = setup({ session: { helpCount: 6 } });
      await expect(
        service.help(access(), 's1', { transcript: lines(['ai', 'Hi']) }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('transcribe', () => {
    const file: UploadedAudio = {
      buffer: Buffer.from('audio'),
      size: 5,
      mimetype: 'audio/webm',
      originalname: 'answer.webm',
    };

    it('passes the recording and language on and counts it', async () => {
      const { service, prisma, stt } = setup({
        session: { transcribeCount: 3 },
      });
      const r = await service.transcribe(access(), 's1', file, {
        language: 'id',
      });
      expect(stt.assertRate).toHaveBeenCalledWith('t1');
      expect(stt.transcribe).toHaveBeenCalledWith(file, 'id');
      expect(r).toEqual({
        text: 'I go to event yesterday',
        language: 'en',
        durationSec: 2.4,
        transcribeLeft: 26,
      });
      expect(prisma.roleplaySession.update.mock.calls[0][0].data).toEqual({
        transcribeCount: { increment: 1 },
      });
      // Gemini is never involved.
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('defaults to English', async () => {
      const { service, stt } = setup();
      await service.transcribe(access(), 's1', file, {});
      expect(stt.transcribe).toHaveBeenCalledWith(file, 'en');
    });

    it('needs a file, an open session and room under the cap', async () => {
      await expect(
        setup().service.transcribe(access(), 's1', undefined, {}),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      const capped = setup({ session: { transcribeCount: 30 } });
      await expect(
        capped.service.transcribe(access(), 's1', file, {}),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(capped.stt.transcribe).not.toHaveBeenCalled();
      await expect(
        setup({ session: { endedAt: new Date() } }).service.transcribe(
          access(),
          's1',
          file,
          {},
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('counts nothing when the stt service fails', async () => {
      const { service, prisma, stt } = setup();
      stt.transcribe.mockRejectedValue(
        new HttpException({ message: 'stt_no_speech' }, 422),
      );
      await expect(
        service.transcribe(access(), 's1', file, {}),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.roleplaySession.update).not.toHaveBeenCalled();
    });
  });

  describe('finish', () => {
    const summary = {
      mission_complete: false,
      summary_id: 'Bagus!',
      corrections: [],
      more_natural: [],
      key_phrases_used: [],
    };
    const t = lines(
      ['ai', 'Hi'],
      ['user', 'hello'],
      ['ai', 'What can I get you?'],
    );

    it('caps the duration by the server clock and records the result', async () => {
      const { service, prisma } = setup({ session: { stepsDone: [0] } });
      generateContent.mockResolvedValue(reply(summary));
      const r = await service.finish(access(), 's1', {
        transcript: t,
        durationSec: 9999,
      });
      expect(r.durationSec).toBeGreaterThanOrEqual(299);
      expect(r.durationSec).toBeLessThanOrEqual(301);
      expect(r).toMatchObject({
        missionComplete: false,
        userTurns: 1,
        stepsDone: [0],
      });
      expect(prisma.roleplaySession.update.mock.calls[0][0].data).toMatchObject(
        {
          missionComplete: false,
          userTurns: 1,
          durationSec: r.durationSec,
        },
      );
      expect(generateContent.mock.calls[0][0].contents[0].parts[0].text).toBe(
        'PARTNER: Hi\nLEARNER: hello\nPARTNER: What can I get you?',
      );
    });

    it('trusts the ticked steps over the model for the mission', async () => {
      const { service } = setup({ session: { stepsDone: [0, 1, 2] } });
      generateContent.mockResolvedValue(reply(summary));
      const r = await service.finish(access(), 's1', {
        transcript: t,
        durationSec: 60,
      });
      expect(r.missionComplete).toBe(true);
    });

    it('can be fetched again after it ended, keeping the first end time', async () => {
      const startedAt = new Date(Date.now() - 20 * 60_000);
      const endedAt = new Date(startedAt.getTime() + 4 * 60_000);
      const { service } = setup({ session: { startedAt, endedAt } });
      generateContent.mockResolvedValue(reply(summary));
      const r = await service.finish(access(), 's1', {
        transcript: t,
        durationSec: 600,
      });
      expect(r.durationSec).toBe(240);
    });

    it('needs at least one learner turn', async () => {
      const { service } = setup();
      await expect(
        service.finish(access(), 's1', {
          transcript: lines(['ai', 'Hi']),
          durationSec: 5,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('is 502 and saves nothing when the summary is malformed', async () => {
      const { service, prisma } = setup();
      generateContent.mockResolvedValue(reply({ summary_id: '' }));
      await expect(
        service.finish(access(), 's1', { transcript: t, durationSec: 60 }),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(prisma.roleplaySession.update).not.toHaveBeenCalled();
    });
  });
});

describe('toContents', () => {
  it('starts with the opening cue and merges back-to-back lines', () => {
    expect(
      toContents(
        lines(['ai', 'Hi'], ['user', 'one'], ['user', 'two'], ['ai', 'Ok']),
      ),
    ).toEqual([
      { role: 'user', parts: [{ text: OPENING_CUE }] },
      { role: 'model', parts: [{ text: 'Hi' }] },
      { role: 'user', parts: [{ text: 'one' }, { text: 'two' }] },
      { role: 'model', parts: [{ text: 'Ok' }] },
    ]);
  });
});
