import { generateAccessToken, hashAccessToken } from './access-token.util';

describe('access-token.util', () => {
  it('generates distinct ge_ tokens with a matching hash and prefix', () => {
    const a = generateAccessToken();
    const b = generateAccessToken();

    expect(a.plain).toMatch(/^ge_[A-Za-z0-9_-]{43}$/);
    expect(a.plain).not.toBe(b.plain);
    expect(a.hash).toBe(hashAccessToken(a.plain));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.prefix).toBe(a.plain.slice(0, 11));
  });

  it('ignores surrounding whitespace from copy/paste', () => {
    const { plain, hash } = generateAccessToken();
    expect(hashAccessToken(`  ${plain}\n`)).toBe(hash);
  });
});
