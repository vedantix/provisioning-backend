import {
    ensureRepositoryFiles,
    ensureRepositoryForProject,
    ensureWorkflowExists,
  } from '../../../services/github/github-provision.service';
  import { CustomersRepository } from '../../customers/repositories/customers.repository';
  import type { CustomerRecord } from '../../customers/types/customer.types';
  import type {
    ContentSyncFileInput,
    SyncCustomerContentInput,
    SyncCustomerContentResult,
  } from '../types/content-sync.types';
  
  function sanitizePath(path: string): string {
    const normalized = String(path || '')
      .replace(/^\/+/, '')
      .replace(/\\/g, '/')
      .trim();
  
    if (!normalized) {
      throw new Error('Invalid file path');
    }
  
    if (normalized.includes('..')) {
      throw new Error(`Unsafe file path: ${path}`);
    }
  
    return normalized;
  }
  
  function buildSyncFiles(input: {
    customer: CustomerRecord;
    indexHtml: string;
    additionalFiles?: ContentSyncFileInput[];
  }): Array<{
    path: string;
    content: string;
    encoding?: 'utf-8' | 'base64';
  }> {
    const files: Array<{
      path: string;
      content: string;
      encoding?: 'utf-8' | 'base64';
    }> = [
      {
        path: 'index.html',
        content: input.indexHtml,
        encoding: 'utf-8',
      },
      {
        path: 'site.webmanifest',
        content: JSON.stringify(
          {
            name: input.customer.companyName,
            short_name: input.customer.companyName,
            start_url: '/',
            display: 'standalone',
          },
          null,
          2,
        ),
        encoding: 'utf-8',
      },
      {
        path: '.nojekyll',
        content: '',
        encoding: 'utf-8',
      },
      {
        path: 'vedantix.sync.json',
        content: JSON.stringify(
          {
            customerId: input.customer.id,
            domain: input.customer.domain,
            base44AppId: input.customer.base44?.appId || null,
            syncedAt: new Date().toISOString(),
            source: 'BASE44_EXPORT',
          },
          null,
          2,
        ),
        encoding: 'utf-8',
      },
    ];
  
    for (const file of input.additionalFiles || []) {
      files.push({
        path: sanitizePath(file.path),
        content: file.content,
        encoding: file.encoding || 'utf-8',
      });
    }
  
    return files;
  }
  
  export class ContentSyncService {
    constructor(
      private readonly customersRepository = new CustomersRepository(),
    ) {}
  
    async syncCustomerContent(
      customer: CustomerRecord,
      input: SyncCustomerContentInput,
    ): Promise<SyncCustomerContentResult> {
      if (!customer.base44?.appId) {
        throw new Error('Base44 app is not linked for this customer');
      }
  
      const repositoryName = await ensureRepositoryForProject({
        customerId: customer.id,
        projectId:
          input.projectId ||
          customer.base44?.appId ||
          customer.companyName,
        domain: customer.domain,
      });
  
      const files = buildSyncFiles({
        customer,
        indexHtml: input.indexHtml,
        additionalFiles: input.additionalFiles,
      });
  
      await ensureRepositoryFiles({
        repositoryName,
        files,
        message: `Sync Base44 export for ${customer.companyName}`,
      });
  
      await ensureWorkflowExists({
        repositoryName,
        workflowFileName: 'deploy.yml',
      });
  
      const now = new Date().toISOString();
  
      const updatedCustomer: CustomerRecord = {
        ...customer,
        updatedAt: now,
        updatedBy: input.actorId,
        contentSync: {
          status: 'SYNCED',
          repositoryName,
          branch: 'main',
          lastSyncedAt: now,
          filesCount: files.length,
          source: 'BASE44_EXPORT',
        },
        deployment: {
          ...customer.deployment,
          repositoryName,
        },
      };
  
      await this.customersRepository.update(updatedCustomer);
  
      return {
        repositoryName,
        branch: 'main',
        filesCount: files.length,
      };
    }
  }