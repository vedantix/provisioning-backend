import { Octokit } from '@octokit/rest';
import { env } from '../../config/env';

const octokit = new Octokit({ auth: env.githubToken });

export async function dispatchDeploymentWorkflow(params: {
  repo: string;
  bucket: string;
  distributionId: string;
}) {
  await octokit.actions.createWorkflowDispatch({
    owner: env.githubOwner,
    repo: params.repo,
    workflow_id: 'deploy-static-site.yml',
    ref: 'main',
    inputs: {
      bucket: params.bucket,
      distribution_id: params.distributionId
    }
  });
}