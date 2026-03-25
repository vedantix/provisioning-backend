import { Octokit } from '@octokit/rest';
import { env } from '../../config/env';

const octokit = new Octokit({ auth: env.githubToken });

export async function repositoryExists(repo: string): Promise<boolean> {
  try {
    await octokit.repos.get({
      owner: env.githubOwner,
      repo
    });
    return true;
  } catch (error: any) {
    if (error?.status === 404) {
      return false;
    }
    throw error;
  }
}

export async function createRepository(repo: string) {
  const exists = await repositoryExists(repo);

  if (exists) {
    return {
      created: false,
      repo
    };
  }

  const result = await octokit.repos.createInOrg({
    org: env.githubOwner,
    name: repo,
    private: true
  });

  return {
    created: true,
    repo: result.data.name,
    url: result.data.html_url
  };
}

export async function createFile(params: {
  repo: string;
  path: string;
  content: string;
  message: string;
  branch?: string;
}) {
  const branch = params.branch ?? 'main';

  return octokit.repos.createOrUpdateFileContents({
    owner: env.githubOwner,
    repo: params.repo,
    path: params.path,
    message: params.message,
    content: Buffer.from(params.content, 'utf-8').toString('base64'),
    branch
  });
}

export async function getRepoWorkflows(repo: string) {
  return octokit.actions.listRepoWorkflows({
    owner: env.githubOwner,
    repo
  });
}

export async function dispatchDeploymentWorkflow(params: {
  repo: string;
  bucket: string;
  distributionId: string;
}) {
  const { repo, bucket, distributionId } = params;

  try {
    await octokit.repos.get({
      owner: env.githubOwner,
      repo
    });

    const workflows = await getRepoWorkflows(repo);

    const workflow = workflows.data.workflows.find(
      w =>
        w.name === 'Deploy website' ||
        w.path.includes('deploy-static-site.yml') ||
        w.path.includes('deploy.yml')
    );

    if (!workflow) {
      return {
        success: false,
        stage: 'GITHUB_DISPATCH',
        error: `Workflow not found in repo ${repo}`
      };
    }

    await octokit.actions.createWorkflowDispatch({
      owner: env.githubOwner,
      repo,
      workflow_id: workflow.id,
      ref: 'main',
      inputs: {
        bucket,
        distribution_id: distributionId
      }
    });

    return {
      success: true
    };
  } catch (error: any) {
    return {
      success: false,
      stage: 'GITHUB_DISPATCH',
      error: error?.message ?? 'GitHub dispatch failed'
    };
  }
}