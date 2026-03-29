import { Octokit } from '@octokit/rest';
import { env } from '../../config/env';

const octokit = new Octokit({ auth: env.githubToken });

type GitHubFailure = {
  success: false;
  stage: 'GITHUB_REPOSITORY' | 'GITHUB_FILE' | 'GITHUB_WORKFLOW' | 'GITHUB_DISPATCH';
  error: string;
  details?: unknown;
};

type GitHubSuccess = {
  success: true;
  details?: unknown;
};

type GitHubResult = GitHubFailure | GitHubSuccess;

type WorkflowSummary = {
  id: number;
  name: string;
  path: string;
  state?: string;
};

type DispatchDeploymentParams = {
  repo: string;
  bucket: string;
  distributionId: string;
  ref?: string;
};

type DispatchRollbackParams = {
  repo: string;
  bucket: string;
  distributionId: string;
  targetRef: string;
  ref?: string;
};

type CreateOrUpdateFileParams = {
  repo: string;
  path: string;
  content: string;
  message: string;
  branch?: string;
};

type EnsureWorkflowParams = {
  repo: string;
  expectedFileNames?: string[];
  expectedWorkflowNames?: string[];
};

function defaultBranch(branch?: string): string {
  return branch?.trim() || 'main';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown GitHub error';
}

function toSerializableError(error: unknown): unknown {
  if (typeof error === 'object' && error !== null) {
    const maybe = error as {
      message?: string;
      status?: number;
      response?: unknown;
      request?: unknown;
      documentation_url?: string;
      errors?: unknown;
    };

    return {
      message: maybe.message,
      status: maybe.status,
      response: maybe.response,
      request: maybe.request,
      documentation_url: maybe.documentation_url,
      errors: maybe.errors
    };
  }

  return error;
}

async function getOwnerType(): Promise<'org' | 'user'> {
  const result = await octokit.users.getByUsername({
    username: env.githubOwner
  });

  return result.data.type === 'Organization' ? 'org' : 'user';
}

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

export async function getRepository(repo: string) {
  const result = await octokit.repos.get({
    owner: env.githubOwner,
    repo
  });

  return result.data;
}

export async function createRepository(repo: string): Promise<{
  created: boolean;
  repo: string;
  url?: string;
  defaultBranch?: string;
}> {
  const exists = await repositoryExists(repo);

  if (exists) {
    const repository = await getRepository(repo);

    return {
      created: false,
      repo: repository.name,
      url: repository.html_url,
      defaultBranch: repository.default_branch
    };
  }

  const ownerType = await getOwnerType();

  const result =
    ownerType === 'org'
      ? await octokit.repos.createInOrg({
          org: env.githubOwner,
          name: repo,
          private: true,
          auto_init: true
        })
      : await octokit.repos.createForAuthenticatedUser({
          name: repo,
          private: true,
          auto_init: true
        });

  return {
    created: true,
    repo: result.data.name,
    url: result.data.html_url,
    defaultBranch: result.data.default_branch
  };
}

export async function getFileSha(params: {
  repo: string;
  path: string;
  branch?: string;
}): Promise<string | null> {
  try {
    const result = await octokit.repos.getContent({
      owner: env.githubOwner,
      repo: params.repo,
      path: params.path,
      ref: defaultBranch(params.branch)
    });

    if (Array.isArray(result.data)) {
      throw new Error(`Path ${params.path} in repo ${params.repo} is a directory, expected file`);
    }

    return result.data.sha ?? null;
  } catch (error: any) {
    if (error?.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function createOrUpdateFile(
  params: CreateOrUpdateFileParams
): Promise<{
  path: string;
  branch: string;
  updated: boolean;
  sha?: string;
}> {
  const branch = defaultBranch(params.branch);
  const existingSha = await getFileSha({
    repo: params.repo,
    path: params.path,
    branch
  });

  const result = await octokit.repos.createOrUpdateFileContents({
    owner: env.githubOwner,
    repo: params.repo,
    path: params.path,
    message: params.message,
    content: Buffer.from(params.content, 'utf-8').toString('base64'),
    branch,
    ...(existingSha ? { sha: existingSha } : {})
  });

  return {
    path: params.path,
    branch,
    updated: Boolean(existingSha),
    sha:
      'content' in result.data && result.data.content
        ? result.data.content.sha
        : undefined
  };
}

export async function createManyFiles(params: {
  repo: string;
  files: Array<{
    path: string;
    content: string;
    message: string;
    branch?: string;
  }>;
}): Promise<{
  repo: string;
  fileCount: number;
  results: Array<{
    path: string;
    branch: string;
    updated: boolean;
    sha?: string;
  }>;
}> {
  const results = [];

  for (const file of params.files) {
    const result = await createOrUpdateFile({
      repo: params.repo,
      path: file.path,
      content: file.content,
      message: file.message,
      branch: file.branch
    });

    results.push(result);
  }

  return {
    repo: params.repo,
    fileCount: results.length,
    results
  };
}

export async function getRepoWorkflows(repo: string): Promise<WorkflowSummary[]> {
  const result = await octokit.actions.listRepoWorkflows({
    owner: env.githubOwner,
    repo
  });

  return result.data.workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    path: workflow.path,
    state: workflow.state
  }));
}

function workflowMatches(
  workflow: WorkflowSummary,
  expectedFileNames: string[],
  expectedWorkflowNames: string[]
): boolean {
  const workflowName = workflow.name.toLowerCase();
  const workflowPath = workflow.path.toLowerCase();

  return (
    expectedWorkflowNames.some((name) => workflowName === name.toLowerCase()) ||
    expectedFileNames.some((file) => workflowPath.endsWith(file.toLowerCase()))
  );
}

export async function findWorkflow(
  params: EnsureWorkflowParams
): Promise<WorkflowSummary | null> {
  const expectedFileNames = params.expectedFileNames ?? [
    'deploy.yml',
    'deploy.yaml',
    'deploy-static-site.yml',
    'deploy-static-site.yaml'
  ];

  const expectedWorkflowNames = params.expectedWorkflowNames ?? [
    'Deploy website',
    'Deploy Website',
    'Deploy static site'
  ];

  const workflows = await getRepoWorkflows(params.repo);

  const workflow =
    workflows.find((item) =>
      workflowMatches(item, expectedFileNames, expectedWorkflowNames)
    ) ?? null;

  return workflow;
}

export async function ensureWorkflowExists(
  params: EnsureWorkflowParams
): Promise<{
  exists: boolean;
  workflow?: WorkflowSummary;
}> {
  const workflow = await findWorkflow(params);

  if (!workflow) {
    return {
      exists: false
    };
  }

  return {
    exists: true,
    workflow
  };
}

async function dispatchWorkflow(params: {
  repo: string;
  workflowId: number;
  ref?: string;
  inputs?: Record<string, string>;
}): Promise<void> {
  await octokit.actions.createWorkflowDispatch({
    owner: env.githubOwner,
    repo: params.repo,
    workflow_id: params.workflowId,
    ref: defaultBranch(params.ref),
    inputs: params.inputs ?? {}
  });
}

export async function dispatchDeploymentWorkflow(
  params: DispatchDeploymentParams
): Promise<GitHubResult> {
  const { repo, bucket, distributionId } = params;

  try {
    const exists = await repositoryExists(repo);

    if (!exists) {
      return {
        success: false,
        stage: 'GITHUB_DISPATCH',
        error: `Repository ${repo} does not exist`
      };
    }

    const workflow = await findWorkflow({
      repo
    });

    if (!workflow) {
      return {
        success: false,
        stage: 'GITHUB_DISPATCH',
        error: `Deployment workflow not found in repo ${repo}`
      };
    }

    await dispatchWorkflow({
      repo,
      workflowId: workflow.id,
      ref: params.ref,
      inputs: {
        bucket,
        distribution_id: distributionId,
        mode: 'deploy'
      }
    });

    return {
      success: true,
      details: {
        repo,
        workflowId: workflow.id,
        workflowName: workflow.name,
        bucket,
        distributionId
      }
    };
  } catch (error) {
    return {
      success: false,
      stage: 'GITHUB_DISPATCH',
      error: toErrorMessage(error),
      details: toSerializableError(error)
    };
  }
}

export async function dispatchRollbackWorkflow(
  params: DispatchRollbackParams
): Promise<GitHubResult> {
  const { repo, bucket, distributionId, targetRef } = params;

  try {
    const exists = await repositoryExists(repo);

    if (!exists) {
      return {
        success: false,
        stage: 'GITHUB_DISPATCH',
        error: `Repository ${repo} does not exist`
      };
    }

    const workflow = await findWorkflow({
      repo
    });

    if (!workflow) {
      return {
        success: false,
        stage: 'GITHUB_DISPATCH',
        error: `Rollback workflow target not found in repo ${repo}`
      };
    }

    await dispatchWorkflow({
      repo,
      workflowId: workflow.id,
      ref: params.ref,
      inputs: {
        bucket,
        distribution_id: distributionId,
        target_ref: targetRef,
        mode: 'rollback'
      }
    });

    return {
      success: true,
      details: {
        repo,
        workflowId: workflow.id,
        workflowName: workflow.name,
        bucket,
        distributionId,
        targetRef
      }
    };
  } catch (error) {
    return {
      success: false,
      stage: 'GITHUB_DISPATCH',
      error: toErrorMessage(error),
      details: toSerializableError(error)
    };
  }
}