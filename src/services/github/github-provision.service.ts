import {
  createManyFiles,
  createRepository,
  ensureWorkflowExists as ensureWorkflowExistsInGitHub,
  repositoryExists,
  waitForRepositoryReady,
  waitForWorkflowDispatchable,
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
      workflowPath?: string;
      workflowId?: number;
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
  files?: ProvisionFile[],
): Promise<ProvisionRepositoryResult> {
  const normalizedRepo = sanitizeRepoName(repo);

  if (!normalizedRepo) {
    return {
      success: false,
      stage: 'GITHUB_REPOSITORY',
      error: 'Invalid repository name after sanitization',
    };
  }

  try {
    const createResult = await createRepository(normalizedRepo);
    const ready = await waitForRepositoryReady({
      repo: normalizedRepo,
      maxAttempts: 20,
      delayMs: 1500,
    });

    let filesCreated = 0;
    let workflowExists = false;
    let workflowPath: string | undefined;
    let workflowId: number | undefined;

    if (files?.length) {
      try {
        const fileWriteResult = await createManyFiles({
          repo: normalizedRepo,
          files: files.map((file) => ({
            path: file.path,
            content: file.content,
            message: file.message ?? `Provision ${file.path} for ${domain}`,
            branch: file.branch ?? ready.defaultBranch,
          })),
        });

        filesCreated = fileWriteResult.fileCount;
      } catch (error) {
        return {
          success: false,
          stage: 'GITHUB_FILE',
          error: toErrorMessage(error),
          details: {
            repo: normalizedRepo,
            domain,
          },
        };
      }

      try {
        const workflowCheck = await ensureWorkflowExistsInGitHub({
          repo: normalizedRepo,
          expectedFileNames: ['deploy.yml'],
          expectedWorkflowNames: ['Deploy website', 'Deploy Website'],
        });

        workflowExists = workflowCheck.exists;

        if (!workflowExists) {
          const workflow = await waitForWorkflowDispatchable({
            repo: normalizedRepo,
            expectedFileName: 'deploy.yml',
            expectedWorkflowNames: ['Deploy website', 'Deploy Website'],
            branch: ready.defaultBranch,
            maxAttempts: 20,
            delayMs: 3000,
          });

          workflowExists = true;
          workflowPath = workflow.path;
          workflowId = workflow.id;
        } else if (workflowCheck.workflow) {
          workflowPath = workflowCheck.workflow.path;
          workflowId = workflowCheck.workflow.id;
        }
      } catch (error) {
        return {
          success: false,
          stage: 'GITHUB_WORKFLOW',
          error: toErrorMessage(error),
          details: {
            repo: normalizedRepo,
            domain,
          },
        };
      }
    }

    return {
      success: true,
      repo: normalizedRepo,
      created: createResult.created,
      filesCreated,
      workflowExists,
      workflowPath,
      workflowId,
      url: createResult.url,
      defaultBranch: ready.defaultBranch,
      details: { domain },
    };
  } catch (error) {
    return {
      success: false,
      stage: 'GITHUB_REPOSITORY',
      error: toErrorMessage(error),
      details: {
        repo: normalizedRepo,
        domain,
      },
    };
  }
}

export async function ensureRepositoryForProject(params: {
  customerId: string;
  projectId: string;
  domain: string;
}): Promise<string> {
  const repo = sanitizeRepoName(
    `${params.customerId}-${params.projectId}-${params.domain}`,
  );

  const exists = await repositoryExists(repo);

  if (!exists) {
    const createResult = await createRepository(repo);
    await waitForRepositoryReady({
      repo: createResult.repo,
      maxAttempts: 20,
      delayMs: 1500,
    });
    return createResult.repo;
  }

  await waitForRepositoryReady({
    repo,
    maxAttempts: 20,
    delayMs: 1500,
  });

  return repo;
}

export async function ensureRepositoryFiles(params: {
  repositoryName: string;
  files: Array<{
    path: string;
    content: string;
    encoding?: 'utf-8' | 'base64';
  }>;
  message: string;
}): Promise<void> {
  const ready = await waitForRepositoryReady({
    repo: params.repositoryName,
    maxAttempts: 20,
    delayMs: 1500,
  });

  await createManyFiles({
    repo: params.repositoryName,
    files: params.files.map((file) => ({
      path: file.path,
      content:
        file.encoding === 'base64'
          ? Buffer.from(file.content, 'base64').toString('utf-8')
          : file.content,
      message: `${params.message} (${file.path})`,
      branch: ready.defaultBranch,
    })),
  });
}

export async function ensureWorkflowExists(params: {
  repositoryName: string;
  workflowFileName?: string;
}): Promise<void> {
  const workflowFileName = params.workflowFileName ?? 'deploy.yml';

  const result = await ensureWorkflowExistsInGitHub({
    repo: params.repositoryName,
    expectedFileNames: [workflowFileName],
    expectedWorkflowNames: ['Deploy website', 'Deploy Website'],
  });

  if (result.exists) {
    return;
  }

  await waitForWorkflowDispatchable({
    repo: params.repositoryName,
    expectedFileName: workflowFileName,
    expectedWorkflowNames: ['Deploy website', 'Deploy Website'],
    maxAttempts: 20,
    delayMs: 3000,
  });
}