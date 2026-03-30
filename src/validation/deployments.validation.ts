import { BadRequestError } from '../errors/app-error';
import type { AnyStage } from '../domain/deployments/types';

const PACKAGE_CODES = new Set(['STARTER', 'GROWTH', 'PRO']);

const STAGES: Set<AnyStage> = new Set([
  'DOMAIN_CHECK',
  'GITHUB_PROVISION',
  'S3_BUCKET',
  'ACM_REQUEST',
  'ACM_VALIDATION_RECORDS',
  'ACM_DNS_PROPAGATION',
  'ACM_WAIT',
  'CLOUDFRONT',
  'ROUTE53_ALIAS',
  'GITHUB_DISPATCH',
  'DYNAMODB',
  'SQS',
  'DELETE_DOMAIN_ALIAS',
  'DISABLE_CLOUDFRONT',
  'WAIT_CLOUDFRONT_DISABLED',
  'DELETE_CLOUDFRONT',
  'EMPTY_S3_BUCKET',
  'DELETE_S3_BUCKET',
  'DELETE_ACM_VALIDATION_RECORDS',
  'DELETE_ACM_CERTIFICATE',
  'FINALIZE_DELETE',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDomain(domain: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain.trim());
}

export function validateCreateDeploymentBody(body: unknown): asserts body is {
  customerId: string;
  projectName?: string;
  domain: string;
  packageCode: string;
  addOns?: string[];
} {
  if (!body || typeof body !== 'object') {
    throw new BadRequestError('Request body must be an object');
  }

  const payload = body as Record<string, unknown>;

  if (!isNonEmptyString(payload.customerId)) {
    throw new BadRequestError('customerId is required');
  }

  if (!isNonEmptyString(payload.domain)) {
    throw new BadRequestError('domain is required');
  }

  if (!isValidDomain(payload.domain)) {
    throw new BadRequestError('domain is invalid', {
      domain: payload.domain,
    });
  }

  if (!isNonEmptyString(payload.packageCode)) {
    throw new BadRequestError('packageCode is required');
  }

  const packageCode = payload.packageCode.trim().toUpperCase();
  if (!PACKAGE_CODES.has(packageCode)) {
    throw new BadRequestError('packageCode is invalid', {
      allowed: Array.from(PACKAGE_CODES),
      received: payload.packageCode,
    });
  }

  if (
    payload.projectName !== undefined &&
    typeof payload.projectName !== 'string'
  ) {
    throw new BadRequestError('projectName must be a string');
  }

  if (
    payload.addOns !== undefined &&
    (!Array.isArray(payload.addOns) ||
      payload.addOns.some((item) => typeof item !== 'string'))
  ) {
    throw new BadRequestError('addOns must be an array of strings');
  }
}

export function validateStageParam(stage: unknown): asserts stage is AnyStage {
  if (!isNonEmptyString(stage)) {
    throw new BadRequestError('stage is required');
  }

  if (!STAGES.has(stage as AnyStage)) {
    throw new BadRequestError('stage is invalid', {
      received: stage,
    });
  }
}