import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  awsRegion: required('AWS_REGION'),
  awsAcmRegion: required('AWS_ACM_REGION'),
  route53HostedZoneId: required('AWS_ROUTE53_HOSTED_ZONE_ID'),
  githubOwner: required('GITHUB_OWNER'),
  githubToken: required('GITHUB_TOKEN'),
  provisioningApiKey: required('PROVISIONING_API_KEY'),
  sqsQueueUrl: required('SQS_QUEUE_URL'),
  customersTable: required('CUSTOMERS_TABLE'),
  deploymentsTable: required('DEPLOYMENTS_TABLE'),
  jobsTable: required('JOBS_TABLE')
};