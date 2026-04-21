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

export const env = {
  nodeEnv,
  port: numberFromEnv('PORT', 3000),

  awsRegion: required('AWS_REGION'),
  awsAcmRegion: required('AWS_ACM_REGION'),
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

  allowedRootDomain: optional('ALLOWED_ROOT_DOMAIN', 'vedantix.nl')!,
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

  alertsEnabled: booleanFromEnv('ALERTS_ENABLED', false),
  alertTopicArn: optional('ALERT_TOPIC_ARN'),

  mailProvider: optional('MAIL_PROVIDER', 'ZOHO')!,
  zohoApiBaseUrl: optional('ZOHO_API_BASE_URL', 'https://mail.zoho.com/api')!,
  zohoAccountsBaseUrl: optional(
    'ZOHO_ACCOUNTS_BASE_URL',
    'https://accounts.zoho.com',
  )!,
  zohoClientId: optional('ZOHO_CLIENT_ID'),
  zohoClientSecret: optional('ZOHO_CLIENT_SECRET'),
  zohoRefreshToken: optional('ZOHO_REFRESH_TOKEN'),
  zohoOrganizationId: optional('ZOHO_ORGANIZATION_ID'),
  zohoTokenTimeoutMs: numberFromEnv('ZOHO_TOKEN_TIMEOUT_MS', 15_000),
  zohoRequestTimeoutMs: numberFromEnv('ZOHO_REQUEST_TIMEOUT_MS', 20_000),

  base44EditorBaseUrl: optional('BASE44_EDITOR_BASE_URL', 'https://app.base44.com/apps')!,
  base44PreviewBaseUrl: optional('BASE44_PREVIEW_BASE_URL', 'https://preview.vedantix.nl')!,

  base44AutoCreateEnabled: booleanFromEnv('BASE44_AUTOCREATE_ENABLED', false),
  base44AutoCreateWebhookUrl: optional('BASE44_AUTOCREATE_WEBHOOK_URL'),
  base44AutoCreateApiKey: optional('BASE44_AUTOCREATE_API_KEY'),
  base44AutoCreateTimeoutMs: numberFromEnv('BASE44_AUTOCREATE_TIMEOUT_MS', 30_000),

  base44ExportWebhookSecret: optional('BASE44_EXPORT_WEBHOOK_SECRET'),

  adminSessionSecret: optional('ADMIN_SESSION_SECRET', 'vedantix-admin-session-secret-v2-2026-04-21-abc123xyz')!,
  adminSessionTtlHours: numberFromEnv('ADMIN_SESSION_TTL_HOURS', 24),

  isProduction: nodeEnv === 'production',
} as const;

if (!env.githubToken && !env.githubTokenSecretArn) {
  throw new Error(
    'Missing GitHub credential configuration: set GITHUB_TOKEN or GITHUB_TOKEN_SECRET_ARN',
  );
}

if (env.mailProvider === 'ZOHO') {
  if (!env.zohoClientId) {
    throw new Error('Missing required env var for Zoho mail: ZOHO_CLIENT_ID');
  }

  if (!env.zohoClientSecret) {
    throw new Error('Missing required env var for Zoho mail: ZOHO_CLIENT_SECRET');
  }

  if (!env.zohoRefreshToken) {
    throw new Error('Missing required env var for Zoho mail: ZOHO_REFRESH_TOKEN');
  }

  if (!env.zohoOrganizationId) {
    throw new Error('Missing required env var for Zoho mail: ZOHO_ORGANIZATION_ID');
  }
}