import { Octokit } from '@octokit/rest';
import { env } from '../../config/env';

const octokit = new Octokit({
  auth: env.githubToken,
});

type GitHubStage =
  | 'GITHUB_REPOSITORY'
  | 'GITHUB_FILE'
  | 'GITHUB_WORKFLOW'
  | 'GITHUB_DISPATCH';

type GitHubFailure = {
  success: false;
  stage: GitHubStage;
  error: string;
  details?: unknown;
};

type GitHubSuccess = {
  success: true;
  details?: unknown;
};

export type GitHubResult = GitHubFailure | GitHubSuccess;

export type WorkflowSummary = {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      response?: { data?: unknown };
      request?: unknown;
      documentation_url?: string;
      errors?: unknown;
    };

    return {
      message: maybe.message,
      status: maybe.status,
      response: maybe.response?.data ?? maybe.response,
      request: maybe.request,
      documentation_url: maybe.documentation_url,
      errors: maybe.errors,
    };
  }

  return error;
}

async function getOwnerType(): Promise<'org' | 'user'> {
  const result = await octokit.users.getByUsername({
    username: env.githubOwner,
  });

  return result.data.type === 'Organization' ? 'org' : 'user';
}

export async function repositoryExists(repo: string): Promise<boolean> {
  try {
    await octokit.repos.get({
      owner: env.githubOwner,
      repo,
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
    repo,
  });

  return result.data;
}

export async function createRepository(
  repo: string,
): Promise<{
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
      defaultBranch: repository.default_branch ?? 'main',
    };
  }

  const ownerType = await getOwnerType();

  const result =
    ownerType === 'org'
      ? await octokit.repos.createInOrg({
          org: env.githubOwner,
          name: repo,
          private: true,
          auto_init: true,
        })
      : await octokit.repos.createForAuthenticatedUser({
          name: repo,
          private: true,
          auto_init: true,
        });

  return {
    created: true,
    repo: result.data.name,
    url: result.data.html_url,
    defaultBranch: result.data.default_branch ?? 'main',
  };
}

export async function waitForRepositoryReady(params: {
  repo: string;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<{ defaultBranch: string }> {
  const maxAttempts = params.maxAttempts ?? 20;
  const delayMs = params.delayMs ?? 1500;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const repository = await getRepository(params.repo);
      const branch = repository.default_branch?.trim() || 'main';

      await octokit.repos.getBranch({
        owner: env.githubOwner,
        repo: params.repo,
        branch,
      });

      return { defaultBranch: branch };
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      await sleep(delayMs);
    }
  }

  return { defaultBranch: 'main' };
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
      ref: defaultBranch(params.branch),
    });

    if (Array.isArray(result.data)) {
      throw new Error(
        `Path ${params.path} in repo ${params.repo} is a directory, expected file`,
      );
    }

    return result.data.sha ?? null;
  } catch (error: any) {
    if (error?.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function fileExists(params: {
  repo: string;
  path: string;
  branch?: string;
}): Promise<boolean> {
  const sha = await getFileSha(params);
  return Boolean(sha);
}

export async function waitForFile(params: {
  repo: string;
  path: string;
  branch?: string;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<void> {
  const maxAttempts = params.maxAttempts ?? 20;
  const delayMs = params.delayMs ?? 1500;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const exists = await fileExists({
      repo: params.repo,
      path: params.path,
      branch: params.branch,
    });

    if (exists) {
      return;
    }

    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  throw new Error(
    `File ${params.path} not found in repo ${params.repo} on branch ${defaultBranch(
      params.branch,
    )}`,
  );
}

export async function createOrUpdateFile(
  params: CreateOrUpdateFileParams,
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
    branch,
  });

  const result = await octokit.repos.createOrUpdateFileContents({
    owner: env.githubOwner,
    repo: params.repo,
    path: params.path,
    message: params.message,
    content: Buffer.from(params.content, 'utf-8').toString('base64'),
    branch,
    ...(existingSha ? { sha: existingSha } : {}),
  });

  return {
    path: params.path,
    branch,
    updated: Boolean(existingSha),
    sha:
      'content' in result.data && result.data.content
        ? result.data.content.sha
        : undefined,
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
  const results: Array<{
    path: string;
    branch: string;
    updated: boolean;
    sha?: string;
  }> = [];

  for (const file of params.files) {
    const result = await createOrUpdateFile({
      repo: params.repo,
      path: file.path,
      content: file.content,
      message: file.message,
      branch: file.branch,
    });

    results.push(result);
  }

  return {
    repo: params.repo,
    fileCount: results.length,
    results,
  };
}

export async function getRepoWorkflows(repo: string): Promise<WorkflowSummary[]> {
  const result = await octokit.actions.listRepoWorkflows({
    owner: env.githubOwner,
    repo,
  });

  return result.data.workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    path: workflow.path,
    state: workflow.state,
  }));
}

function workflowMatches(
  workflow: WorkflowSummary,
  expectedFileNames: string[],
  expectedWorkflowNames: string[],
): boolean {
  const workflowName = workflow.name.toLowerCase();
  const workflowPath = workflow.path.toLowerCase();

  return (
    expectedWorkflowNames.some(
      (name) => workflowName === name.toLowerCase(),
    ) ||
    expectedFileNames.some((file) =>
      workflowPath.endsWith(file.toLowerCase()),
    )
  );
}

export async function findWorkflow(
  params: EnsureWorkflowParams,
): Promise<WorkflowSummary | null> {
  const expectedFileNames = params.expectedFileNames ?? [
    'deploy.yml',
    'deploy.yaml',
    'deploy-static-site.yml',
    'deploy-static-site.yaml',
  ];

  const expectedWorkflowNames = params.expectedWorkflowNames ?? [
    'Deploy website',
    'Deploy Website',
    'Deploy static site',
  ];

  const workflows = await getRepoWorkflows(params.repo);

  return (
    workflows.find((item) =>
      workflowMatches(item, expectedFileNames, expectedWorkflowNames),
    ) ?? null
  );
}

export async function ensureWorkflowExists(
  params: EnsureWorkflowParams,
): Promise<{ exists: boolean; workflow?: WorkflowSummary }> {
  const workflow = await findWorkflow(params);

  if (!workflow) {
    return { exists: false };
  }

  return {
    exists: true,
    workflow,
  };
}

export async function waitForWorkflowDispatchable(params: {
  repo: string;
  expectedFileName?: string;
  expectedWorkflowNames?: string[];
  workflowFilePath?: string;
  branch?: string;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<WorkflowSummary> {
  const expectedFileName = (params.expectedFileName ?? 'deploy.yml').toLowerCase();
  const expectedWorkflowNames = (
    params.expectedWorkflowNames ?? [
      'Deploy website',
      'Deploy Website',
      'Deploy static site',
    ]
  ).map((name) => name.toLowerCase());
  const workflowFilePath = params.workflowFilePath ?? '.github/workflows/deploy.yml';
  const maxAttempts = params.maxAttempts ?? 20;
  const delayMs = params.delayMs ?? 3000;

  await waitForFile({
    repo: params.repo,
    path: workflowFilePath,
    branch: params.branch,
    maxAttempts,
    delayMs,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const workflows = await getRepoWorkflows(params.repo);

      const found =
        workflows.find((workflow) => {
          const workflowPath = workflow.path.toLowerCase();
          const workflowName = workflow.name.toLowerCase();

          return (
            workflowPath.endsWith(expectedFileName) ||
            expectedWorkflowNames.includes(workflowName)
          );
        }) ?? null;

      if (found?.id) {
        return found;
      }
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
    }

    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Workflow ${expectedFileName} not registered in repo ${params.repo}`,
  );
}

async function dispatchWorkflow(params: {
  repo: string;
  workflowIdentifier: number | string;
  ref: string;
  inputs?: Record<string, string>;
}): Promise<void> {
  try {
    await octokit.actions.createWorkflowDispatch({
      owner: env.githubOwner,
      repo: params.repo,
      workflow_id: params.workflowIdentifier,
      ref: params.ref,
      inputs: params.inputs ?? {},
    });
  } catch (error) {
    console.error('GITHUB_DISPATCH_FAILED', {
      repo: params.repo,
      workflowIdentifier: params.workflowIdentifier,
      ref: params.ref,
      inputs: params.inputs,
      error: toSerializableError(error),
    });

    throw error;
  }
}

async function resolveDispatchableWorkflow(params: {
  repo: string;
  ref?: string;
}): Promise<{ workflow: WorkflowSummary; dispatchRef: string }> {
  const { defaultBranch: repoDefaultBranch } = await waitForRepositoryReady({
    repo: params.repo,
    maxAttempts: 20,
    delayMs: 1500,
  });

  const dispatchRef = defaultBranch(params.ref ?? repoDefaultBranch);

  const workflow = await waitForWorkflowDispatchable({
    repo: params.repo,
    expectedFileName: 'deploy.yml',
    expectedWorkflowNames: [
      'Deploy website',
      'Deploy Website',
      'Deploy static site',
    ],
    workflowFilePath: '.github/workflows/deploy.yml',
    maxAttempts: 20,
    delayMs: 3000,
    branch: dispatchRef,
  });

  return { workflow, dispatchRef };
}

export async function dispatchDeploymentWorkflow(
  params: DispatchDeploymentParams,
): Promise<GitHubResult> {
  const { repo, bucket, distributionId } = params;

  try {
    const exists = await repositoryExists(repo);

    if (!exists) {
      return {
        success: false,
        stage: 'GITHUB_DISPATCH',
        error: `Repository ${repo} does not exist`,
      };
    }

    const { workflow, dispatchRef } = await resolveDispatchableWorkflow({
      repo,
      ref: params.ref,
    });

    await dispatchWorkflow({
      repo,
      workflowIdentifier: workflow.id,
      ref: dispatchRef,
      inputs: {
        bucket,
        distribution_id: distributionId,
        mode: 'deploy',
        target_ref: '',
      },
    });

    return {
      success: true,
      details: {
        repo,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowPath: workflow.path,
        dispatchRef,
        bucket,
        distributionId,
      },
    };
  } catch (error) {
    return {
      success: false,
      stage: 'GITHUB_DISPATCH',
      error: toErrorMessage(error),
      details: toSerializableError(error),
    };
  }
}

export async function dispatchRollbackWorkflow(
  params: DispatchRollbackParams,
): Promise<GitHubResult> {
  const { repo, bucket, distributionId, targetRef } = params;

  try {
    const exists = await repositoryExists(repo);

    if (!exists) {
      return {
        success: false,
        stage: 'GITHUB_DISPATCH',
        error: `Repository ${repo} does not exist`,
      };
    }

    const { workflow, dispatchRef } = await resolveDispatchableWorkflow({
      repo,
      ref: params.ref,
    });

    await dispatchWorkflow({
      repo,
      workflowIdentifier: workflow.id,
      ref: dispatchRef,
      inputs: {
        bucket,
        distribution_id: distributionId,
        target_ref: targetRef,
        mode: 'rollback',
      },
    });

    return {
      success: true,
      details: {
        repo,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowPath: workflow.path,
        dispatchRef,
        bucket,
        distributionId,
        targetRef,
      },
    };
  } catch (error) {
    return {
      success: false,
      stage: 'GITHUB_DISPATCH',
      error: toErrorMessage(error),
      details: toSerializableError(error),
    };
  }
}