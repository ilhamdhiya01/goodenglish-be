import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// Same scheme as critiq: "iv:authTag:ciphertext", hex. ENCRYPTION_KEY is
// optional so the app still boots without it; only storing or reading a
// secret then fails (503 encryption_key_missing), with a message that says
// what to set.
@Injectable()
export class EncryptionService {
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const hex = config.get<string>('encryptionKey');
    this.key = hex ? Buffer.from(hex, 'hex') : null;
  }

  get ready(): boolean {
    return this.key !== null;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new ServiceUnavailableException({
        field: '',
        message: 'encryption_key_missing',
      });
    }
    return this.key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.requireKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((buf) => buf.toString('hex'))
      .join(':');
  }

  decrypt(encrypted: string): string {
    const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
    const decipher = createDecipheriv(
      ALGORITHM,
      this.requireKey(),
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }
}
