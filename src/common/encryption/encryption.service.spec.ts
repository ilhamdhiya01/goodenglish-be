import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

const withKey = (hex: string) =>
  new EncryptionService({ get: () => hex } as unknown as ConfigService);

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('EncryptionService', () => {
  it('round-trips, and never stores the plaintext', () => {
    const svc = withKey(KEY_A);
    const enc = svc.encrypt('AIzaSecret123');
    expect(enc).not.toContain('AIzaSecret123');
    expect(enc.split(':')).toHaveLength(3);
    expect(svc.decrypt(enc)).toBe('AIzaSecret123');
    // A fresh IV each time.
    expect(svc.encrypt('AIzaSecret123')).not.toBe(enc);
  });

  it('cannot decrypt with a different ENCRYPTION_KEY', () => {
    const enc = withKey(KEY_A).encrypt('AIzaSecret123');
    expect(() => withKey(KEY_B).decrypt(enc)).toThrow();
  });

  it('refuses with a clear code when ENCRYPTION_KEY is not set', () => {
    const svc = withKey('');
    expect(svc.ready).toBe(false);
    expect(() => svc.encrypt('x')).toThrow(ServiceUnavailableException);
  });
});
