import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';
import { logger } from '../../lib/logger';

export type MarketingStackEnvironmentValidation = {
  ok: boolean;
  missing: string[];
  warnings: string[];
};

const REQUIRED_GOOGLE_ENV = [
  'GOOGLE_ANALYTICS_ACCOUNT_ID',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
] as const;

const REQUIRED_ADS_ENV = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
] as const;

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export class EnvironmentValidationService {
  validateMarketingStackEnvironment(): MarketingStackEnvironmentValidation {
    const missing = [...REQUIRED_GOOGLE_ENV, ...REQUIRED_ADS_ENV].filter(
      (name) => !hasEnv(name),
    );
    const warnings: string[] = [];

    if (!env.googleAdsLoginCustomerId) {
      warnings.push(
        'GOOGLE_ADS_LOGIN_CUSTOMER_ID is not set; this is fine for direct customer accounts but required for manager-account access.',
      );
    }

    if (!env.clarityApiBaseUrl || !env.clarityApiToken) {
      warnings.push(
        'CLARITY_API_BASE_URL and CLARITY_API_TOKEN are not set; Clarity provisioning will be skipped unless CLARITY_REQUIRED=true.',
      );
    }

    return {
      ok: missing.length === 0,
      missing,
      warnings,
    };
  }

  assertMarketingStackConfigured(): void {
    const validation = this.validateMarketingStackEnvironment();

    if (!validation.ok) {
      throw new AppError(
        `Marketing stack environment is incomplete: ${validation.missing.join(', ')}`,
        500,
        'MARKETING_ENV_MISSING',
        {
          missing: validation.missing,
          warnings: validation.warnings,
        },
      );
    }
  }

  validateStartup(): void {
    const validation = this.validateMarketingStackEnvironment();

    if (validation.ok) {
      logger.info('Marketing stack environment validation passed', {
        provider: 'MARKETING_STACK',
      });
      return;
    }

    const metadata = {
      provider: 'MARKETING_STACK',
      missing: validation.missing,
      warnings: validation.warnings,
      strict: env.googleMarketingStackRequired,
    };

    if (env.googleMarketingStackRequired) {
      logger.error('Marketing stack environment validation failed', metadata);
      throw new AppError(
        `Marketing stack environment is incomplete: ${validation.missing.join(', ')}`,
        500,
        'MARKETING_ENV_MISSING',
        metadata,
      );
    }

    logger.warn('Marketing stack environment validation warning', metadata);
  }
}
