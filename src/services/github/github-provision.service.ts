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
    console.log(`[GitHub] Provision start for repo: ${repo}`);

    // 1. Repo check / create (idempotent)
    const exists = await repositoryExists(repo);

    if (!exists) {
      console.log(`[GitHub] Creating repo: ${repo}`);
      await createRepository(repo);

      // Belangrijk: GitHub heeft tijd nodig voordat commits mogen
      await sleep(2000);
    } else {
      console.log(`[GitHub] Repo already exists: ${repo}`);
    }

    console.log('[GitHub] Adding files');

    // 2. Files toevoegen
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

    console.log(`[GitHub] Repo ready: ${repo}`);

    return {
      success: true,
      repo
    };
  } catch (error: any) {
    console.error('[GitHub] Provision failed:', error.message);

    return {
      success: false,
      stage: 'GITHUB_PROVISION',
      error: error.message
    };
  }
}