import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback?: string): string | undefined {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }
  return fallback;
}

function csvFromEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name]?.trim();
  if (!value) return fallback;

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric env var: ${name}`);
  }

  return parsed;
}

const nodeEnv = optional('NODE_ENV', 'development')!;
const DEFAULT_ADMIN_SESSION_SECRET = 'vedantix-admin-session-secret-v2-2026-04-21-abc123xyz';

export const env = {
  nodeEnv,
  port: numberFromEnv('PORT', 3000),

  awsRegion: required('AWS_REGION'),
  awsAcmRegion: required('AWS_ACM_REGION'),
  awsRoute53DomainsRegion: optional('AWS_ROUTE53_DOMAINS_REGION', 'us-east-1')!,
  route53HostedZoneId: required('AWS_ROUTE53_HOSTED_ZONE_ID'),

  githubOwner: required('GITHUB_OWNER'),
  githubToken: optional('GITHUB_TOKEN'),
  githubTokenSecretArn: optional('GITHUB_TOKEN_SECRET_ARN'),

  provisioningApiKey: required('PROVISIONING_API_KEY'),
  sqsQueueUrl: required('SQS_QUEUE_URL'),

  customersTable: required('CUSTOMERS_TABLE'),
  deploymentsTable: required('DEPLOYMENTS_TABLE'),
  jobsTable: required('JOBS_TABLE'),
  financeTable: optional('FINANCE_TABLE', 'vedantix-finance')!,
  adminUsersTable: optional('ADMIN_USERS_TABLE', 'vedantix-admin-users')!,
  productCatalogTable: optional('PRODUCT_CATALOG_TABLE', 'product_catalog')!,
  analyticsIntegrationsTable: optional(
    'ANALYTICS_INTEGRATIONS_TABLE',
    'analytics_integrations',
  )!,

  allowedRootDomain: optional('ALLOWED_ROOT_DOMAIN', 'vedantix.nl')!,
  corsAllowedOrigins: csvFromEnv('CORS_ALLOWED_ORIGINS', [
    'https://vedantix.nl',
    'https://www.vedantix.nl',
    'https://api.vedantix.nl',
    'https://preview.vedantix.nl',
    'http://localhost:5173',
  ]),
  structuredLogging: booleanFromEnv('STRUCTURED_LOGGING', true),
  logLevel: optional('LOG_LEVEL', 'info')!,
  prettyLogs: booleanFromEnv('PRETTY_LOGS', false),

  deleteProtectionEnabled: booleanFromEnv('DELETE_PROTECTION_ENABLED', true),
  allowTestResourceCleanup: booleanFromEnv('ALLOW_TEST_RESOURCE_CLEANUP', false),

  maxStageRetryCount: numberFromEnv('MAX_STAGE_RETRY_COUNT', 3),
  operationLockTtlSeconds: numberFromEnv('OPERATION_LOCK_TTL_SECONDS', 1800),
  idempotencyTtlSeconds: numberFromEnv('IDEMPOTENCY_TTL_SECONDS', 86400),

  requestBodyLimit: optional('REQUEST_BODY_LIMIT', '1mb')!,
  rateLimitWindowMs: numberFromEnv('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMaxRequests: numberFromEnv('RATE_LIMIT_MAX_REQUESTS', 60),

  healthcheckRequireApiKey: booleanFromEnv('HEALTHCHECK_REQUIRE_API_KEY', false),
  cleanupCandidateMinAgeHours: numberFromEnv('CLEANUP_CANDIDATE_MIN_AGE_HOURS', 24),

  pricingTable: optional('PRICING_TABLE', 'vedantix-pricing')!,
  stripeCurrency: optional('STRIPE_CURRENCY', 'eur')!,
  appRunnerServiceArn: optional('APP_RUNNER_SERVICE_ARN'),
  appRunnerServiceName: optional('APP_RUNNER_SERVICE_NAME', 'vedantix-provisioning-api')!,

  domainRegistrationEnabled: booleanFromEnv('DOMAIN_REGISTRATION_ENABLED', false),
  domainRegistrationAutoRenew: booleanFromEnv('DOMAIN_REGISTRATION_AUTO_RENEW', true),
  domainRegistrationPrivacyProtect: booleanFromEnv('DOMAIN_REGISTRATION_PRIVACY_PROTECT', true),
  domainRegistrationDurationYears: numberFromEnv('DOMAIN_REGISTRATION_DURATION_YEARS', 1),
  domainRegistrationWaitSeconds: numberFromEnv('DOMAIN_REGISTRATION_WAIT_SECONDS', 120),
  domainContactType: optional('DOMAIN_CONTACT_TYPE', 'COMPANY')!,
  domainContactOrganizationName: optional('DOMAIN_CONTACT_ORGANIZATION_NAME'),
  domainContactFirstName: optional('DOMAIN_CONTACT_FIRST_NAME'),
  domainContactLastName: optional('DOMAIN_CONTACT_LAST_NAME'),
  domainContactEmail: optional('DOMAIN_CONTACT_EMAIL'),
  domainContactPhone: optional('DOMAIN_CONTACT_PHONE'),
  domainContactAddressLine1: optional('DOMAIN_CONTACT_ADDRESS_LINE1'),
  domainContactAddressLine2: optional('DOMAIN_CONTACT_ADDRESS_LINE2'),
  domainContactCity: optional('DOMAIN_CONTACT_CITY'),
  domainContactState: optional('DOMAIN_CONTACT_STATE'),
  domainContactPostalCode: optional('DOMAIN_CONTACT_POSTAL_CODE'),
  domainContactCountryCode: optional('DOMAIN_CONTACT_COUNTRY_CODE', 'NL')!,

  alertsEnabled: booleanFromEnv('ALERTS_ENABLED', false),
  alertTopicArn: optional('ALERT_TOPIC_ARN'),

  mailProvider: optional('MAIL_PROVIDER', 'MIGADU')!,
  migaduApiBaseUrl: optional('MIGADU_API_BASE_URL', 'https://api.migadu.com/v1')!,
  migaduUsername: optional('MIGADU_USERNAME'),
  migaduPassword: optional('MIGADU_PASSWORD'),
  migaduRequestTimeoutMs: numberFromEnv('MIGADU_REQUEST_TIMEOUT_MS', 20_000),

  base44EditorBaseUrl: optional('BASE44_EDITOR_BASE_URL', 'https://app.base44.com/apps')!,
  base44PreviewBaseUrl: optional('BASE44_PREVIEW_BASE_URL', 'https://preview.vedantix.nl')!,
  publicPreviewBaseUrl: optional('PUBLIC_PREVIEW_BASE_URL', 'https://www.vedantix.nl')!,

  base44AutoCreateEnabled: booleanFromEnv('BASE44_AUTOCREATE_ENABLED', false),
  base44AutoCreateWebhookUrl: optional('BASE44_AUTOCREATE_WEBHOOK_URL'),
  base44AutoCreateApiKey: optional('BASE44_AUTOCREATE_API_KEY'),
  base44AutoCreateTimeoutMs: numberFromEnv('BASE44_AUTOCREATE_TIMEOUT_MS', 30_000),

  base44ExportWebhookSecret: optional('BASE44_EXPORT_WEBHOOK_SECRET'),

  googleOauthTokenUrl: optional(
    'GOOGLE_OAUTH_TOKEN_URL',
    'https://oauth2.googleapis.com/token',
  )!,
  googleAnalyticsAdminApiBaseUrl: optional(
    'GOOGLE_ANALYTICS_ADMIN_API_BASE_URL',
    'https://analyticsadmin.googleapis.com/v1beta',
  )!,
  googleSearchConsoleApiBaseUrl: optional(
    'GOOGLE_SEARCH_CONSOLE_API_BASE_URL',
    'https://searchconsole.googleapis.com/webmasters/v3',
  )!,
  googleSiteVerificationApiBaseUrl: optional(
    'GOOGLE_SITE_VERIFICATION_API_BASE_URL',
    'https://www.googleapis.com/siteVerification/v1',
  )!,
  googleClientEmail: optional('GOOGLE_CLIENT_EMAIL'),
  googlePrivateKey: optional('GOOGLE_PRIVATE_KEY'),
  googleAnalyticsAccountId: optional('GOOGLE_ANALYTICS_ACCOUNT_ID'),
  googleAnalyticsTimezone: optional('GOOGLE_ANALYTICS_TIMEZONE', 'Europe/Amsterdam')!,
  googleAnalyticsCurrency: optional('GOOGLE_ANALYTICS_CURRENCY', 'EUR')!,
  googleSearchConsoleDnsMaxAttempts: numberFromEnv(
    'GOOGLE_SEARCH_CONSOLE_DNS_MAX_ATTEMPTS',
    12,
  ),
  googleSearchConsoleDnsDelayMs: numberFromEnv(
    'GOOGLE_SEARCH_CONSOLE_DNS_DELAY_MS',
    10_000,
  ),

  clarityApiBaseUrl: optional('CLARITY_API_BASE_URL'),
  clarityApiToken: optional('CLARITY_API_TOKEN'),
  clarityProjectsPath: optional('CLARITY_PROJECTS_PATH', '/projects')!,
  clarityRequired: booleanFromEnv('CLARITY_REQUIRED', false),

  adminSessionSecret: optional('ADMIN_SESSION_SECRET', DEFAULT_ADMIN_SESSION_SECRET)!,
  adminSessionTtlHours: numberFromEnv('ADMIN_SESSION_TTL_HOURS', 24),

  isProduction: nodeEnv === 'production',
} as const;

if (!env.githubToken && !env.githubTokenSecretArn) {
  throw new Error(
    'Missing GitHub credential configuration: set GITHUB_TOKEN or GITHUB_TOKEN_SECRET_ARN',
  );
}

if (env.isProduction) {
  if (!env.adminSessionSecret || env.adminSessionSecret === DEFAULT_ADMIN_SESSION_SECRET) {
    throw new Error(
      'ADMIN_SESSION_SECRET must be set to a unique secret in production.',
    );
  }

  if (env.adminSessionSecret.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET must contain at least 32 characters in production.',
    );
  }
}
