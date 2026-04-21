export type AdminUserRecord = {
    id: string;
    tenantId: string;
    email: string;
    passwordHash: string;
    passwordSalt: string;
    passwordIterations: number;
    displayName: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    lastLoginAt?: string;
  };