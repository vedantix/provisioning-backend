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

  const result = await octokit.repos.createForAuthenticatedUser({
    name: repo,
    private: true,
    auto_init: false
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
    console.log(`[GitHub] Dispatch start for repo: ${repo}`);

    await octokit.repos.get({
      owner: env.githubOwner,
      repo
    });

    console.log(`[GitHub] Repo exists: ${repo}`);

    const workflows = await getRepoWorkflows(repo);

    const workflow = workflows.data.workflows.find(
      w =>
        w.name === 'Deploy website' ||
        w.path.includes('deploy-static-site.yml') ||
        w.path.includes('deploy.yml')
    );

    if (!workflow) {
      throw new Error(
        `[GitHub] Workflow not found in repo ${repo}. Expected deploy-static-site.yml or deploy.yml`
      );
    }

    console.log(`[GitHub] Found workflow: ${workflow.name}`);

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

    console.log('[GitHub] Workflow dispatched successfully');

    return {
      success: true
    };
  } catch (error: any) {
    console.error('[GitHub] Dispatch failed:', error.message);

    return {
      success: false,
      stage: 'GITHUB_DISPATCH',
      error: error.message
    };
  }
}