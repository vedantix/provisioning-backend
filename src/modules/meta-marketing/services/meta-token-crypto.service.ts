import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { AppError } from '../../../errors/app-error';

export class MetaTokenCryptoService {
  encrypt(value: string): string {
    const key = this.key();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(value: string): string {
    const [version, ivRaw, tagRaw, ciphertextRaw] = value.split('.');
    if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) {
      throw new AppError('Invalid encrypted Meta token payload', 500, 'META_TOKEN_INVALID');
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(ivRaw, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private key(): Buffer {
    if (!env.metaTokenEncryptionSecret) {
      throw new AppError(
        'META_TOKEN_ENCRYPTION_SECRET is required for Meta token storage',
        500,
        'META_TOKEN_ENCRYPTION_CONFIG',
      );
    }

    return crypto
      .createHash('sha256')
      .update(env.metaTokenEncryptionSecret)
      .digest();
  }
}
