import type { DeleteStage } from './types';

export const DELETE_DEPLOYMENT_STAGES: DeleteStage[] = [
  'DELETE_DOMAIN_ALIAS',
  'DISABLE_CLOUDFRONT',
  'WAIT_CLOUDFRONT_DISABLED',
  'DELETE_CLOUDFRONT',
  'EMPTY_S3_BUCKET',
  'DELETE_S3_BUCKET',
  'DELETE_ACM_VALIDATION_RECORDS',
  'DELETE_ACM_CERTIFICATE',
  'FINALIZE_DELETE',
];

export function getNextDeleteStage(stage?: DeleteStage): DeleteStage | undefined {
  if (!stage) return DELETE_DEPLOYMENT_STAGES[0];

  const index = DELETE_DEPLOYMENT_STAGES.indexOf(stage);
  if (index === -1) return DELETE_DEPLOYMENT_STAGES[0];

  return DELETE_DEPLOYMENT_STAGES[index + 1];
}