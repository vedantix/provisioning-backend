import crypto from 'node:crypto';
import { UnauthorizedError, ConflictHttpError } from '../../../errors/app-error';
import { env } from '../../../config/env';
import { AdminUsersRepository } from '../repositories/admin-users.repository';
import { PasswordHasherService } from './password-hasher.service';
import type { AdminUserRecord } from '../types/admin-user.types';

type AdminSessionPayload = {
  sub: 'admin';
  adminUserId: string;
  tenantId: string;
  email: string;
  iat: number;
  exp: number;
};

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding =
    normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));

  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function sign(value: string): string {
  return crypto
    .createHmac('sha256', env.adminSessionSecret)
    .update(value)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export class AdminAuthService {
  constructor(
    private readonly adminUsersRepository = new AdminUsersRepository(),
    private readonly passwordHasherService = new PasswordHasherService(),
  ) {}

  async bootstrapAdminUser(params: {
    tenantId: string;
    email: string;
    password: string;
    displayName: string;
  }): Promise<AdminUserRecord> {
    const existingUsers = await this.adminUsersRepository.listByTenant(
      params.tenantId,
    );

    if (existingUsers.length > 0) {
      throw new ConflictHttpError(
        'Admin bootstrap is niet meer toegestaan voor deze tenant',
      );
    }

    const existingByEmail = await this.adminUsersRepository.getByEmail(
      params.tenantId,
      params.email,
    );

    if (existingByEmail) {
      throw new ConflictHttpError('Admin gebruiker bestaat al');
    }

    const salt = this.passwordHasherService.createSalt();
    const passwordData = this.passwordHasherService.hashPassword(
      params.password,
      salt,
    );
    const now = new Date().toISOString();

    const adminUser: AdminUserRecord = {
      id: crypto.randomUUID(),
      tenantId: params.tenantId,
      email: params.email.trim().toLowerCase(),
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt,
      passwordIterations: passwordData.iterations,
      displayName: params.displayName.trim(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.adminUsersRepository.create(adminUser);

    return adminUser;
  }

  async login(params: {
    tenantId: string;
    email: string;
    password: string;
  }): Promise<{
    token: string;
    tokenType: 'Bearer';
    expiresInHours: number;
    user: {
      id: string;
      email: string;
      displayName: string;
      tenantId: string;
    };
  }> {
    const user = await this.adminUsersRepository.getByEmail(
      params.tenantId,
      params.email,
    );

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Ongeldige inloggegevens');
    }

    const isValid = this.passwordHasherService.verifyPassword({
      password: params.password,
      salt: user.passwordSalt,
      hash: user.passwordHash,
      iterations: user.passwordIterations,
    });

    if (!isValid) {
      throw new UnauthorizedError('Ongeldige inloggegevens');
    }

    const token = this.createSessionToken(user);

    await this.adminUsersRepository.updateLastLogin(
      user.id,
      new Date().toISOString(),
    );

    return {
      token,
      tokenType: 'Bearer',
      expiresInHours: env.adminSessionTtlHours,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        tenantId: user.tenantId,
      },
    };
  }

  createSessionToken(user: AdminUserRecord): string {
    const nowSeconds = Math.floor(Date.now() / 1000);

    const payload: AdminSessionPayload = {
      sub: 'admin',
      adminUserId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      iat: nowSeconds,
      exp: nowSeconds + env.adminSessionTtlHours * 60 * 60,
    };

    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = sign(encodedPayload);

    return `${encodedPayload}.${signature}`;
  }

  verifySessionToken(token: string): AdminSessionPayload {
    if (!token || !token.includes('.')) {
      throw new UnauthorizedError('Ongeldige admin sessie');
    }

    const [encodedPayload, signature] = token.split('.');

    if (!encodedPayload || !signature) {
      throw new UnauthorizedError('Ongeldige admin sessie');
    }

    const expectedSignature = sign(encodedPayload);

    if (signature !== expectedSignature) {
      throw new UnauthorizedError('Ongeldige admin sessie');
    }

    let payload: AdminSessionPayload;

    try {
      payload = JSON.parse(fromBase64Url(encodedPayload)) as AdminSessionPayload;
    } catch {
      throw new UnauthorizedError('Ongeldige admin sessie');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    if (!payload?.exp || payload.exp < nowSeconds) {
      throw new UnauthorizedError('Admin sessie is verlopen');
    }

    if (payload.sub !== 'admin') {
      throw new UnauthorizedError('Ongeldige admin sessie');
    }

    return payload;
  }
}