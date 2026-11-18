import { HttpException } from '@nestjs/common';
import type { AccessContext } from '../../common/types/access-context';
import { SttRateLimiter, SttService, type UploadedAudio } from './stt.service';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

const file = (size = 1000): UploadedAudio => ({
  buffer: Buffer.alloc(size, 1),
  size,
  mimetype: 'audio/webm;codecs=opus',
  originalname: 'answer.webm',
});

const service = (url = 'http://stt:8000') =>
  new SttService({
    get: (k: string) =>
      ({ 'stt.url': url, 'stt.timeoutMs': 1000, 'stt.ratePerMin': 2 })[k],
  } as never);

const reply = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

const code = async (p: Promise<unknown>) => {
  const e = (await p.catch((x: unknown) => x)) as HttpException;
  return [e.getStatus(), (e.getResponse() as { message: string }).message];
};

describe('SttService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts the audio and language as multipart and returns the text', async () => {
    fetchMock.mockReturnValue(
      reply(200, {
        text: 'I go to event yesterday',
        language: 'en',
        duration_sec: 2.4,
      }),
    );
    const r = await service().transcribe(file(), 'en');
    expect(r).toEqual({
      text: 'I go to event yesterday',
      language: 'en',
      durationSec: 2.4,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://stt:8000/api/transcribe');
    const form = init.body as FormData;
    expect(form.get('language')).toBe('en');
    const audio = form.get('audio') as File;
    expect(audio.size).toBe(1000);
    expect(audio.type).toBe('audio/webm;codecs=opus');
  });

  it.each([
    [422, 'no_speech', 422, 'stt_no_speech'],
    [422, 'too_long', 422, 'stt_too_long'],
    [413, 'too_large', 413, 'stt_too_large'],
    [415, 'bad_audio', 415, 'stt_bad_audio'],
    [503, 'busy', 503, 'stt_busy'],
    [500, undefined, 502, 'stt_failed'],
  ])(
    'maps stt %s %s to %s %s',
    async (status, sttCode, wantStatus, wantCode) => {
      fetchMock.mockReturnValue(
        reply(status, { detail: sttCode ? { code: sttCode } : 'boom' }),
      );
      expect(await code(service().transcribe(file(), 'en'))).toEqual([
        wantStatus,
        wantCode,
      ]);
    },
  );

  it('is 503 when unreachable or not configured, 504 on timeout', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await code(service().transcribe(file(), 'en'))).toEqual([
      503,
      'stt_unavailable',
    ]);
    fetchMock.mockRejectedValue(
      Object.assign(new Error('t'), { name: 'TimeoutError' }),
    );
    expect(await code(service().transcribe(file(), 'en'))).toEqual([
      504,
      'stt_timeout',
    ]);
    expect(await code(service('').transcribe(file(), 'en'))).toEqual([
      503,
      'stt_unavailable',
    ]);
  });

  it('refuses empty and oversized files without calling the service', async () => {
    expect(await code(service().transcribe(file(0), 'en'))).toEqual([
      422,
      'stt_no_speech',
    ]);
    expect(await code(service().transcribe(file(5_000_001), 'en'))).toEqual([
      413,
      'stt_too_large',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate-limits per token', () => {
    const s = service();
    s.assertRate('a');
    s.assertRate('a');
    expect(() => s.assertRate('a')).toThrow(HttpException);
    expect(() => s.assertRate('b')).not.toThrow();
  });
});

describe('transcribeForReview', () => {
  const access = (menus = ['REVIEW']) =>
    ({ tokenId: 't1', menus }) as unknown as AccessContext;

  it('needs the review menu and audio, then rate limits per token', async () => {
    const s = service();
    const spy = jest
      .spyOn(s, 'transcribe')
      .mockResolvedValue({ text: 'She goes.', language: 'en', durationSec: 2 });
    expect(
      await code(s.transcribeForReview(access(['VOCAB']), file())),
    ).toEqual([403, 'review_not_allowed']);
    expect(await code(s.transcribeForReview(access(), undefined))).toEqual([
      422,
      'stt_no_speech',
    ]);
    await expect(
      s.transcribeForReview(access(), file(), 'id'),
    ).resolves.toMatchObject({ text: 'She goes.' });
    expect(spy).toHaveBeenLastCalledWith(expect.anything(), 'id');
    await s.transcribeForReview(access(), file());
    expect(await code(s.transcribeForReview(access(), file()))).toEqual([
      429,
      'stt_rate_limited',
    ]);
  });
});

describe('SttRateLimiter', () => {
  it('frees a slot once the window has passed', () => {
    const l = new SttRateLimiter(1, 60_000);
    expect(l.take('t', 0)).toBe(true);
    expect(l.take('t', 59_999)).toBe(false);
    expect(l.take('t', 60_000)).toBe(true);
  });
});
