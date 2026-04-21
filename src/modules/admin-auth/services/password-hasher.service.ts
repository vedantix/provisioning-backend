import crypto from 'node:crypto';

export class PasswordHasherService {
  private readonly keyLength = 64;
  private readonly digest = 'sha512';
  private readonly iterations = 210_000;

  createSalt(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  hashPassword(password: string, salt: string): {
    hash: string;
    salt: string;
    iterations: number;
  } {
    const hash = crypto
      .pbkdf2Sync(password, salt, this.iterations, this.keyLength, this.digest)
      .toString('hex');

    return {
      hash,
      salt,
      iterations: this.iterations,
    };
  }

  verifyPassword(params: {
    password: string;
    salt: string;
    hash: string;
    iterations: number;
  }): boolean {
    const derived = crypto
      .pbkdf2Sync(
        params.password,
        params.salt,
        params.iterations,
        this.keyLength,
        this.digest,
      )
      .toString('hex');

    return crypto.timingSafeEqual(
      Buffer.from(derived, 'hex'),
      Buffer.from(params.hash, 'hex'),
    );
  }
}