import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import type { AccessContext } from '../../common/types/access-context';
import type { AiQuotaService } from './ai-quota.service';
import { CheckSentencesService, parseChecks } from './check-sentences.service';
import type { GeminiJsonService } from './gemini-json.service';

jest.mock('@google/genai', () => ({ ThinkingLevel: { LOW: 'LOW' } }));
jest.mock('./ai.service', () => {
  const { ForbiddenException: Forbidden } =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  return {
    assertAiMenu: (a: { menus: string[] }) => {
      if (!a.menus.includes('AI')) throw new Forbidden();
    },
  };
});
jest.mock('./gemini-json.service', () => ({ GeminiJsonService: class {} }));
jest.mock('./ai-quota.service', () => ({ AiQuotaService: class {} }));

const access = (menus = ['AI']) =>
  ({ tokenId: 't1', menus, aiDailyLimit: 30 }) as unknown as AccessContext;

const answer = (n: number) =>
  JSON.stringify({
    checks: Array.from({ length: n }, (_, i) => ({
      original: `x${i}`,
      is_correct: i !== 1,
      corrected: i === 1 ? 'She goes to work.' : `x${i}`,
      explanation_id: 'Subjek she → goes.',
      category: 'aturan-dasar',
    })),
  });

const setup = (raw: string | Error) => {
  const gemini = {
    client: jest.fn().mockResolvedValue({}),
    generate: jest.fn(() =>
      raw instanceof Error ? Promise.reject(raw) : Promise.resolve(raw),
    ),
    failed: (e: unknown) =>
      e instanceof HttpException ? e : new BadGatewayException(),
  };
  const quota = { consume: jest.fn(), refund: jest.fn() };
  const service = new CheckSentencesService(
    gemini as unknown as GeminiJsonService,
    quota as unknown as AiQuotaService,
  );
  return { service, gemini, quota };
};

describe('CheckSentencesService', () => {
  it('checks up to 3 sentences in one call and one quota unit', async () => {
    const { service, gemini, quota } = setup(answer(3));
    const res = await service.check(access(), {
      sentences: ['I go to work.', 'She go to work.', ' We  like tea. '],
      level: 'pre',
    });
    expect(gemini.generate).toHaveBeenCalledTimes(1);
    expect(quota.consume).toHaveBeenCalledTimes(1);
    expect(res.checks.map((c) => c.isCorrect)).toEqual([true, false, true]);
    // The learner's own text is kept as written (spaces tidied).
    expect(res.checks[2].original).toBe('We like tea.');
  });

  it('gives the quota back when the answer is unusable', async () => {
    const { service, quota } = setup(answer(1));
    await expect(
      service.check(access(), { sentences: ['a b', 'c d'], level: 'pre' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(quota.refund).toHaveBeenCalledWith('t1');
  });

  it('needs the Tanya AI menu', async () => {
    const { service, quota } = setup(answer(1));
    await expect(
      service.check(access([]), { sentences: ['a'], level: 'pre' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('parseChecks rejects broken JSON', () => {
    expect(parseChecks('nope', ['a'])).toBeNull();
    expect(parseChecks('{"checks":[]}', ['a'])).toBeNull();
  });
});
