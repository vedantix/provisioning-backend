import type { AnyStage, StageExecutionState } from './types';
import { env } from '../../config/env';

export type RetryDecision =
  | {
      allowed: true;
      reason: 'OK';
      nextRetryCount: number;
    }
  | {
      allowed: false;
      reason:
        | 'STAGE_NEVER_EXECUTED'
        | 'STAGE_NOT_FAILED'
        | 'STAGE_MARKED_NON_RETRYABLE'
        | 'MAX_RETRY_EXCEEDED';
      nextRetryCount?: number;
    };

export class RetryPolicyService {
  canRetry(
    stage: AnyStage,
    stageState?: StageExecutionState,
  ): RetryDecision {
    if (!stageState) {
      return {
        allowed: false,
        reason: 'STAGE_NEVER_EXECUTED',
      };
    }

    if (stageState.status !== 'FAILED') {
      return {
        allowed: false,
        reason: 'STAGE_NOT_FAILED',
      };
    }

    if (stageState.retryable === false) {
      return {
        allowed: false,
        reason: 'STAGE_MARKED_NON_RETRYABLE',
      };
    }

    const currentRetryCount = stageState.retryCount ?? 0;
    const nextRetryCount = currentRetryCount + 1;

    if (nextRetryCount > env.maxStageRetryCount) {
      return {
        allowed: false,
        reason: 'MAX_RETRY_EXCEEDED',
        nextRetryCount,
      };
    }

    return {
      allowed: true,
      reason: 'OK',
      nextRetryCount,
    };
  }

  getDependentFollowUpStages(stage: AnyStage): AnyStage[] {
    switch (stage) {
      case 'ACM_VALIDATION_RECORDS':
        return ['ACM_DNS_PROPAGATION', 'ACM_WAIT'];

      case 'ACM_DNS_PROPAGATION':
        return ['ACM_WAIT'];

      case 'ACM_WAIT':
        return ['CLOUDFRONT', 'ROUTE53_ALIAS', 'GITHUB_DISPATCH', 'DYNAMODB', 'SQS'];

      case 'CLOUDFRONT':
        return ['ROUTE53_ALIAS', 'GITHUB_DISPATCH', 'DYNAMODB', 'SQS'];

      case 'ROUTE53_ALIAS':
        return ['GITHUB_DISPATCH', 'DYNAMODB', 'SQS'];

      case 'GITHUB_DISPATCH':
        return ['DYNAMODB', 'SQS'];

      default:
        return [];
    }
  }

  isRetryableByDefault(stage: AnyStage): boolean {
    switch (stage) {
      case 'DOMAIN_CHECK':
        return false;

      default:
        return true;
    }
  }
}