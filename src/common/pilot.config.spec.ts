import { dayIn, PILOT } from './pilot.config';

describe('dayIn (learning day in the token time zone)', () => {
  const utcDay = (iso: string) => Math.floor(Date.parse(iso) / 86_400_000);

  it('counts 06:00 WIB as that calendar day, not the UTC day before', () => {
    // 06:00 WIB on 21 Nov 2026 = 23:00 UTC on 20 Nov.
    const ms = Date.parse('2026-11-20T23:00:00Z');
    expect(dayIn(ms, 'Asia/Jakarta')).toBe(utcDay('2026-11-21T00:00:00Z'));
    expect(dayIn(ms, 'UTC')).toBe(utcDay('2026-11-20T00:00:00Z'));
  });

  it('follows other zones too', () => {
    const ms = Date.parse('2026-11-20T16:30:00Z'); // 00:30 WITA on the 21st
    expect(dayIn(ms, 'Asia/Makassar')).toBe(utcDay('2026-11-21T00:00:00Z'));
    expect(dayIn(ms, 'Asia/Jakarta')).toBe(utcDay('2026-11-20T00:00:00Z'));
  });

  it('defaults to Asia/Jakarta', () => {
    expect(PILOT.defaultTimeZone).toBe('Asia/Jakarta');
  });
});
