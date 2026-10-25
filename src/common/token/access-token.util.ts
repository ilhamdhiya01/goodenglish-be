import { createHash, randomBytes } from 'crypto';

const PREFIX = 'ge_';
// Visible part kept in the DB so admins can tell tokens apart.
const VISIBLE_CHARS = 8;

export interface GeneratedToken {
  plain: string;
  hash: string;
  prefix: string;
}

// 32 random bytes = 256 bits, base64url so it survives copy/paste and URLs.
export const generateAccessToken = (): GeneratedToken => {
  const plain = PREFIX + randomBytes(32).toString('base64url');
  return {
    plain,
    hash: hashAccessToken(plain),
    prefix: plain.slice(0, PREFIX.length + VISIBLE_CHARS),
  };
};

// SHA-256 rather than bcrypt/argon2 on purpose: those exist to slow down
// guessing of low-entropy human passwords. A 256-bit random token can't be
// guessed either way, and a plain hash keeps the lookup a single indexed
// equality query.
export const hashAccessToken = (plain: string): string =>
  createHash('sha256').update(plain.trim()).digest('hex');
