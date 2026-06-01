import type { AnyStage, DeploymentStage } from './types';

export const CREATE_DEPLOYMENT_STAGES: DeploymentStage[] = [
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
  'CLARITY',
  'TRACKING_INJECTION',
  'GITHUB_DISPATCH',
  'DYNAMODB',
  'SQS',
];

export function getNextCreateStage(stage?: AnyStage): DeploymentStage | undefined {
  if (!stage) return CREATE_DEPLOYMENT_STAGES[0];
  const normalizedStage =
    stage === 'SEARCH_CONSOLE' ? 'GOOGLE_SEARCH_CONSOLE' : stage;
  const index = CREATE_DEPLOYMENT_STAGES.indexOf(normalizedStage as DeploymentStage);
  if (index === -1) return CREATE_DEPLOYMENT_STAGES[0];
  return CREATE_DEPLOYMENT_STAGES[index + 1];
}
