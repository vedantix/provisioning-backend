import { describe, expect, it } from 'vitest';
import { CREATE_DEPLOYMENT_STAGES } from '../../../src/domain/deployments/stages';

describe('analytics deployment stages', () => {
  it('runs analytics before dispatching the website deployment', () => {
    expect(CREATE_DEPLOYMENT_STAGES).toEqual([
      'DOMAIN_CHECK',
      'GITHUB_PROVISION',
      'S3_BUCKET',
      'ACM_REQUEST',
      'ACM_VALIDATION_RECORDS',
      'ACM_DNS_PROPAGATION',
      'ACM_WAIT',
      'CLOUDFRONT',
      'ROUTE53_ALIAS',
      'GOOGLE_ANALYTICS',
      'GOOGLE_SEARCH_CONSOLE',
      'GOOGLE_ADS',
      'CLARITY',
      'TRACKING_INJECTION',
      'GITHUB_DISPATCH',
      'DYNAMODB',
      'SQS',
    ]);
  });
});
