import { createRepository, createFile, repositoryExists } from './github.service';
import {
  generateIndexHtml,
  generatePackageJson
} from '../template/site-template.service';
import { generateDeployWorkflow } from '../template/workflow-template';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function provisionRepository(repo: string, domain: string) {
  try {
    const exists = await repositoryExists(repo);

    if (!exists) {
      await createRepository(repo);
      await sleep(2000);
    }

    await createFile({
      repo,
      path: 'index.html',
      content: generateIndexHtml(domain),
      message: 'init: add index.html'
    });

    await createFile({
      repo,
      path: 'package.json',
      content: generatePackageJson(),
      message: 'init: add package.json'
    });

    await createFile({
      repo,
      path: '.github/workflows/deploy.yml',
      content: generateDeployWorkflow(),
      message: 'init: add deploy workflow'
    });

    return {
      success: true,
      repo
    };
  } catch (error: any) {
    return {
      success: false,
      stage: 'GITHUB_PROVISION',
      error: error?.message ?? 'GitHub provisioning failed'
    };
  }
}