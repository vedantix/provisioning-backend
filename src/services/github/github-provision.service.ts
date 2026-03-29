import {
  createRepository,
  createManyFiles,
  repositoryExists,
  ensureWorkflowExists as ensureWorkflowExistsInGitHub
} from './github.service';

type ProvisionFile = {
  path: string;
  content: string;
  message?: string;
  branch?: string;
};

type ProvisionRepositoryResult =
  | {
      success: true;
      repo: string;
      created: boolean;
      filesCreated: number;
      workflowExists: boolean;
      url?: string;
      defaultBranch?: string;
      details?: unknown;
    }
  | {
      success: false;
      stage: 'GITHUB_REPOSITORY' | 'GITHUB_FILE' | 'GITHUB_WORKFLOW';
      error: string;
      details?: unknown;
    };

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown GitHub provisioning error';
}

function sanitizeRepoName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export async function provisionRepository(
  repo: string,
  domain: string,
  files?: ProvisionFile[]
): Promise<ProvisionRepositoryResult> {
  const normalizedRepo = sanitizeRepoName(repo);

  if (!normalizedRepo) {
    return {
      success: false,
      stage: 'GITHUB_REPOSITORY',
      error: 'Invalid repository name after sanitization'
    };
  }

  try {
    const createResult = await createRepository(normalizedRepo);

    let filesCreated = 0;
    let workflowExists = false;

    if (files?.length) {
      try {
        const fileWriteResult = await createManyFiles({
          repo: normalizedRepo,
          files: files.map((file) => ({
            path: file.path,
            content: file.content,
            message: file.message ?? `Provision ${file.path} for ${domain}`,
            branch: file.branch
          }))
        });

        filesCreated = fileWriteResult.fileCount;
      } catch (error) {
        return {
          success: false,
          stage: 'GITHUB_FILE',
          error: toErrorMessage(error),
          details: {
            repo: normalizedRepo,
            domain
          }
        };
      }

      try {
        const workflowCheck = await ensureWorkflowExistsInGitHub({
          repo: normalizedRepo
        });

        workflowExists = workflowCheck.exists;
      } catch (error) {
        return {
          success: false,
          stage: 'GITHUB_WORKFLOW',
          error: toErrorMessage(error),
          details: {
            repo: normalizedRepo,
            domain
          }
        };
      }
    }

    return {
      success: true,
      repo: normalizedRepo,
      created: createResult.created,
      filesCreated,
      workflowExists,
      url: createResult.url,
      defaultBranch: createResult.defaultBranch,
      details: {
        domain
      }
    };
  } catch (error) {
    return {
      success: false,
      stage: 'GITHUB_REPOSITORY',
      error: toErrorMessage(error),
      details: {
        repo: normalizedRepo,
        domain
      }
    };
  }
}

export async function ensureRepositoryForProject(params: {
  customerId: string;
  projectId: string;
  domain: string;
}): Promise<string> {
  const repo = sanitizeRepoName(`${params.customerId}-${params.projectId}-${params.domain}`);

  const exists = await repositoryExists(repo);

  if (!exists) {
    const createResult = await createRepository(repo);
    return createResult.repo;
  }

  return repo;
}

export async function ensureRepositoryFiles(params: {
  repositoryName: string;
  files: Array<{ path: string; content: string; encoding?: 'utf-8' | 'base64' }>;
  message: string;
}): Promise<void> {
  await createManyFiles({
    repo: params.repositoryName,
    files: params.files.map((file) => ({
      path: file.path,
      content:
        file.encoding === 'base64'
          ? Buffer.from(file.content, 'base64').toString('utf-8')
          : file.content,
      message: `${params.message} (${file.path})`
    }))
  });
}

export async function ensureWorkflowExists(params: {
  repositoryName: string;
  workflowFileName?: string;
}): Promise<void> {
  const result = await ensureWorkflowExistsInGitHub({
    repo: params.repositoryName,
    expectedFileNames: params.workflowFileName ? [params.workflowFileName] : undefined
  });

  if (!result.exists) {
    throw new Error(
      `Workflow ${params.workflowFileName ?? 'deploy workflow'} not found in repo ${params.repositoryName}`
    );
  }
}